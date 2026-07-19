import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { dbForSpace, schema, type SpaceDb } from "../db/index.js";
import { HarnessError } from "../harness/errors.js";
import type { RuntimeEventEnvelope, RuntimeTurnResult } from "../runtime/contract/v2/runtimeContract.js";
import type { RuntimeSessionRecord } from "../sessions/sessionModule.js";

const ACTIVE_ATTEMPT_STATUSES = ["claimed", "admitted", "running", "finalizing"] as const;
export const MAX_TURN_EVENTS_PER_ATTEMPT = 2_000;
export const MAX_TURN_EVENT_PAYLOAD_BYTES = 64 * 1024;
export const MAX_TURN_EVENT_AGGREGATE_BYTES = 8 * 1024 * 1024;

export interface ClaimedAttempt {
  turn: typeof schema.agentTurns.$inferSelect;
  attempt: typeof schema.agentTurnAttempts.$inferSelect;
}

/** Core-owned logical turn, attempt lease, event, and retry state. */
export class TurnLedger {
  constructor(
    private readonly spaceId: string,
    private readonly db: SpaceDb = dbForSpace(spaceId),
    private readonly now: () => number = Date.now,
  ) {}

  bindPendingDeliveries(session: RuntimeSessionRecord, limit = 50): typeof schema.agentTurns.$inferSelect | null {
    return this.db.transaction((tx) => {
      const active = tx.select().from(schema.agentTurns).where(and(
        eq(schema.agentTurns.runtimeSessionId, session.id),
        inArray(schema.agentTurns.status, ["pending", "running", "retry_wait"]),
      )).get();
      if (active && active.status !== "pending") return null;
      const pending = tx.select().from(schema.agentDeliveryItems).where(and(
        eq(schema.agentDeliveryItems.spaceId, this.spaceId),
        eq(schema.agentDeliveryItems.agentId, session.agentId),
        eq(schema.agentDeliveryItems.targetSurfaceKind, session.surfaceKind),
        eq(schema.agentDeliveryItems.targetSurfaceId, session.surfaceId),
        eq(schema.agentDeliveryItems.disposition, "pending"),
        isNull(schema.agentDeliveryItems.turnId),
      )).orderBy(asc(schema.agentDeliveryItems.sourceSeq)).limit(limit).all();
      if (!pending.length) return active ?? null;
      const effectiveDirective = pending.some((delivery) => delivery.directive === "required") ? "required" : "optional";
      const turn = active ?? tx.insert(schema.agentTurns).values({
        id: randomUUID(),
        runtimeSessionId: session.id,
        sessionGeneration: session.sessionGeneration,
        spaceId: this.spaceId,
        agentId: session.agentId,
        effectiveDirective,
        status: "pending",
      }).returning().get();
      if (active?.effectiveDirective === "optional" && effectiveDirective === "required") {
        tx.update(schema.agentTurns).set({ effectiveDirective: "required" }).where(eq(schema.agentTurns.id, turn.id)).run();
      }
      tx.update(schema.agentDeliveryItems).set({
        disposition: "bound",
        turnId: turn.id,
        targetRuntimeSessionId: session.id,
      }).where(inArray(schema.agentDeliveryItems.id, pending.map((delivery) => delivery.id))).run();
      return tx.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, turn.id)).get()!;
    });
  }

  claimAttempt(input: {
    turnId: string;
    workerGeneration: number;
    leaseOwner: string;
    leaseMs: number;
  }): ClaimedAttempt {
    const nowMs = this.now();
    return this.db.transaction((tx) => {
      const turn = tx.select().from(schema.agentTurns).where(and(
        eq(schema.agentTurns.id, input.turnId),
        eq(schema.agentTurns.spaceId, this.spaceId),
      )).get();
      if (!turn || !["pending", "retry_wait"].includes(turn.status)) {
        throw new HarnessError("attempt_lease_conflict", "logical turn is not claimable", { turnId: input.turnId, status: turn?.status });
      }
      if (turn.nextAttemptAt && turn.nextAttemptAt.getTime() > nowMs) {
        throw new HarnessError("attempt_lease_conflict", "logical turn retry is not due", { turnId: input.turnId });
      }
      const live = tx.select().from(schema.agentTurnAttempts).where(and(
        eq(schema.agentTurnAttempts.turnId, turn.id),
        inArray(schema.agentTurnAttempts.status, [...ACTIVE_ATTEMPT_STATUSES]),
        gt(schema.agentTurnAttempts.leaseExpiresAt, new Date(nowMs)),
      )).get();
      if (live) {
        throw new HarnessError("attempt_lease_conflict", "logical turn already has a live attempt", {
          turnId: turn.id,
          attemptId: live.id,
        });
      }
      tx.update(schema.agentTurnAttempts).set({
        status: "lost",
        completedAt: new Date(nowMs),
        errorCode: "attempt_lease_expired",
      }).where(and(
        eq(schema.agentTurnAttempts.turnId, turn.id),
        inArray(schema.agentTurnAttempts.status, [...ACTIVE_ATTEMPT_STATUSES]),
        lte(schema.agentTurnAttempts.leaseExpiresAt, new Date(nowMs)),
      )).run();
      const previous = tx.select({ attemptNo: schema.agentTurnAttempts.attemptNo }).from(schema.agentTurnAttempts)
        .where(eq(schema.agentTurnAttempts.turnId, turn.id)).orderBy(desc(schema.agentTurnAttempts.attemptNo)).limit(1).get();
      const attemptNo = (previous?.attemptNo ?? 0) + 1;
      if (attemptNo > turn.maxAttempts) {
        tx.update(schema.agentTurns).set({ status: "failed", outcome: "failed", completedAt: new Date(nowMs) })
          .where(eq(schema.agentTurns.id, turn.id)).run();
        throw new HarnessError("attempt_lease_conflict", "logical turn exhausted its attempts", { turnId: turn.id });
      }
      const session = tx.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.id, turn.runtimeSessionId)).get();
      if (!session || session.retiredAt || session.sessionGeneration !== turn.sessionGeneration) {
        throw new HarnessError("session_generation_stale", "logical turn targets a retired session generation", { turnId: turn.id });
      }
      const attempt = tx.insert(schema.agentTurnAttempts).values({
        id: randomUUID(),
        turnId: turn.id,
        attemptNo,
        status: "claimed",
        workerGeneration: input.workerGeneration,
        leaseOwner: input.leaseOwner,
        leaseExpiresAt: new Date(nowMs + input.leaseMs),
        heartbeatAt: new Date(nowMs),
        engineSessionIdBefore: session.engineSessionId,
      }).returning().get();
      tx.update(schema.agentTurns).set({ status: "running", nextAttemptAt: null }).where(eq(schema.agentTurns.id, turn.id)).run();
      tx.update(schema.runtimeSessions).set({ status: "starting", lastTurnId: turn.id, updatedAt: new Date(nowMs) })
        .where(eq(schema.runtimeSessions.id, session.id)).run();
      return {
        turn: tx.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, turn.id)).get()!,
        attempt,
      };
    });
  }

  markAdmitted(attemptId: string): void {
    this.transitionAttempt(attemptId, "claimed", "admitted", { admittedAt: new Date(this.now()) });
  }

  markRunning(attemptId: string): void {
    this.transitionAttempt(attemptId, "admitted", "running", { startedAt: new Date(this.now()), heartbeatAt: new Date(this.now()) });
  }

  heartbeat(attemptId: string, leaseOwner: string, leaseMs: number): number {
    const now = this.now();
    const expiresAt = now + leaseMs;
    const updated = this.db.update(schema.agentTurnAttempts).set({
      heartbeatAt: new Date(now),
      leaseExpiresAt: new Date(expiresAt),
    }).where(and(
      eq(schema.agentTurnAttempts.id, attemptId),
      eq(schema.agentTurnAttempts.leaseOwner, leaseOwner),
      inArray(schema.agentTurnAttempts.status, ["admitted", "running", "finalizing"]),
      gt(schema.agentTurnAttempts.leaseExpiresAt, new Date(now)),
    )).run();
    if (!updated.changes) throw new HarnessError("attempt_lease_expired", "attempt heartbeat rejected", { attemptId });
    return expiresAt;
  }

  appendEvent(event: RuntimeEventEnvelope): boolean {
    if (!Number.isSafeInteger(event.ordinal) || event.ordinal < 0 || event.ordinal >= MAX_TURN_EVENTS_PER_ATTEMPT) {
      throw new HarnessError("context_capacity_exhausted", "Runtime event count exceeds the per-attempt limit", {
        attemptId: event.attemptId,
        ordinal: event.ordinal,
        limit: MAX_TURN_EVENTS_PER_ATTEMPT,
      });
    }
    const payloadBytes = Buffer.byteLength(JSON.stringify(event.payload), "utf8");
    if (payloadBytes > MAX_TURN_EVENT_PAYLOAD_BYTES) {
      throw new HarnessError("context_capacity_exhausted", "Runtime event payload exceeds the byte limit", {
        attemptId: event.attemptId,
        ordinal: event.ordinal,
        payloadBytes,
        limit: MAX_TURN_EVENT_PAYLOAD_BYTES,
      });
    }
    return this.db.transaction((tx) => {
      const attempt = tx.select().from(schema.agentTurnAttempts).where(eq(schema.agentTurnAttempts.id, event.attemptId)).get();
      if (!attempt || attempt.turnId !== event.turnId) {
        throw new HarnessError("attempt_lease_conflict", "Runtime event targets another attempt", { attemptId: event.attemptId });
      }
      const turn = tx.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, attempt.turnId)).get();
      if (!turn || turn.runtimeSessionId !== event.sessionId || turn.sessionGeneration !== event.sessionGeneration) {
        throw new HarnessError("session_generation_stale", "Runtime event targets another session generation", { attemptId: event.attemptId });
      }
      if (attempt.workerGeneration !== event.workerGeneration) {
        throw new HarnessError("worker_generation_stale", "Runtime event targets another Worker generation", { attemptId: event.attemptId });
      }
      if (!["admitted", "running", "finalizing"].includes(attempt.status) || attempt.leaseExpiresAt.getTime() <= this.now()) {
        throw new HarnessError("attempt_lease_expired", "Runtime event has no live attempt lease", { attemptId: event.attemptId });
      }
      const last = tx.select({ ordinal: schema.agentTurnEvents.ordinal }).from(schema.agentTurnEvents)
        .where(eq(schema.agentTurnEvents.attemptId, attempt.id)).orderBy(desc(schema.agentTurnEvents.ordinal)).limit(1).get();
      const expected = (last?.ordinal ?? -1) + 1;
      if (event.ordinal !== expected) {
        const existing = tx.select().from(schema.agentTurnEvents).where(and(
          eq(schema.agentTurnEvents.attemptId, attempt.id),
          eq(schema.agentTurnEvents.ordinal, event.ordinal),
        )).get();
        if (existing && existing.kind === event.kind && JSON.stringify(existing.payload) === JSON.stringify(event.payload)) return false;
        throw new HarnessError("attempt_lease_conflict", "Runtime event ordinal is not contiguous", { expected, actual: event.ordinal });
      }
      if (attempt.eventCount >= MAX_TURN_EVENTS_PER_ATTEMPT
        || attempt.eventPayloadBytes + payloadBytes > MAX_TURN_EVENT_AGGREGATE_BYTES) {
        throw new HarnessError("context_capacity_exhausted", "Runtime event stream exceeds the per-attempt aggregate limit", {
          attemptId: event.attemptId,
          eventCount: attempt.eventCount,
          eventPayloadBytes: attempt.eventPayloadBytes,
        });
      }
      tx.insert(schema.agentTurnEvents).values({
        attemptId: attempt.id,
        ordinal: event.ordinal,
        kind: event.kind,
        payload: event.payload,
        createdAt: new Date(event.createdAt),
      }).run();
      tx.update(schema.agentTurnAttempts).set({
        eventCount: attempt.eventCount + 1,
        eventPayloadBytes: attempt.eventPayloadBytes + payloadBytes,
      }).where(eq(schema.agentTurnAttempts.id, attempt.id)).run();
      if (event.kind === "session_changed") {
        const engineSessionId = typeof event.payload.engineSessionId === "string" ? event.payload.engineSessionId : null;
        if (!engineSessionId) throw new HarnessError("session_generation_stale", "session_changed is missing engineSessionId");
        tx.update(schema.runtimeSessions).set({ engineSessionId, updatedAt: new Date(this.now()) })
          .where(and(eq(schema.runtimeSessions.id, event.sessionId), eq(schema.runtimeSessions.sessionGeneration, event.sessionGeneration), isNull(schema.runtimeSessions.retiredAt))).run();
      }
      return true;
    });
  }

  markRuntimeTerminal(attemptId: string, result: RuntimeTurnResult): void {
    const now = new Date(this.now());
    this.db.transaction((tx) => {
      const attempt = tx.select().from(schema.agentTurnAttempts).where(eq(schema.agentTurnAttempts.id, attemptId)).get();
      if (!attempt || !["running", "admitted"].includes(attempt.status)) {
        throw new HarnessError("attempt_lease_conflict", "attempt is not running", { attemptId, status: attempt?.status });
      }
      if (attempt.leaseExpiresAt.getTime() <= now.getTime()) {
        throw new HarnessError("attempt_lease_expired", "runtime terminal has no live attempt lease", { attemptId });
      }
      if (result.outcome === "completed") {
        tx.update(schema.agentTurnAttempts).set({
          status: "finalizing",
          engineSessionIdAfter: result.engineSessionId,
          usage: result.usage ?? null,
          heartbeatAt: now,
        }).where(eq(schema.agentTurnAttempts.id, attemptId)).run();
        return;
      }
      this.failInTransaction(tx, attempt, result.errorCode ?? `runtime_${result.outcome}`, result.outcome === "cancelled");
    });
  }

  failAttempt(attemptId: string, errorCode: string): void {
    this.db.transaction((tx) => {
      const attempt = tx.select().from(schema.agentTurnAttempts).where(eq(schema.agentTurnAttempts.id, attemptId)).get();
      if (!attempt || !ACTIVE_ATTEMPT_STATUSES.includes(attempt.status as typeof ACTIVE_ATTEMPT_STATUSES[number])) return;
      this.failInTransaction(tx, attempt, errorCode, false);
    });
  }

  cancelAttempt(attemptId: string, errorCode: string, requeueUnsettled = true): void {
    this.db.transaction((tx) => {
      const attempt = tx.select().from(schema.agentTurnAttempts).where(eq(schema.agentTurnAttempts.id, attemptId)).get();
      if (!attempt || !ACTIVE_ATTEMPT_STATUSES.includes(attempt.status as typeof ACTIVE_ATTEMPT_STATUSES[number])) return;
      const now = new Date(this.now());
      const turn = tx.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, attempt.turnId)).get();
      if (!turn) return;
      tx.update(schema.agentTurnAttempts).set({
        status: "cancelled",
        errorCode,
        completedAt: now,
      }).where(eq(schema.agentTurnAttempts.id, attempt.id)).run();
      tx.update(schema.agentTurns).set({
        status: "cancelled",
        outcome: "cancelled",
        nextAttemptAt: null,
        completedAt: now,
      }).where(eq(schema.agentTurns.id, turn.id)).run();
      if (requeueUnsettled) {
        tx.update(schema.agentDeliveryItems).set({
          disposition: "pending",
          turnId: null,
          targetRuntimeSessionId: null,
          settledAt: null,
        }).where(and(
          eq(schema.agentDeliveryItems.turnId, turn.id),
          inArray(schema.agentDeliveryItems.disposition, ["pending", "bound"]),
        )).run();
      }
      tx.update(schema.runtimeSessions).set({ status: "idle", updatedAt: now, lastActiveAt: now })
        .where(eq(schema.runtimeSessions.id, turn.runtimeSessionId)).run();
    });
  }

  retirePendingTurn(turnId: string, _errorCode: string): boolean {
    return this.db.transaction((tx) => {
      const turn = tx.select().from(schema.agentTurns).where(and(
        eq(schema.agentTurns.id, turnId),
        eq(schema.agentTurns.spaceId, this.spaceId),
        inArray(schema.agentTurns.status, ["pending", "retry_wait"]),
      )).get();
      if (!turn) return false;
      const now = new Date(this.now());
      tx.update(schema.agentTurns).set({
        status: "cancelled",
        outcome: "cancelled",
        nextAttemptAt: null,
        completedAt: now,
      }).where(eq(schema.agentTurns.id, turn.id)).run();
      tx.update(schema.agentDeliveryItems).set({
        disposition: "pending",
        turnId: null,
        targetRuntimeSessionId: null,
        settledAt: null,
      }).where(and(
        eq(schema.agentDeliveryItems.turnId, turn.id),
        inArray(schema.agentDeliveryItems.disposition, ["pending", "bound"]),
      )).run();
      tx.update(schema.runtimeSessions).set({ status: "idle", updatedAt: now, lastActiveAt: now })
        .where(eq(schema.runtimeSessions.id, turn.runtimeSessionId)).run();
      return true;
    });
  }

  recoverExpiredAttempts(): number {
    const expired = this.db.select().from(schema.agentTurnAttempts).where(and(
      inArray(schema.agentTurnAttempts.status, [...ACTIVE_ATTEMPT_STATUSES]),
      lte(schema.agentTurnAttempts.leaseExpiresAt, new Date(this.now())),
    )).all();
    for (const attempt of expired) {
      this.db.transaction((tx) => {
        const current = tx.select().from(schema.agentTurnAttempts).where(eq(schema.agentTurnAttempts.id, attempt.id)).get();
        if (!current || !ACTIVE_ATTEMPT_STATUSES.includes(current.status as typeof ACTIVE_ATTEMPT_STATUSES[number])) return;
        this.failInTransaction(tx, current, "attempt_lease_expired", false, true);
      });
    }
    return expired.length;
  }

  private transitionAttempt(
    attemptId: string,
    from: typeof schema.agentTurnAttempts.$inferSelect.status,
    to: typeof schema.agentTurnAttempts.$inferSelect.status,
    patch: Partial<typeof schema.agentTurnAttempts.$inferInsert>,
  ): void {
    const updated = this.db.update(schema.agentTurnAttempts).set({ status: to, ...patch }).where(and(
      eq(schema.agentTurnAttempts.id, attemptId),
      eq(schema.agentTurnAttempts.status, from),
      gt(schema.agentTurnAttempts.leaseExpiresAt, new Date(this.now())),
    )).run();
    if (!updated.changes) throw new HarnessError("attempt_lease_conflict", `attempt cannot transition ${from} → ${to}`, { attemptId });
  }

  private failInTransaction(
    tx: Parameters<Parameters<SpaceDb["transaction"]>[0]>[0],
    attempt: typeof schema.agentTurnAttempts.$inferSelect,
    errorCode: string,
    cancelled: boolean,
    lost = false,
  ): void {
    const now = new Date(this.now());
    tx.update(schema.agentTurnAttempts).set({
      status: cancelled ? "cancelled" : lost ? "lost" : "failed",
      errorCode,
      completedAt: now,
    }).where(eq(schema.agentTurnAttempts.id, attempt.id)).run();
    const turn = tx.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, attempt.turnId)).get()!;
    const terminal = cancelled || attempt.attemptNo >= turn.maxAttempts;
    tx.update(schema.agentTurns).set(terminal ? {
      status: cancelled ? "cancelled" : "failed",
      outcome: cancelled ? "cancelled" : "failed",
      completedAt: now,
    } : {
      status: "retry_wait",
      nextAttemptAt: new Date(now.getTime() + Math.min(30_000, 1_000 * 2 ** (attempt.attemptNo - 1))),
    }).where(eq(schema.agentTurns.id, turn.id)).run();
    if (cancelled) {
      tx.update(schema.agentDeliveryItems).set({
        disposition: "pending",
        turnId: null,
        targetRuntimeSessionId: null,
        settledAt: null,
      }).where(and(
        eq(schema.agentDeliveryItems.turnId, turn.id),
        inArray(schema.agentDeliveryItems.disposition, ["pending", "bound"]),
      )).run();
    }
    tx.update(schema.runtimeSessions).set({ status: "idle", updatedAt: now, lastActiveAt: now })
      .where(eq(schema.runtimeSessions.id, turn.runtimeSessionId)).run();
  }
}
