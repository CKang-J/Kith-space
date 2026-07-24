import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import type { SpaceTransaction } from "../counters.js";
import { dbForSpace, schema, type SpaceDb } from "../db/index.js";

export interface RevokedTaskScopedAccess {
  count: number;
  sessionIds: string[];
  attempts: Array<{ id: string; workerGeneration: number }>;
}

/** Task terminal transition revokes its bounded thread grant in the same workspace transaction. */
export function revokeTaskScopedThreadAccessInTransaction(
  tx: SpaceTransaction,
  input: { threadId: string; agentIds?: string[]; now?: Date },
): RevokedTaskScopedAccess {
  const membershipWhere = and(
    eq(schema.channelAgentMembers.channelId, input.threadId),
    eq(schema.channelAgentMembers.accessKind, "task_scoped"),
    input.agentIds?.length ? inArray(schema.channelAgentMembers.agentId, input.agentIds) : undefined,
  );
  const members = tx.select({ agentId: schema.channelAgentMembers.agentId }).from(schema.channelAgentMembers).where(membershipWhere).all();
  if (!members.length) return { count: 0, sessionIds: [], attempts: [] };
  const agentIds = members.map((member) => member.agentId);
  const now = input.now ?? new Date();
  const sessions = tx.select({ id: schema.runtimeSessions.id }).from(schema.runtimeSessions).where(and(
    eq(schema.runtimeSessions.surfaceId, input.threadId),
    inArray(schema.runtimeSessions.agentId, agentIds),
    isNull(schema.runtimeSessions.retiredAt),
  )).all();
  const sessionIds = sessions.map((session) => session.id);
  const turns = sessionIds.length ? tx.select({ id: schema.agentTurns.id }).from(schema.agentTurns).where(and(
    inArray(schema.agentTurns.runtimeSessionId, sessionIds),
    inArray(schema.agentTurns.status, ["pending", "running", "retry_wait"]),
  )).all() : [];
  const turnIds = turns.map((turn) => turn.id);
  const attempts = turnIds.length ? tx.select({
    id: schema.agentTurnAttempts.id,
    workerGeneration: schema.agentTurnAttempts.workerGeneration,
  }).from(schema.agentTurnAttempts).where(and(
    inArray(schema.agentTurnAttempts.turnId, turnIds),
    inArray(schema.agentTurnAttempts.status, ["claimed", "admitted", "running", "finalizing"]),
  )).all() : [];
  tx.delete(schema.channelAgentMembers).where(membershipWhere).run();
  if (sessionIds.length) {
    tx.update(schema.sessionWakeups).set({ status: "cancelled" }).where(and(
      inArray(schema.sessionWakeups.runtimeSessionId, sessionIds),
      inArray(schema.sessionWakeups.status, ["scheduled", "leased"]),
    )).run();
    tx.update(schema.runtimeSessions).set({ status: "disabled", retiredAt: now, updatedAt: now })
      .where(inArray(schema.runtimeSessions.id, sessionIds)).run();
  }
  if (turnIds.length) {
    tx.update(schema.agentDeliveryItems).set({ disposition: "dismissed", settledAt: now }).where(and(
      inArray(schema.agentDeliveryItems.turnId, turnIds),
      inArray(schema.agentDeliveryItems.disposition, ["pending", "bound"]),
    )).run();
    tx.update(schema.agentTurnAttempts).set({ status: "cancelled", errorCode: "task_scope_ended", completedAt: now })
      .where(and(
        inArray(schema.agentTurnAttempts.turnId, turnIds),
        inArray(schema.agentTurnAttempts.status, ["claimed", "admitted", "running", "finalizing"]),
      )).run();
    tx.update(schema.turnCapabilityActivations).set({ status: "revoked", revokedAt: now }).where(and(
      inArray(schema.turnCapabilityActivations.turnId, turnIds),
      inArray(schema.turnCapabilityActivations.status, ["pending", "active"]),
    )).run();
    tx.update(schema.agentTurns).set({ status: "cancelled", outcome: "cancelled", completedAt: now })
      .where(inArray(schema.agentTurns.id, turnIds)).run();
  }
  tx.update(schema.agentDeliveryItems).set({ disposition: "dismissed", settledAt: now }).where(and(
    inArray(schema.agentDeliveryItems.agentId, agentIds),
    eq(schema.agentDeliveryItems.targetSurfaceId, input.threadId),
    eq(schema.agentDeliveryItems.disposition, "pending"),
  )).run();
  return { count: members.length, sessionIds, attempts };
}

/** Claims natural expiry and revokes the bounded execution grant before any runtime context is disclosed. */
export function revokeExpiredTaskScopedAccess(
  spaceId: string,
  threadId: string,
  agentId: string,
  db: SpaceDb = dbForSpace(spaceId),
  nowMs = Date.now(),
): RevokedTaskScopedAccess {
  return db.transaction((tx) => {
    const expired = tx.select({ agentId: schema.channelAgentMembers.agentId }).from(schema.channelAgentMembers).where(and(
      eq(schema.channelAgentMembers.channelId, threadId),
      eq(schema.channelAgentMembers.agentId, agentId),
      eq(schema.channelAgentMembers.accessKind, "task_scoped"),
      lte(schema.channelAgentMembers.accessExpiresAt, new Date(nowMs)),
    )).get();
    return expired
      ? revokeTaskScopedThreadAccessInTransaction(tx, { threadId, agentIds: [agentId], now: new Date(nowMs) })
      : { count: 0, sessionIds: [], attempts: [] };
  });
}
