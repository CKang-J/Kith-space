import { and, asc, eq, lte } from "drizzle-orm";
import { hasAgentSurfaceAccessInTransaction } from "../channels/agentSurfaceAccess.js";
import { nextSeq } from "../counters.js";
import { dbForSpace, schema, type SpaceDb } from "../db/index.js";

export interface FiredWakeups {
  fired: number;
  cancelled: number;
  nextDueAt: number | null;
}

/** Converts due one-shot session wakeups into one durable optional delivery. */
export class SessionWakeupService {
  constructor(
    private readonly spaceId: string,
    private readonly db: SpaceDb = dbForSpace(spaceId),
    private readonly now: () => number = Date.now,
  ) {}

  async fireDue(limit = 20): Promise<FiredWakeups> {
    const now = this.now();
    const due = this.db.select().from(schema.sessionWakeups).where(and(
      eq(schema.sessionWakeups.status, "scheduled"),
      lte(schema.sessionWakeups.dueAt, new Date(now)),
    )).orderBy(asc(schema.sessionWakeups.dueAt)).limit(limit).all();
    let fired = 0;
    let cancelled = 0;
    for (const wakeup of due) {
      const seq = await nextSeq(this.spaceId);
      const result = this.db.transaction((tx) => {
        const current = tx.select().from(schema.sessionWakeups).where(and(
          eq(schema.sessionWakeups.id, wakeup.id),
          eq(schema.sessionWakeups.status, "scheduled"),
        )).get();
        if (!current) return "ignored" as const;
        const session = tx.select().from(schema.runtimeSessions).where(and(
          eq(schema.runtimeSessions.id, current.runtimeSessionId),
          eq(schema.runtimeSessions.spaceId, this.spaceId),
        )).get();
        const agent = session ? tx.select().from(schema.agents).where(eq(schema.agents.id, session.agentId)).get() : null;
        const allowed = Boolean(session && agent?.status === "active" && !session.retiredAt
          && session.sessionGeneration === current.sessionGeneration
          && hasAgentSurfaceAccessInTransaction(tx, {
            spaceId: this.spaceId,
            channelId: session.surfaceId,
            agentId: current.ownerAgentId,
            now,
          }));
        if (!allowed || !session) {
          tx.update(schema.sessionWakeups).set({ status: "cancelled", leaseOwner: null, leaseExpiresAt: null })
            .where(eq(schema.sessionWakeups.id, current.id)).run();
          return "cancelled" as const;
        }
        const message = tx.insert(schema.messages).values({
          seq,
          spaceId: this.spaceId,
          channelId: session.surfaceId,
          senderType: "system",
          senderId: null,
          senderName: "Kith-space",
          messageType: "action",
          content: `Scheduled session wake: ${current.reason}`,
          memoryPolicy: "exclude",
          searchText: current.reason,
        }).returning().get();
        tx.insert(schema.agentDeliveryItems).values({
          spaceId: this.spaceId,
          agentId: current.ownerAgentId,
          messageId: message.id,
          sourceChannelId: session.surfaceId,
          sourceSeq: message.seq,
          cursorOwnerChannelId: session.surfaceId,
          targetSurfaceKind: session.surfaceKind,
          targetSurfaceId: session.surfaceId,
          targetRuntimeSessionId: session.id,
          directive: "optional",
          reason: "session_wakeup",
          policySnapshot: { wakeupId: current.id, sourceTurnId: current.sourceTurnId },
          disposition: "pending",
        }).run();
        tx.update(schema.sessionWakeups).set({ status: "fired", firedAt: new Date(now), leaseOwner: null, leaseExpiresAt: null })
          .where(eq(schema.sessionWakeups.id, current.id)).run();
        return "fired" as const;
      });
      if (result === "fired") fired += 1;
      else if (result === "cancelled") cancelled += 1;
    }
    const next = this.db.select({ dueAt: schema.sessionWakeups.dueAt }).from(schema.sessionWakeups)
      .where(eq(schema.sessionWakeups.status, "scheduled")).orderBy(asc(schema.sessionWakeups.dueAt)).get();
    return { fired, cancelled, nextDueAt: next?.dueAt.getTime() ?? null };
  }
}
