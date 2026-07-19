import { and, count, desc, eq } from "drizzle-orm";
import { dbForSpace, schema, type SpaceDb } from "../db/index.js";
import type { SpaceTransaction } from "../counters.js";
import { HarnessError } from "../harness/errors.js";
import type { RuntimeEventEnvelope } from "../runtime/contract/v2/runtimeContract.js";

export interface SessionCompactionMarker {
  revision: number;
  turnId: string;
  attemptId: string;
  eventOrdinal: number;
  eventCreatedAt: number;
}

/** Durable compaction marker backed by the append-only turn event rather than transient session timestamps. */
export class SessionCompactionMarkerService {
  constructor(private readonly spaceId: string, private readonly db: SpaceDb = dbForSpace(spaceId)) {}

  recordPersistedEvent(event: RuntimeEventEnvelope): SessionCompactionMarker {
    if (event.kind !== "compaction_completed") throw new HarnessError("session_generation_stale", "event is not a completed compaction marker");
    return this.db.transaction((tx) => {
      const turn = tx.select().from(schema.agentTurns).where(and(
        eq(schema.agentTurns.id, event.turnId),
        eq(schema.agentTurns.spaceId, this.spaceId),
        eq(schema.agentTurns.runtimeSessionId, event.sessionId),
        eq(schema.agentTurns.sessionGeneration, event.sessionGeneration),
      )).get();
      const attempt = tx.select().from(schema.agentTurnAttempts).where(and(
        eq(schema.agentTurnAttempts.id, event.attemptId),
        eq(schema.agentTurnAttempts.turnId, event.turnId),
      )).get();
      const persisted = tx.select().from(schema.agentTurnEvents).where(and(
        eq(schema.agentTurnEvents.attemptId, event.attemptId),
        eq(schema.agentTurnEvents.ordinal, event.ordinal),
        eq(schema.agentTurnEvents.kind, "compaction_completed"),
      )).get();
      const session = tx.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.id, event.sessionId)).get();
      if (!turn || !attempt || !persisted || !session || session.retiredAt) {
        throw new HarnessError("session_generation_stale", "compaction marker does not belong to a live persisted turn");
      }
      const revision = this.reconcileInTransaction(tx, session).revision;
      return {
        revision,
        turnId: turn.id,
        attemptId: attempt.id,
        eventOrdinal: persisted.ordinal,
        eventCreatedAt: persisted.createdAt.getTime(),
      };
    });
  }

  /** Repairs the projection from durable events at terminal/reconnect boundaries. */
  reconcile(sessionId: string, sessionGeneration: number): SessionCompactionMarker | null {
    return this.db.transaction((tx) => {
      const session = tx.select().from(schema.runtimeSessions).where(and(
        eq(schema.runtimeSessions.id, sessionId),
        eq(schema.runtimeSessions.spaceId, this.spaceId),
        eq(schema.runtimeSessions.sessionGeneration, sessionGeneration),
      )).get();
      if (!session || session.retiredAt) throw new HarnessError("session_generation_stale", "compaction reconciliation targets a stale session");
      return this.reconcileInTransaction(tx, session).marker;
    });
  }

  latestPending(session: typeof schema.runtimeSessions.$inferSelect): SessionCompactionMarker | null {
    if (session.compactionRevision <= session.contextCompactionRevision) return null;
    const marker = this.db.select({
      turnId: schema.agentTurnAttempts.turnId,
      attemptId: schema.agentTurnEvents.attemptId,
      eventOrdinal: schema.agentTurnEvents.ordinal,
      eventCreatedAt: schema.agentTurnEvents.createdAt,
    }).from(schema.agentTurnEvents)
      .innerJoin(schema.agentTurnAttempts, eq(schema.agentTurnAttempts.id, schema.agentTurnEvents.attemptId))
      .innerJoin(schema.agentTurns, eq(schema.agentTurns.id, schema.agentTurnAttempts.turnId))
      .where(and(
        eq(schema.agentTurns.runtimeSessionId, session.id),
        eq(schema.agentTurns.sessionGeneration, session.sessionGeneration),
        eq(schema.agentTurnEvents.kind, "compaction_completed"),
      )).orderBy(desc(schema.agentTurnEvents.createdAt), desc(schema.agentTurnEvents.ordinal)).limit(1).get();
    return marker ? {
      revision: session.compactionRevision,
      turnId: marker.turnId,
      attemptId: marker.attemptId,
      eventOrdinal: marker.eventOrdinal,
      eventCreatedAt: marker.eventCreatedAt.getTime(),
    } : null;
  }

  private markerCount(tx: SpaceTransaction, sessionId: string): number {
    const row = tx.select({ value: count() }).from(schema.agentTurnEvents)
      .innerJoin(schema.agentTurnAttempts, eq(schema.agentTurnAttempts.id, schema.agentTurnEvents.attemptId))
      .innerJoin(schema.agentTurns, eq(schema.agentTurns.id, schema.agentTurnAttempts.turnId))
      .where(and(
        eq(schema.agentTurns.runtimeSessionId, sessionId),
        eq(schema.agentTurnEvents.kind, "compaction_completed"),
      )).get();
    return Number(row?.value ?? 0);
  }

  private reconcileInTransaction(
    tx: SpaceTransaction,
    session: typeof schema.runtimeSessions.$inferSelect,
  ): { revision: number; marker: SessionCompactionMarker | null } {
    const total = this.markerCount(tx, session.id);
    const latest = tx.select({
      turnId: schema.agentTurnAttempts.turnId,
      attemptId: schema.agentTurnEvents.attemptId,
      eventOrdinal: schema.agentTurnEvents.ordinal,
      eventCreatedAt: schema.agentTurnEvents.createdAt,
    }).from(schema.agentTurnEvents)
      .innerJoin(schema.agentTurnAttempts, eq(schema.agentTurnAttempts.id, schema.agentTurnEvents.attemptId))
      .innerJoin(schema.agentTurns, eq(schema.agentTurns.id, schema.agentTurnAttempts.turnId))
      .where(and(
        eq(schema.agentTurns.runtimeSessionId, session.id),
        eq(schema.agentTurnEvents.kind, "compaction_completed"),
      )).orderBy(desc(schema.agentTurnEvents.createdAt), desc(schema.agentTurnEvents.ordinal)).limit(1).get();
    const revision = Math.max(session.compactionRevision, total);
    if (latest && (revision !== session.compactionRevision || session.lastCompactedAt?.getTime() !== latest.eventCreatedAt.getTime())) {
      tx.update(schema.runtimeSessions).set({ lastCompactedAt: latest.eventCreatedAt, compactionRevision: revision })
        .where(and(
          eq(schema.runtimeSessions.id, session.id),
          eq(schema.runtimeSessions.sessionGeneration, session.sessionGeneration),
        )).run();
    }
    return {
      revision,
      marker: latest ? {
        revision,
        turnId: latest.turnId,
        attemptId: latest.attemptId,
        eventOrdinal: latest.eventOrdinal,
        eventCreatedAt: latest.eventCreatedAt.getTime(),
      } : null,
    };
  }
}
