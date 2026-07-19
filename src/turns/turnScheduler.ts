import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type { AgentConfig } from "../daemon/agentManager.js";
import { dbForSpace, schema } from "../db/index.js";
import { HarnessError } from "../harness/errors.js";
import { createLogger } from "../log.js";
import { WorkerAdmissionUncertainError } from "../local-runtime/workerHub.js";
import type { RuntimeWorkerPort } from "../runtime/contract/runtimeWorkerPort.js";
import { RUNTIME_V2_CAPABILITY_MATRIX } from "../runtime/adapters/runtimeV2CapabilityMatrix.js";
import { SessionModule, type RuntimeSessionRecord } from "../sessions/sessionModule.js";
import { coreLoopbackUrl } from "../server/localEndpoint.js";
import { TurnCapabilityService, type PreparedTurnCapability } from "../capabilities/turnCapabilityService.js";
import { ContextAssembler, inferContinuityMode } from "../context/contextAssembler.js";
import { TurnLedger } from "./turnLedger.js";
import { revokeExpiredTaskScopedAccess } from "../channels/taskScopedAccess.js";
import { assertAgentSurfaceAccessInTransaction } from "../channels/agentSurfaceAccess.js";
import { SessionWakeupService } from "../sessions/sessionWakeupService.js";
import { SessionSnapshotService } from "../sessions/sessionSnapshotService.js";
import type { RuntimeSessionSnapshot } from "../runtime/contract/sessionSnapshot.js";

const LEASE_MS = Number(process.env.KITH_SPACE_TURN_LEASE_MS ?? 90_000);
const HEARTBEAT_MS = Math.max(1_000, Math.min(30_000, Math.floor(LEASE_MS / 3)));
const TURN_DEADLINE_MS = Number(process.env.KITH_SPACE_TURN_DEADLINE_MS ?? 10 * 60_000);
const DISPATCH_BATCH_LIMIT = 8;

export interface HarnessTurnSchedulerOptions {
  runtimeWorker: RuntimeWorkerPort;
  capabilities: (spaceId: string) => TurnCapabilityService;
  agentConfig: (spaceId: string, agentId: string) => Promise<AgentConfig | null>;
  dispatch?: {
    preparePending(spaceId: string): Promise<void>;
    commitTurn(spaceId: string, turnId: string): Promise<void>;
    releaseTurn(spaceId: string, turnId: string): Promise<void>;
  };
  onRequiredTurnCancelled?: (input: {
    spaceId: string;
    agentId: string;
    agentName: string;
    surfaceId: string;
    turnId: string;
    reason: string;
  }) => Promise<void>;
  now?: () => number;
}

/** Core-owned durable delivery → logical turn → leased Worker attempt scheduler. */
export class HarnessTurnScheduler {
  private readonly spaceQueue: string[] = [];
  private readonly queuedSpaces = new Set<string>();
  private readonly spaceWaiters = new Map<string, Array<{ resolve: () => void; reject: (error: unknown) => void }>>();
  private drainPromise: Promise<void> | null = null;
  private readonly heartbeats = new Map<string, ReturnType<typeof setInterval>>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly retryDeadlines = new Map<string, number>();
  private readonly now: () => number;
  private shuttingDown = false;
  private readonly log = createLogger("turns:scheduler");

  constructor(private readonly options: HarnessTurnSchedulerOptions) {
    this.now = options.now ?? Date.now;
  }

  schedule(spaceId: string): Promise<void> {
    if (this.shuttingDown) return Promise.resolve();
    const result = new Promise<void>((resolve, reject) => {
      const waiters = this.spaceWaiters.get(spaceId) ?? [];
      waiters.push({ resolve, reject });
      this.spaceWaiters.set(spaceId, waiters);
    });
    if (!this.queuedSpaces.has(spaceId)) {
      this.queuedSpaces.add(spaceId);
      this.spaceQueue.push(spaceId);
    }
    if (!this.drainPromise) this.drainPromise = this.drainSpaces();
    return result;
  }

