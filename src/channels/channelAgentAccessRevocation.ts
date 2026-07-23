import { and, eq, inArray, isNull } from "drizzle-orm";
import { dbForSpace, schema, type SpaceDb } from "../db/index.js";

export interface RevokedAgentChannelAccess {
  changed: boolean;
  threadIds: string[];
  sessionIds: string[];
  attempts: Array<{ id: string; workerGeneration: number }>;
}

/** Atomically revokes a top-level membership and every ordinary child-thread execution authority. */
export function revokeAgentChannelAccess(
  spaceId: string,
  channelId: string,
  agentId: string,
  db: SpaceDb = dbForSpace(spaceId),
  nowMs = Date.now(),
): RevokedAgentChannelAccess {
  return db.transaction((tx) => {
    const membership = tx.select().from(schema.channelAgentMembers).where(and(
      eq(schema.channelAgentMembers.channelId, channelId),
      eq(schema.channelAgentMembers.agentId, agentId),
    )).get();
    if (!membership) return { changed: false, threadIds: [], sessionIds: [], attempts: [] };
    const rootIds = tx.select({ id: schema.messages.id }).from(schema.messages).where(and(
      eq(schema.messages.spaceId, spaceId),
      eq(schema.messages.channelId, channelId),
    )).all().map((row) => row.id);
    const childThreadIds = rootIds.length
      ? tx.select({ id: schema.channels.id }).from(schema.channels).where(and(
          eq(schema.channels.spaceId, spaceId),
          eq(schema.channels.type, "thread"),
          inArray(schema.channels.parentMessageId, rootIds),
          isNull(schema.channels.deletedAt),
        )).all().map((row) => row.id)
      : [];
    const ordinaryThreadIds = childThreadIds.length
      ? tx.select({ channelId: schema.channelAgentMembers.channelId }).from(schema.channelAgentMembers).where(and(
          eq(schema.channelAgentMembers.agentId, agentId),
          eq(schema.channelAgentMembers.accessKind, "member"),
          inArray(schema.channelAgentMembers.channelId, childThreadIds),
        )).all().map((row) => row.channelId)
      : [];
    const surfaceIds = [channelId, ...ordinaryThreadIds];
    const sourceMessageIds = tx.select({ id: schema.messages.id }).from(schema.messages)
      .where(inArray(schema.messages.channelId, surfaceIds)).all().map((row) => row.id);
    const sourceMessageSet = new Set(sourceMessageIds);
    const advisorJobs = tx.select().from(schema.memoryAdvisorJobs).where(and(
      eq(schema.memoryAdvisorJobs.agentId, agentId),
      inArray(schema.memoryAdvisorJobs.status, ["queued", "running", "failed"]),
    )).all();
    const revokedAdvisorJobs = advisorJobs.filter((job) => Array.isArray(job.sourceRefs)
      && job.sourceRefs.some((source) => source?.sourceKind === "message" && sourceMessageSet.has(source.sourceId)));
    if (revokedAdvisorJobs.length) {
      const jobIds = revokedAdvisorJobs.map((job) => job.id);
      const runIds = revokedAdvisorJobs.flatMap((job) => job.providerRunId ? [job.providerRunId] : []);
      tx.update(schema.memoryAdvisorJobs).set({ status: "cancelled", leaseOwner: null, leaseExpiresAt: null,
        errorCode: "source_access_revoked", errorDetailRedacted: "advisor source channel access was revoked", completedAt: new Date(nowMs) })
        .where(inArray(schema.memoryAdvisorJobs.id, jobIds)).run();
      if (runIds.length) tx.update(schema.advisorProviderRuns).set({ status: "cancelled", errorCode: "provider_cancelled", completedAt: new Date(nowMs) })
        .where(and(inArray(schema.advisorProviderRuns.id, runIds), inArray(schema.advisorProviderRuns.status, ["leased", "running", "failed"]))).run();
    }
    const sessions = tx.select({ id: schema.runtimeSessions.id }).from(schema.runtimeSessions).where(and(
      eq(schema.runtimeSessions.spaceId, spaceId),
      eq(schema.runtimeSessions.agentId, agentId),
      inArray(schema.runtimeSessions.surfaceId, surfaceIds),
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
    const now = new Date(nowMs);
    tx.delete(schema.channelAgentMembers).where(and(
      eq(schema.channelAgentMembers.channelId, channelId),
      eq(schema.channelAgentMembers.agentId, agentId),
    )).run();
    if (ordinaryThreadIds.length) {
      tx.delete(schema.channelAgentMembers).where(and(
        eq(schema.channelAgentMembers.agentId, agentId),
        eq(schema.channelAgentMembers.accessKind, "member"),
        inArray(schema.channelAgentMembers.channelId, ordinaryThreadIds),
      )).run();
    }
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
      tx.update(schema.agentTurnAttempts).set({ status: "cancelled", errorCode: "parent_access_revoked", completedAt: now })
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
      eq(schema.agentDeliveryItems.agentId, agentId),
      inArray(schema.agentDeliveryItems.targetSurfaceId, surfaceIds),
      eq(schema.agentDeliveryItems.disposition, "pending"),
    )).run();
    return { changed: true, threadIds: ordinaryThreadIds, sessionIds, attempts };
  });
}
