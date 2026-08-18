// Shared helpers used by ≥2 route modules — verbatim from the former routes-api.ts.
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { dbForSpace, schema } from "../../db/index.js";
import { presentCanvasContext } from "../../canvas/canvasChatPresentation.js";
import { loadCanvasContextsForMessages } from "../../canvas/canvasSelectionSnapshot.js";
import { aggregateReactions } from "../core.js";

export async function attachMentions(spaceId: string, msgs: (typeof schema.messages.$inferSelect)[]) {
  if (!msgs.length) return msgs.map((m) => ({ ...m, senderDeleted: false, mentions: [] as any[], attachments: [] as any[], reactions: [] as any[], canvasContext: null }));
  const db = dbForSpace(spaceId);
  const ids = msgs.map((m) => m.id);
  const mts = await db.select().from(schema.messageMentions).where(inArray(schema.messageMentions.messageId, ids));
  const atts = await db.select().from(schema.attachments).where(inArray(schema.attachments.messageId, ids));
  const reactions = await aggregateReactions(spaceId, ids);
  const senderIds = [...new Set(msgs.filter((m) => m.senderType === "agent" && m.senderId).map((m) => m.senderId!))];
  const deletedSenderIds = deletedAgentIds(spaceId, senderIds);
  const canvasContexts = loadCanvasContextsForMessages(db, spaceId, ids);
  return msgs.map((m) => {
    const canvas = canvasContexts.get(m.id);
    return {
      ...m,
      senderDeleted: m.senderType === "agent" && !!m.senderId && deletedSenderIds.has(m.senderId),
      mentions: mts.filter((x) => x.messageId === m.id).map((x) => ({ type: x.mentionType, id: x.mentionId, name: x.mentionName })),
      attachments: atts.filter((a) => a.messageId === m.id).map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, sizeBytes: a.sizeBytes })),
      reactions: reactions.get(m.id) ?? [],
      canvasContext: presentCanvasContext(canvas),
    };
  });
}

export function deletedAgentIds(spaceId: string, agentIds?: string[]): Set<string> {
  if (agentIds && !agentIds.length) return new Set();
  const db = dbForSpace(spaceId);
  const conditions = [eq(schema.agents.spaceId, spaceId), isNotNull(schema.agents.deletedAt)];
  if (agentIds) conditions.push(inArray(schema.agents.id, agentIds));
  return new Set(db.select({ id: schema.agents.id }).from(schema.agents)
    .where(and(...conditions)).all().map((agent) => agent.id));
}
export async function humanChannels(spaceId: string) {
  const db = dbForSpace(spaceId);
  const chs = await db.select().from(schema.channels).where(eq(schema.channels.spaceId, spaceId));
  return chs;
}
