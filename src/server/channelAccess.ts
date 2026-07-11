// The one local Human owns the selected Space. Channel membership is an
// agent collaboration boundary and must not be used as a Human auth gate.
import { and, eq, isNull } from "drizzle-orm";
import { dbFor, schema } from "../db/index.js";

/** Return whether the channel is a live container in this Space. */
export async function canHumanReadChannel(spaceId: string, channelId: string): Promise<boolean> {
  const db = dbFor(spaceId);
  const channel = (await db
    .select({ id: schema.channels.id })
    .from(schema.channels)
    .where(and(
      eq(schema.channels.id, channelId),
      eq(schema.channels.serverId, spaceId),
      isNull(schema.channels.deletedAt),
    )))[0];
  return Boolean(channel);
}
