import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { dbForSpace, schema } from "../db/index.js";

export const DEFAULT_MAX_DISPATCH_DEPTH = 4;
export const DEFAULT_MAX_DISPATCH_WAKES = 16;

export type TaskExecutionMode = "autopilot" | "plan-first";
export type DispatchBlockCode = "SPACE_STOPPED" | "TASK_STOPPED" | "DEPTH_LIMIT" | "WAKE_BUDGET";

export interface DispatchLimits {
  maxDepth: number;
  maxWakes: number;
}

export interface DispatchGuardInput {
  dispatchDepth: number;
  wakeCount: number;
  spaceStopped: boolean;
  taskStopped: boolean;
}

export interface DispatchDecision {
  allowed: boolean;
  code?: DispatchBlockCode;
  reason?: string;
}

export interface DispatchMessageContext {
  chainId: string;
  dispatchDepth: number;
  taskMessageId: string | null;
}

export type WakeReservation =
  | { allowed: true; reservationId: string; wakeCount: number }
  | { allowed: false; code: DispatchBlockCode; reason: string; wakeCount: number };

const configuredInt = (value: string | undefined, fallback: number, minimum: number): number => {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
};

export function readDispatchLimits(env: NodeJS.ProcessEnv = process.env): DispatchLimits {
  return {
    maxDepth: configuredInt(env.KITH_SPACE_MAX_DISPATCH_DEPTH, DEFAULT_MAX_DISPATCH_DEPTH, 0),
    maxWakes: configuredInt(env.KITH_SPACE_MAX_DISPATCH_WAKES, DEFAULT_MAX_DISPATCH_WAKES, 1),
  };
}

export function normalizeTaskExecutionMode(value: unknown): TaskExecutionMode | null {
  if (value == null || value === "") return "autopilot";
  return value === "autopilot" || value === "plan-first" ? value : null;
}

/** Pure guard decision. Wake count is deliberately a dispatch-count proxy: runtime adapters do not
 * currently expose structured token usage, so true token accounting remains a separate contract gap. */
export function decideDispatch(input: DispatchGuardInput, limits: DispatchLimits = readDispatchLimits()): DispatchDecision {
  if (input.spaceStopped) return { allowed: false, code: "SPACE_STOPPED", reason: "space dispatch is stopped" };
  if (input.taskStopped) return { allowed: false, code: "TASK_STOPPED", reason: "task dispatch is stopped" };
  if (input.dispatchDepth > limits.maxDepth) {
    return { allowed: false, code: "DEPTH_LIMIT", reason: `dispatch depth ${input.dispatchDepth} exceeds maximum ${limits.maxDepth}` };
  }
  if (input.wakeCount >= limits.maxWakes) {
    return { allowed: false, code: "WAKE_BUDGET", reason: `dispatch wake budget ${limits.maxWakes} is exhausted` };
  }
  return { allowed: true };
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
    const db = dbForSpace(this.spaceId);
    let result: WakeReservation = { allowed: false, code: "WAKE_BUDGET", reason: "dispatch chain not found", wakeCount: 0 };
    db.transaction((tx) => {
      const chain = tx.select().from(schema.dispatchChains).where(and(
        eq(schema.dispatchChains.id, input.chainId),
        eq(schema.dispatchChains.spaceId, this.spaceId),
      )).get();
      if (!chain) return;
      const spaceStopped = !!tx.select().from(schema.dispatchStops).where(and(
        eq(schema.dispatchStops.spaceId, this.spaceId),
        eq(schema.dispatchStops.scopeType, "space"),
        eq(schema.dispatchStops.scopeId, this.spaceId),
      )).get();
      const taskMessageId = input.taskMessageId ?? chain.taskMessageId;
      const taskStopped = !!(taskMessageId && tx.select().from(schema.dispatchStops).where(and(
        eq(schema.dispatchStops.spaceId, this.spaceId),
        eq(schema.dispatchStops.scopeType, "task"),
        eq(schema.dispatchStops.scopeId, taskMessageId),
      )).get());
      if (spaceStopped || taskStopped) {
        const decision = decideDispatch({ dispatchDepth: input.dispatchDepth, wakeCount: chain.wakeCount, spaceStopped, taskStopped }, this.limits);
        result = { allowed: false, code: decision.code!, reason: decision.reason!, wakeCount: chain.wakeCount };
        return;
      }
      const existing = tx.select().from(schema.dispatchWakes).where(and(
        eq(schema.dispatchWakes.spaceId, this.spaceId),
        eq(schema.dispatchWakes.chainId, input.chainId),
        eq(schema.dispatchWakes.messageId, input.messageId),
        eq(schema.dispatchWakes.targetAgentId, input.targetAgentId),
      )).get();
      if (existing) {
        result = { allowed: true, reservationId: existing.id, wakeCount: chain.wakeCount };
        return;
      }
      const decision = decideDispatch({
        dispatchDepth: input.dispatchDepth,
        wakeCount: chain.wakeCount,
        spaceStopped,
        taskStopped,
      }, this.limits);
      if (!decision.allowed) {
        tx.update(schema.dispatchChains).set({
          lastRejectionCode: decision.code!,
          lastRejectionReason: decision.reason!,
          lastRejectedAt: new Date(),
          lastRejectedMessageId: input.messageId,
          lastRejectedAgentId: input.targetAgentId,
          updatedAt: new Date(),
        }).where(eq(schema.dispatchChains.id, input.chainId)).run();
        result = { allowed: false, code: decision.code!, reason: decision.reason!, wakeCount: chain.wakeCount };
        return;
      }
      const reservationId = randomUUID();
      tx.update(schema.dispatchChains).set({
        wakeCount: sql`${schema.dispatchChains.wakeCount} + 1`,
        maxDepthSeen: Math.max(chain.maxDepthSeen, input.dispatchDepth),
        updatedAt: new Date(),
      }).where(eq(schema.dispatchChains.id, input.chainId)).run();
      tx.insert(schema.dispatchWakes).values({
        id: reservationId,
        spaceId: this.spaceId,
        chainId: input.chainId,
        messageId: input.messageId,
        targetAgentId: input.targetAgentId,
        dispatchDepth: input.dispatchDepth,
        status: "reserved",
      }).run();
      result = { allowed: true, reservationId, wakeCount: chain.wakeCount + 1 };
    });
    return result;
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
    db.transaction((tx) => {
      const wake = tx.select().from(schema.dispatchWakes).where(and(
        eq(schema.dispatchWakes.id, reservationId),
        eq(schema.dispatchWakes.spaceId, this.spaceId),
      )).get();
      if (!wake || wake.status !== "reserved") return;
      tx.delete(schema.dispatchWakes).where(eq(schema.dispatchWakes.id, reservationId)).run();
      tx.update(schema.dispatchChains).set({
        wakeCount: sql`max(${schema.dispatchChains.wakeCount} - 1, 0)`,
        updatedAt: new Date(),
      }).where(eq(schema.dispatchChains.id, wake.chainId)).run();
    });
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
