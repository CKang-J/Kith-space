// Shared helpers used by ≥2 route modules — verbatim from the former routes-api.ts.
import { eq, inArray } from "drizzle-orm";
import { dbForSpace, schema } from "../../db/index.js";
import { aggregateReactions } from "../core.js";

export async function attachMentions(spaceId: string, msgs: (typeof schema.messages.$inferSelect)[]) {
  if (!msgs.length) return msgs.map((m) => ({ ...m, mentions: [] as any[], attachments: [] as any[], reactions: [] as any[] }));
  const db = dbForSpace(spaceId);
  const ids = msgs.map((m) => m.id);
  const mts = await db.select().from(schema.messageMentions).where(inArray(schema.messageMentions.messageId, ids));
  const atts = await db.select().from(schema.attachments).where(inArray(schema.attachments.messageId, ids));
  const reactions = await aggregateReactions(spaceId, ids);
  return msgs.map((m) => ({
    ...m,
    mentions: mts.filter((x) => x.messageId === m.id).map((x) => ({ type: x.mentionType, id: x.mentionId, name: x.mentionName })),
    attachments: atts.filter((a) => a.messageId === m.id).map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, sizeBytes: a.sizeBytes })),
    reactions: reactions.get(m.id) ?? [],
  }));
}
export async function humanChannels(spaceId: string) {
  const db = dbForSpace(spaceId);
  const chs = await db.select().from(schema.channels).where(eq(schema.channels.spaceId, spaceId));
  return chs;
}
