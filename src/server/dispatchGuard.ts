import { and, eq, inArray, isNull } from "drizzle-orm";
import { dbForSpace, schema } from "../db/index.js";
import {
  readDispatchLimits,
  releaseDispatchWakeInTransaction,
  reserveDispatchWakeInTransaction,
  type DispatchLimits,
  type WakeReservation,
} from "../dispatch/dispatchReservation.js";

export {
  DEFAULT_MAX_DISPATCH_DEPTH,
  DEFAULT_MAX_DISPATCH_WAKES,
  decideDispatch,
  readDispatchLimits,
} from "../dispatch/dispatchReservation.js";
export type {
  DispatchBlockCode,
  DispatchDecision,
  DispatchGuardInput,
  DispatchLimits,
  WakeReservation,
} from "../dispatch/dispatchReservation.js";

export type TaskExecutionMode = "autopilot" | "plan-first";

export interface DispatchMessageContext {
  chainId: string;
  dispatchDepth: number;
  taskMessageId: string | null;
}


export function normalizeTaskExecutionMode(value: unknown): TaskExecutionMode | null {
  if (value == null || value === "") return "autopilot";
  return value === "autopilot" || value === "plan-first" ? value : null;
}

export interface EnsureChainInput extends DispatchMessageContext {
  rootMessageId: string;
  channelId: string;
}

export interface ReserveWakeInput extends DispatchMessageContext {
  messageId: string;
  targetAgentId: string;
}

export interface CommitWakeContext {
  agentId: string;
  channelId: string;
  chainId: string;
  dispatchDepth: number;
}

export interface DispatchScopeStatus {
  scope: "space" | "task";
  scopeId: string;
  stopped: boolean;
  stoppedAt: Date | null;
  stopReason: string | null;
  wakeCount: number;
  maxDepthSeen: number;
  agents: string[];
  limits: DispatchLimits;
  budgetMetric: "successful_wakes";
  tokenUsageAvailable: false;
  chains: Array<{
    id: string;
    wakeCount: number;
    maxDepthSeen: number;
    lastRejectionCode: string | null;
    lastRejectionReason: string | null;
    lastRejectedAt: Date | null;
    lastRejectedMessageId: string | null;
    lastRejectedAgentId: string | null;
  }>;
}

/** Thin SQLite adapter. All mutable guard state lives in the workspace database, so restart cannot
 * reset wake budgets or emergency-stop flags. Context is keyed by agent + channel to avoid global
 * per-agent state accidentally joining unrelated concurrent task threads. */
export class SqliteDispatchState {
  readonly limits: DispatchLimits;

  constructor(readonly spaceId: string, limits: DispatchLimits = readDispatchLimits()) {
    this.limits = limits;
  }

  async resolveMessageContext(input: {
    messageId: string;
    channelId: string;
    senderType: "human" | "agent" | "system";
    senderId: string | null;
    taskMessageId?: string | null;
  }): Promise<DispatchMessageContext> {
    const db = dbForSpace(this.spaceId);
    if (input.senderType === "agent" && input.senderId) {
      const context = db.select().from(schema.dispatchContexts).where(and(
        eq(schema.dispatchContexts.spaceId, this.spaceId),
        eq(schema.dispatchContexts.agentId, input.senderId),
        eq(schema.dispatchContexts.channelId, input.channelId),
      )).get();
      if (context) {
        const chain = db.select().from(schema.dispatchChains).where(eq(schema.dispatchChains.id, context.chainId)).get();
        if (chain) {
          return {
            chainId: context.chainId,
            dispatchDepth: context.dispatchDepth + 1,
            taskMessageId: input.taskMessageId ?? chain.taskMessageId ?? null,
          };
        }
      }
    }
    return { chainId: input.messageId, dispatchDepth: 0, taskMessageId: input.taskMessageId ?? null };
  }

  async ensureChain(input: EnsureChainInput): Promise<void> {
    const db = dbForSpace(this.spaceId);
    db.insert(schema.dispatchChains).values({
      id: input.chainId,
      spaceId: this.spaceId,
      rootMessageId: input.rootMessageId,
      taskMessageId: input.taskMessageId,
      channelId: input.channelId,
      maxDepthSeen: input.dispatchDepth,
    }).onConflictDoNothing().run();
    if (input.taskMessageId) {
      db.update(schema.dispatchChains).set({ taskMessageId: input.taskMessageId, updatedAt: new Date() }).where(and(
        eq(schema.dispatchChains.id, input.chainId),
        isNull(schema.dispatchChains.taskMessageId),
      )).run();
    }
  }

  /**
   * The installation has one Core writer and each Space uses one synchronous better-sqlite3
   * connection. This transaction therefore serializes the logical-key lookup and insert without
   * requiring a schema migration; concurrent calls cannot interleave between them.
   */
  async getOrReserveWake(input: ReserveWakeInput): Promise<WakeReservation> {
    return dbForSpace(this.spaceId).transaction((tx) => reserveDispatchWakeInTransaction(tx, {
      spaceId: this.spaceId,
      ...input,
    }, this.limits));
  }

  async commitWake(reservationId: string, context: CommitWakeContext): Promise<void> {
    const db = dbForSpace(this.spaceId);
    db.transaction((tx) => {
      tx.update(schema.dispatchWakes).set({ status: "success" }).where(and(
        eq(schema.dispatchWakes.id, reservationId),
        eq(schema.dispatchWakes.spaceId, this.spaceId),
      )).run();
      tx.insert(schema.dispatchContexts).values({
        spaceId: this.spaceId,
        agentId: context.agentId,
        channelId: context.channelId,
        chainId: context.chainId,
        dispatchDepth: context.dispatchDepth,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [schema.dispatchContexts.spaceId, schema.dispatchContexts.agentId, schema.dispatchContexts.channelId],
        set: { chainId: context.chainId, dispatchDepth: context.dispatchDepth, updatedAt: new Date() },
      }).run();
    });
  }

