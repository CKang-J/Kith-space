import { and, asc, eq, gt } from "drizzle-orm";
import type { SpaceTransaction } from "../counters.js";
import { schema } from "../db/index.js";

const TERMINAL_DISPOSITIONS = new Set(["observed", "replied", "ceded", "dispatch_blocked", "dismissed"]);
const FRONTIER_PAGE_SIZE = 256;

/** Advance one Agent's contiguous channel cursor without scanning channel history or issuing N+1 delivery reads. */
export function advanceDeliveryFrontierInTransaction(
  tx: SpaceTransaction,
  agentId: string,
  channelId: string,
): void {
  const member = tx.select().from(schema.channelAgentMembers).where(and(
    eq(schema.channelAgentMembers.channelId, channelId),
    eq(schema.channelAgentMembers.agentId, agentId),
  )).get();
  if (!member) return;

  let frontier = member.lastReadSeq;
  while (true) {
    const rows = tx.select({
      seq: schema.messages.seq,
      disposition: schema.agentDeliveryItems.disposition,
    }).from(schema.messages).leftJoin(schema.agentDeliveryItems, and(
      eq(schema.agentDeliveryItems.messageId, schema.messages.id),
      eq(schema.agentDeliveryItems.agentId, agentId),
    )).where(and(
      eq(schema.messages.channelId, channelId),
      gt(schema.messages.seq, frontier),
    )).orderBy(asc(schema.messages.seq)).limit(FRONTIER_PAGE_SIZE).all();
    if (!rows.length) break;
    for (const row of rows) {
      if (!row.disposition || !TERMINAL_DISPOSITIONS.has(row.disposition)) {
        if (frontier > member.lastReadSeq) updateFrontier(tx, agentId, channelId, frontier);
        return;
      }
      frontier = row.seq;
    }
    if (rows.length < FRONTIER_PAGE_SIZE) break;
  }
  if (frontier > member.lastReadSeq) updateFrontier(tx, agentId, channelId, frontier);
}

function updateFrontier(tx: SpaceTransaction, agentId: string, channelId: string, frontier: number): void {
  tx.update(schema.channelAgentMembers).set({ lastReadSeq: frontier }).where(and(
    eq(schema.channelAgentMembers.channelId, channelId),
    eq(schema.channelAgentMembers.agentId, agentId),
  )).run();
}