  finishAttempt(spaceId: string, attemptId: string): void {
    const heartbeat = this.heartbeats.get(attemptId);
    if (heartbeat) clearInterval(heartbeat);
    this.heartbeats.delete(attemptId);
    void this.schedule(spaceId);
  }

  cancelRevokedAttempts(attempts: readonly { id: string; workerGeneration: number }[]): void {
    for (const attempt of attempts) {
      const heartbeat = this.heartbeats.get(attempt.id);
      if (heartbeat) clearInterval(heartbeat);
      this.heartbeats.delete(attempt.id);
      this.options.runtimeWorker.cancelTurn({
        type: "agent:turn:cancel",
        generation: attempt.workerGeneration,
        attemptId: attempt.id,
      });
    }
  }

  async cancelAgent(spaceId: string, agentId: string): Promise<void> {
    const availability = this.options.runtimeWorker.availability();
    const db = dbForSpace(spaceId);
    const attempts = db.select({
      id: schema.agentTurnAttempts.id,
      turnId: schema.agentTurns.id,
      runtimeSessionId: schema.agentTurns.runtimeSessionId,
      effectiveDirective: schema.agentTurns.effectiveDirective,
    }).from(schema.agentTurnAttempts)
      .innerJoin(schema.agentTurns, eq(schema.agentTurns.id, schema.agentTurnAttempts.turnId))
      .where(and(
        eq(schema.agentTurns.agentId, agentId),
        inArray(schema.agentTurnAttempts.status, ["claimed", "admitted", "running", "finalizing"]),
      )).all();
    for (const attempt of attempts) {
      if (availability.generation !== null) {
        this.options.runtimeWorker.cancelTurn({ type: "agent:turn:cancel", generation: availability.generation, attemptId: attempt.id });
      }
      this.options.capabilities(spaceId).revokeAttempt(attempt.id);
      const ledger = new TurnLedger(spaceId, db, this.now);
      ledger.cancelAttempt(attempt.id, "agent_stopped", true);
      if (attempt.effectiveDirective === "required" && this.options.onRequiredTurnCancelled) {
        const session = db.select({ surfaceId: schema.runtimeSessions.surfaceId }).from(schema.runtimeSessions)
          .where(eq(schema.runtimeSessions.id, attempt.runtimeSessionId)).get();
        const agent = db.select({ name: schema.agents.name, displayName: schema.agents.displayName }).from(schema.agents)
          .where(eq(schema.agents.id, agentId)).get();
        if (session && agent) {
          await this.options.onRequiredTurnCancelled({
            spaceId,
            agentId,
            agentName: agent.displayName || agent.name,
            surfaceId: session.surfaceId,
            turnId: attempt.turnId,
            reason: "Agent stopped before completing this reply",
          }).catch((error) => {
            this.log.warn("failed to close cancelled turn reply preview", {
              spaceId,
              agentId,
              turnId: attempt.turnId,
              detail: error instanceof Error ? error.message : String(error),
            });
          });
        }
      }
      const heartbeat = this.heartbeats.get(attempt.id);
      if (heartbeat) clearInterval(heartbeat);
      this.heartbeats.delete(attempt.id);
    }
    const pendingTurns = db.select({ id: schema.agentTurns.id }).from(schema.agentTurns).where(and(
      eq(schema.agentTurns.agentId, agentId),
      inArray(schema.agentTurns.status, ["pending", "retry_wait"]),
    )).all();
    const ledger = new TurnLedger(spaceId, db, this.now);
    for (const turn of pendingTurns) ledger.retirePendingTurn(turn.id, "agent_stopped");
  }