  async releaseWake(reservationId: string): Promise<void> {
    const db = dbForSpace(this.spaceId);
    db.transaction((tx) => releaseDispatchWakeInTransaction(tx, {
      spaceId: this.spaceId,
      reservationId,
    }));
  }

  /** Return an acknowledged-but-not-executed queue item to replayable pending state without refunding budget. */
  async markWakePending(reservationId: string): Promise<void> {
    dbForSpace(this.spaceId).update(schema.dispatchWakes).set({ status: "reserved" }).where(and(
      eq(schema.dispatchWakes.id, reservationId),
      eq(schema.dispatchWakes.spaceId, this.spaceId),
      eq(schema.dispatchWakes.status, "success"),
    )).run();
  }

  async stopTask(taskMessageId: string, reason?: string): Promise<void> {
    this.setStop("task", taskMessageId, reason);
  }

  async resumeTask(taskMessageId: string): Promise<void> {
    this.clearStop("task", taskMessageId);
  }

  async stopSpace(reason?: string): Promise<void> {
    this.setStop("space", this.spaceId, reason);
  }

  async resumeSpace(): Promise<void> {
    this.clearStop("space", this.spaceId);
  }

  async taskStatus(taskMessageId: string): Promise<DispatchScopeStatus> {
    return this.scopeStatus("task", taskMessageId);
  }

  async spaceStatus(): Promise<DispatchScopeStatus> {
    return this.scopeStatus("space", this.spaceId);
  }

  async agentsForTask(taskMessageId: string): Promise<string[]> {
    const db = dbForSpace(this.spaceId);
    const chains = db.select({ id: schema.dispatchChains.id }).from(schema.dispatchChains).where(and(
      eq(schema.dispatchChains.spaceId, this.spaceId),
      eq(schema.dispatchChains.taskMessageId, taskMessageId),
    )).all();
    if (!chains.length) return [];
    const wakes = db.select({ agentId: schema.dispatchWakes.targetAgentId }).from(schema.dispatchWakes).where(and(
      eq(schema.dispatchWakes.spaceId, this.spaceId),
      inArray(schema.dispatchWakes.chainId, chains.map((chain) => chain.id)),
    )).all();
    return [...new Set(wakes.map((wake) => wake.agentId))];
  }

  private setStop(scopeType: "space" | "task", scopeId: string, reason?: string): void {
    const db = dbForSpace(this.spaceId);
    const now = new Date();
    db.insert(schema.dispatchStops).values({ spaceId: this.spaceId, scopeType, scopeId, reason: reason ?? null, stoppedAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [schema.dispatchStops.spaceId, schema.dispatchStops.scopeType, schema.dispatchStops.scopeId],
        set: { reason: reason ?? null, stoppedAt: now, updatedAt: now },
      }).run();
  }

  private clearStop(scopeType: "space" | "task", scopeId: string): void {
    dbForSpace(this.spaceId).delete(schema.dispatchStops).where(and(
      eq(schema.dispatchStops.spaceId, this.spaceId),
      eq(schema.dispatchStops.scopeType, scopeType),
      eq(schema.dispatchStops.scopeId, scopeId),
    )).run();
  }

  private async scopeStatus(scope: "space" | "task", scopeId: string): Promise<DispatchScopeStatus> {
    const db = dbForSpace(this.spaceId);
    const stop = db.select().from(schema.dispatchStops).where(and(
      eq(schema.dispatchStops.spaceId, this.spaceId),
      eq(schema.dispatchStops.scopeType, scope),
      eq(schema.dispatchStops.scopeId, scopeId),
    )).get();
    const chainRows = scope === "task"
      ? db.select().from(schema.dispatchChains).where(and(eq(schema.dispatchChains.spaceId, this.spaceId), eq(schema.dispatchChains.taskMessageId, scopeId))).all()
      : db.select().from(schema.dispatchChains).where(eq(schema.dispatchChains.spaceId, this.spaceId)).all();
    const chainIds = chainRows.map((chain) => chain.id);
    const wakes = chainIds.length
      ? db.select({ agentId: schema.dispatchWakes.targetAgentId }).from(schema.dispatchWakes).where(and(
        eq(schema.dispatchWakes.spaceId, this.spaceId),
        inArray(schema.dispatchWakes.chainId, chainIds),
      )).all()
      : [];
    return {
      scope,
      scopeId,
      stopped: !!stop,
      stoppedAt: stop?.stoppedAt ?? null,
      stopReason: stop?.reason ?? null,
      wakeCount: chainRows.reduce((sum, chain) => sum + chain.wakeCount, 0),
      maxDepthSeen: chainRows.reduce((max, chain) => Math.max(max, chain.maxDepthSeen), 0),
      agents: [...new Set(wakes.map((wake) => wake.agentId))],
      limits: this.limits,
      budgetMetric: "successful_wakes",
      tokenUsageAvailable: false,
      chains: chainRows.map((chain) => ({
        id: chain.id,
        wakeCount: chain.wakeCount,
        maxDepthSeen: chain.maxDepthSeen,
        lastRejectionCode: chain.lastRejectionCode,
        lastRejectionReason: chain.lastRejectionReason,
        lastRejectedAt: chain.lastRejectedAt,
        lastRejectedMessageId: chain.lastRejectedMessageId,
        lastRejectedAgentId: chain.lastRejectedAgentId,
      })),
    };
  }
}
