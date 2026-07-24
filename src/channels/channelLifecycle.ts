import { and, eq, inArray } from "drizzle-orm";
import { dbForSpace, schema } from "../db/index.js";
export { isRequiredChannel } from "../db/requiredChannel.js";

export type ChannelLifecycleCode = "channel_archived" | "channel_deleted" | "channel_not_found";
export type ChannelLifecycleState = "active" | "archived" | "deleted" | "missing";

export class ChannelLifecycleError extends Error {
  constructor(
    readonly code: ChannelLifecycleCode,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "ChannelLifecycleError";
  }
}

type Channel = typeof schema.channels.$inferSelect;

async function channelLifecycleRecord(
  spaceId: string,
  channelId: string,
): Promise<{ state: ChannelLifecycleState; channel: Channel | null }> {
  const db = dbForSpace(spaceId);
  const channel = (await db.select().from(schema.channels).where(and(
    eq(schema.channels.id, channelId),
    eq(schema.channels.spaceId, spaceId),
  )))[0];
  if (!channel) return { state: "missing", channel: null };
  if (channel.deletedAt) return { state: "deleted", channel };
  if (channel.type !== "thread") return { state: channel.archivedAt ? "archived" : "active", channel };
  if (!channel.parentMessageId) return { state: "missing", channel };

  const parent = (await db.select({ channelId: schema.messages.channelId }).from(schema.messages).where(and(
    eq(schema.messages.id, channel.parentMessageId),
    eq(schema.messages.spaceId, spaceId),
  )))[0];
  if (!parent) return { state: "missing", channel };
  const root = (await db.select({ archivedAt: schema.channels.archivedAt, deletedAt: schema.channels.deletedAt })
    .from(schema.channels).where(and(
      eq(schema.channels.id, parent.channelId),
      eq(schema.channels.spaceId, spaceId),
    )))[0];
  if (!root) return { state: "missing", channel };
  if (root.deletedAt) return { state: "deleted", channel };
  return { state: root.archivedAt || channel.archivedAt ? "archived" : "active", channel };
}

export async function channelLifecycleState(spaceId: string, channelId: string): Promise<ChannelLifecycleState> {
  return (await channelLifecycleRecord(spaceId, channelId)).state;
}

export async function requireWritableChannel(spaceId: string, channelId: string): Promise<Channel> {
  const { state, channel } = await channelLifecycleRecord(spaceId, channelId);
  if (state === "active" && channel) return channel;
  if (state === "archived") throw new ChannelLifecycleError("channel_archived", "channel is archived and read-only", 409);
  if (state === "deleted") throw new ChannelLifecycleError("channel_deleted", "channel is deleted", 409);
  throw new ChannelLifecycleError("channel_not_found", "channel not found", 404);
}

export async function assertChannelWritable(spaceId: string, channelId: string): Promise<void> {
  await requireWritableChannel(spaceId, channelId);
}

/** Filter list-like surfaces while preserving direct reads of archived history. */
export async function activeChannels<T extends Channel>(spaceId: string, channels: T[]): Promise<T[]> {
  const directlyActive = channels.filter((channel) => !channel.deletedAt && !channel.archivedAt);
  const threads = directlyActive.filter((channel) => channel.type === "thread" && channel.parentMessageId);
  if (!threads.length) return directlyActive;

  const db = dbForSpace(spaceId);
  const parentIds = threads.map((thread) => thread.parentMessageId!);
  const parents = await db.select({ id: schema.messages.id, channelId: schema.messages.channelId })
    .from(schema.messages).where(and(
      eq(schema.messages.spaceId, spaceId),
      inArray(schema.messages.id, parentIds),
    ));
  const rootIds = [...new Set(parents.map((parent) => parent.channelId))];
  const roots = rootIds.length
    ? await db.select({ id: schema.channels.id, archivedAt: schema.channels.archivedAt, deletedAt: schema.channels.deletedAt })
      .from(schema.channels).where(and(
        eq(schema.channels.spaceId, spaceId),
        inArray(schema.channels.id, rootIds),
      ))
    : [];
  const parentById = new Map(parents.map((parent) => [parent.id, parent.channelId]));
  const activeRoots = new Set(roots.filter((root) => !root.archivedAt && !root.deletedAt).map((root) => root.id));
  return directlyActive.filter((channel) => channel.type !== "thread"
    || (!!channel.parentMessageId && activeRoots.has(parentById.get(channel.parentMessageId) ?? "")));
}