  async closeAgentSessions(spaceId: string, agentId: string, reason: "stop" | "reset"): Promise<void> {
    const admission = await this.options.runtimeWorker.closeTurnSessions({
      type: "agent:turn:sessions:close",
      source: "turn",
      commandId: randomUUID(),
      spaceId,
      agentId,
      reason,
    });
    if (admission.status !== "admitted") throw new Error(admission.reason ?? "Worker rejected v2 session close");
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const timer of this.heartbeats.values()) clearInterval(timer);
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.heartbeats.clear();
    this.retryTimers.clear();
    this.retryDeadlines.clear();
    await this.drainPromise;
  }

  private async drainSpaces(): Promise<void> {
    try {
      while (this.spaceQueue.length) {
        const spaceId = this.spaceQueue.shift()!;
        this.queuedSpaces.delete(spaceId);
        const waiters = this.spaceWaiters.get(spaceId) ?? [];
        this.spaceWaiters.delete(spaceId);
        try {
          await this.runSpace(spaceId);
          for (const waiter of waiters) waiter.resolve();
        } catch (error) {
          for (const waiter of waiters) waiter.reject(error);
        }
      }
    } finally {
      this.drainPromise = null;
      if (this.spaceQueue.length) this.drainPromise = this.drainSpaces();
    }
  }

  private async runSpace(spaceId: string): Promise<void> {
    const availability = this.options.runtimeWorker.availability();
    if (!availability.connected || availability.generation === null) return;
    const ledger = new TurnLedger(spaceId, dbForSpace(spaceId), this.now);
    const wakeups = await new SessionWakeupService(spaceId, dbForSpace(spaceId), this.now).fireDue();
    if (wakeups.fired || wakeups.cancelled) this.log.info("processed session wakeups", { spaceId, ...wakeups });
    if (wakeups.nextDueAt !== null) this.armAt(spaceId, wakeups.nextDueAt);
    const recovered = ledger.recoverExpiredAttempts();
    this.options.capabilities(spaceId).expireStaleActivations();
    if (recovered) this.log.info("recovered expired turn attempts", { spaceId, recovered });
    await this.options.dispatch?.preparePending(spaceId);
    await this.bindPending(spaceId);
    const db = dbForSpace(spaceId);
    const due = db.select().from(schema.agentTurns).where(or(
      eq(schema.agentTurns.status, "pending"),
      and(eq(schema.agentTurns.status, "retry_wait"), or(isNull(schema.agentTurns.nextAttemptAt), lte(schema.agentTurns.nextAttemptAt, new Date(this.now())))),
    )).orderBy(asc(schema.agentTurns.createdAt)).all();
    const seenAgents = new Set<string>();
    const batch = due.filter((turn) => {
      if (seenAgents.has(turn.agentId) || seenAgents.size >= DISPATCH_BATCH_LIMIT) return false;
      seenAgents.add(turn.agentId);
      return true;
    });
    for (const turn of batch) {
      const live = this.options.runtimeWorker.availability();
      if (!live.connected || live.generation !== availability.generation) return;
      await this.dispatch(spaceId, turn.id, live.generation);
    }
    this.armNext(spaceId);
    if (due.length > batch.length) this.armAt(spaceId, this.now() + 1);
  }

  private async bindPending(spaceId: string): Promise<void> {
    const db = dbForSpace(spaceId);
    const pending = db.select({
      agentId: schema.agentDeliveryItems.agentId,
      surfaceKind: schema.agentDeliveryItems.targetSurfaceKind,
      surfaceId: schema.agentDeliveryItems.targetSurfaceId,
    }).from(schema.agentDeliveryItems).where(and(
      eq(schema.agentDeliveryItems.spaceId, spaceId),
      eq(schema.agentDeliveryItems.disposition, "pending"),
      isNull(schema.agentDeliveryItems.turnId),
    )).groupBy(
      schema.agentDeliveryItems.agentId,
      schema.agentDeliveryItems.targetSurfaceKind,
      schema.agentDeliveryItems.targetSurfaceId,
    ).all();
    for (const target of pending) {
      const agent = db.select({ status: schema.agents.status }).from(schema.agents).where(eq(schema.agents.id, target.agentId)).get();
      if (agent?.status !== "active") continue;
      const config = await this.options.agentConfig(spaceId, target.agentId);
      if (!config || !isSupportedRuntime(config.runtime)) continue;
      const matrix = RUNTIME_V2_CAPABILITY_MATRIX[config.runtime];
      try {
        const session = new SessionModule(spaceId, db).ensureSession({
          address: { spaceId, agentId: target.agentId, surfaceKind: target.surfaceKind, surfaceId: target.surfaceId },
          runtime: config.runtime,
          model: config.model ?? null,
          runtimeConfig: config.runtimeConfig ?? null,
          adapterVersion: matrix.adapterVersion,
          workspaceRootFingerprint: createHash("sha256").update(config.workspaceRoot).digest("hex"),
          allowWorkspaceRelocationResume: matrix.capabilities.cwdRelocatableResume,
        });
        new TurnLedger(spaceId, db, this.now).bindPendingDeliveries(session);
      } catch (error) {
        if (error instanceof HarnessError && error.code === "attempt_lease_conflict") {
          this.log.debug("delivery waits for the current session generation to finish", { spaceId, agentId: target.agentId, surfaceId: target.surfaceId });
          continue;
        }
        throw error;
      }
    }
  }

  private async dispatch(spaceId: string, turnId: string, generation: number): Promise<void> {
    const db = dbForSpace(spaceId);
    const turn = db.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, turnId)).get();
    if (!turn) return;
    const session = db.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.id, turn.runtimeSessionId)).get();
    if (!session || session.retiredAt) return;
    const config = await this.options.agentConfig(spaceId, turn.agentId);
    const agent = db.select({ status: schema.agents.status }).from(schema.agents).where(eq(schema.agents.id, turn.agentId)).get();
    const ledger = new TurnLedger(spaceId, db, this.now);
    if (agent?.status !== "active") {
      ledger.retirePendingTurn(turn.id, "agent_inactive");
      return;
    }
    if (!config || !isSupportedRuntime(config.runtime) || config.runtime !== session.runtime) {
      this.log.warn("turn runtime is unavailable", { spaceId, turnId, agentId: turn.agentId, runtime: config?.runtime });
      ledger.retirePendingTurn(turn.id, "runtime_configuration_changed");
      if (config && isSupportedRuntime(config.runtime)) this.armAt(spaceId, this.now() + 1);
      return;
    }
    const capabilityService = this.options.capabilities(spaceId);
    const expiredScope = revokeExpiredTaskScopedAccess(spaceId, session.surfaceId, turn.agentId, db, this.now());
    if (expiredScope.count) {
      capabilityService.closeSessions(expiredScope.sessionIds);
      this.cancelRevokedAttempts(expiredScope.attempts);
      this.log.info("expired task-scoped turn was revoked before context assembly", {
        spaceId, turnId, agentId: turn.agentId, surfaceId: session.surfaceId,
      });
      return;
    }
    try {
      db.transaction((tx) => assertAgentSurfaceAccessInTransaction(tx, {
        spaceId,
        channelId: session.surfaceId,
        agentId: turn.agentId,
        now: this.now(),
      }));
    } catch (error) {
      this.log.warn("turn surface access was denied before context assembly", {
        spaceId, turnId, agentId: turn.agentId, surfaceId: session.surfaceId, detail: errorMessage(error),
      });
      return;
    }
    const owner = `core-worker-${generation}`;
    const restoredSnapshot = new SessionSnapshotService(spaceId, db).load(session.id);
    const continuityMode = restoredSnapshot?.adapterSnapshot?.payload.resumable === false
      ? "resume_failed"
      : inferContinuityMode(session);
    let claimed: ReturnType<TurnLedger["claimAttempt"]>;
    try {
      claimed = ledger.claimAttempt({ turnId, workerGeneration: generation, leaseOwner: owner, leaseMs: LEASE_MS });
    } catch (error) {
      if (error instanceof HarnessError && error.code === "attempt_lease_conflict") return;
      throw error;
    }
    let prepared: PreparedTurnCapability | null = null;
    const deadlineAt = this.now() + TURN_DEADLINE_MS;
    try {
      prepared = capabilityService.prepare(claimed.attempt.id);
      const assembled = new ContextAssembler(spaceId, db, this.now).assemble(
        turn.id,
        prepared.claims.activationId,
        continuityMode,
      );
      const admission = await this.options.runtimeWorker.admitTurn({
        type: "agent:turn:admit",
        source: "turn",
        commandId: claimed.attempt.id,
        spaceId,
        agentId: turn.agentId,
        config,
        session: sessionDescriptor(session, restoredSnapshot),
        broker: { sessionHandle: prepared.sessionHandle, endpoint: coreLoopbackUrl() },
        turn: {
          turnId: turn.id,
          attemptId: claimed.attempt.id,
          context: assembled.renderedContext,
          capabilityActivationId: prepared.claims.activationId,
          deadlineAt,
        },
      });
      if (admission.status !== "admitted") throw new Error(admission.reason ?? `turn admission ${admission.status}`);
      ledger.markAdmitted(claimed.attempt.id);
      await this.options.dispatch?.commitTurn(spaceId, turn.id);
      capabilityService.activate(prepared);
      if (!this.options.runtimeWorker.activateTurn({
        type: "agent:turn:activate",
        generation,
        attemptId: claimed.attempt.id,
        activationId: prepared.claims.activationId,
      })) throw new Error("Worker disconnected before turn activation");
      ledger.markRunning(claimed.attempt.id);
      this.trackHeartbeat(spaceId, claimed.attempt.id, owner, generation, deadlineAt);
    } catch (error) {
      if (error instanceof WorkerAdmissionUncertainError) {
        this.log.warn("turn admission uncertain; lease recovery will decide", { spaceId, turnId, attemptId: claimed.attempt.id, generation });
        this.armAt(spaceId, claimed.attempt.leaseExpiresAt.getTime());
        return;
      }
      if (prepared) capabilityService.revokeAttempt(claimed.attempt.id);
      await this.options.dispatch?.releaseTurn(spaceId, turn.id).catch(() => {});
      ledger.failAttempt(claimed.attempt.id, "turn_admission_failed");
      this.log.warn("turn dispatch failed", { spaceId, turnId, attemptId: claimed.attempt.id, detail: errorMessage(error) });
    }
  }

  private trackHeartbeat(spaceId: string, attemptId: string, owner: string, generation: number, deadlineAt: number): void {
    const prior = this.heartbeats.get(attemptId);
    if (prior) clearInterval(prior);
    const timer = setInterval(() => {
      const live = this.options.runtimeWorker.availability();
      if (this.revokeExpiredAttemptScope(spaceId, attemptId)) return;
      if (this.now() >= deadlineAt) {
        clearInterval(timer);
        this.heartbeats.delete(attemptId);
        this.options.runtimeWorker.cancelTurn({ type: "agent:turn:cancel", generation, attemptId });
        this.options.capabilities(spaceId).revokeAttempt(attemptId);
        new TurnLedger(spaceId, undefined, this.now).failAttempt(attemptId, "turn_deadline_exceeded");
        void this.schedule(spaceId);
        return;
      }
      if (!live.connected || live.generation !== generation) {
        clearInterval(timer);
        this.heartbeats.delete(attemptId);
        this.armAt(spaceId, this.now() + LEASE_MS);
        return;
      }
      try {
        const expiresAt = new TurnLedger(spaceId, undefined, this.now).heartbeat(attemptId, owner, LEASE_MS);
        this.options.capabilities(spaceId).renewAttempt(attemptId, expiresAt);
      } catch {
        clearInterval(timer);
        this.heartbeats.delete(attemptId);
        this.options.runtimeWorker.cancelTurn({ type: "agent:turn:cancel", generation, attemptId });
        void this.schedule(spaceId);
      }
    }, HEARTBEAT_MS);
    timer.unref?.();
    this.heartbeats.set(attemptId, timer);
  }

  private revokeExpiredAttemptScope(spaceId: string, attemptId: string): boolean {
    const db = dbForSpace(spaceId);
    const attempt = db.select({ turnId: schema.agentTurnAttempts.turnId }).from(schema.agentTurnAttempts)
      .where(eq(schema.agentTurnAttempts.id, attemptId)).get();
    const turn = attempt ? db.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, attempt.turnId)).get() : null;
    const session = turn ? db.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.id, turn.runtimeSessionId)).get() : null;
    if (!turn || !session) return false;
    const revoked = revokeExpiredTaskScopedAccess(spaceId, session.surfaceId, turn.agentId, db, this.now());
    if (!revoked.count) return false;
    this.options.capabilities(spaceId).closeSessions(revoked.sessionIds);
    this.cancelRevokedAttempts(revoked.attempts);
    this.log.info("running task-scoped turn expired and was cancelled", {
      spaceId, turnId: turn.id, attemptId, agentId: turn.agentId, surfaceId: session.surfaceId,
    });
    return true;
  }

  private armNext(spaceId: string): void {
    const db = dbForSpace(spaceId);
    const nextRetry = db.select({ at: schema.agentTurns.nextAttemptAt }).from(schema.agentTurns)
      .where(and(eq(schema.agentTurns.status, "retry_wait"), isNull(schema.agentTurns.completedAt)))
      .orderBy(asc(schema.agentTurns.nextAttemptAt)).limit(1).get()?.at;
    const nextLease = db.select({ at: schema.agentTurnAttempts.leaseExpiresAt }).from(schema.agentTurnAttempts)
      .where(inArray(schema.agentTurnAttempts.status, ["claimed", "admitted", "running", "finalizing"]))
      .orderBy(asc(schema.agentTurnAttempts.leaseExpiresAt)).limit(1).get()?.at;
    const at = Math.min(nextRetry?.getTime() ?? Infinity, nextLease?.getTime() ?? Infinity);
    if (Number.isFinite(at)) this.armAt(spaceId, at);
  }

  private armAt(spaceId: string, at: number): void {
    if (this.shuttingDown) return;
    const existing = this.retryTimers.get(spaceId);
    const existingAt = this.retryDeadlines.get(spaceId);
    if (existing && existingAt !== undefined && existingAt <= at) return;
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.retryTimers.delete(spaceId);
      this.retryDeadlines.delete(spaceId);
      void this.schedule(spaceId);
    }, Math.max(1, at - this.now() + 5));
    timer.unref?.();
    this.retryTimers.set(spaceId, timer);
    this.retryDeadlines.set(spaceId, at);
  }
}

function isSupportedRuntime(runtime: string | undefined): runtime is keyof typeof RUNTIME_V2_CAPABILITY_MATRIX {
  return runtime === "claude" || runtime === "codex" || runtime === "opencode";
}

function sessionDescriptor(session: RuntimeSessionRecord, snapshot: RuntimeSessionSnapshot | null) {
  return {
    id: session.id,
    spaceId: session.spaceId,
    agentId: session.agentId,
    surfaceKind: session.surfaceKind,
    surfaceId: session.surfaceId,
    sessionGeneration: session.sessionGeneration,
    runtime: session.runtime,
    engineSessionId: snapshot?.adapterSnapshot?.payload.resumable === false ? null : session.engineSessionId,
    snapshotVersion: session.snapshotVersion,
    restoredSnapshot: snapshot,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
