import { and, eq, isNotNull } from "drizzle-orm";
import { dbForSpace, schema } from "../db/index.js";
import { activeChannels } from "../channels/channelLifecycle.js";

export type HumanChannelState = typeof schema.humanChannelStates.$inferSelect;
export type HumanChannelNotificationLevel = HumanChannelState["notificationLevel"];

const now = () => new Date();

export async function humanChannelState(spaceId: string, channelId: string): Promise<HumanChannelState | null> {
  const db = dbForSpace(spaceId);
  return (await db.select().from(schema.humanChannelStates)
    .where(eq(schema.humanChannelStates.channelId, channelId)))[0] ?? null;
}

/**
 * Human containers are not an authorization roster. Regular/private channels are implicit;
 * DMs and threads enter the personal inbox only through their explicit state markers.
 */
export async function humanContainerStates(spaceId: string) {
  const db = dbForSpace(spaceId);
  const channels = await activeChannels(spaceId, await db.select().from(schema.channels)
    .where(eq(schema.channels.spaceId, spaceId)));
  const stored = await db.select().from(schema.humanChannelStates);
  const byChannel = new Map(stored.map((state) => [state.channelId, state]));
  const trackedChannels = channels.filter((channel) => {
    const state = byChannel.get(channel.id);
    if (channel.type === "channel" || channel.type === "private") return true;
    if (channel.type === "dm") return Boolean(state?.dmAgentId);
    if (channel.type === "thread") return Boolean(state?.threadFollowedAt);
    return false;
  });
  const states = trackedChannels.map((channel) => byChannel.get(channel.id) ?? ({
    channelId: channel.id,
    lastReadSeq: 0,
    dmAgentId: null,
    threadFollowedAt: null,
    threadDoneAt: null,
    notificationLevel: "all",
    updatedAt: channel.createdAt,
  } satisfies HumanChannelState));
  return { states, channels: trackedChannels };
}

export async function humanChannelNotificationLevel(spaceId: string, channelId: string): Promise<HumanChannelNotificationLevel> {
  return (await humanChannelState(spaceId, channelId))?.notificationLevel ?? "all";
}

export async function setHumanChannelNotificationLevel(
  spaceId: string,
  channelId: string,
  notificationLevel: HumanChannelNotificationLevel,
): Promise<void> {
  const db = dbForSpace(spaceId);
  await db.insert(schema.humanChannelStates).values({ channelId, notificationLevel, updatedAt: now() })
    .onConflictDoUpdate({
      target: schema.humanChannelStates.channelId,
      set: { notificationLevel, updatedAt: now() },
    });
}

export async function humanDmStates(spaceId: string): Promise<HumanChannelState[]> {
  return dbForSpace(spaceId).select().from(schema.humanChannelStates)
    .where(isNotNull(schema.humanChannelStates.dmAgentId));
}

export async function markHumanChannelRead(spaceId: string, channelId: string, lastReadSeq: number): Promise<void> {
  const db = dbForSpace(spaceId);
  await db.insert(schema.humanChannelStates).values({ channelId, lastReadSeq, updatedAt: now() })
    .onConflictDoUpdate({
      target: schema.humanChannelStates.channelId,
      set: { lastReadSeq, updatedAt: now() },
    });
}

export async function trackHumanDm(spaceId: string, channelId: string, agentId: string): Promise<void> {
  const db = dbForSpace(spaceId);
  await db.insert(schema.humanChannelStates).values({ channelId, dmAgentId: agentId, updatedAt: now() })
    .onConflictDoUpdate({
      target: schema.humanChannelStates.channelId,
      set: { dmAgentId: agentId, updatedAt: now() },
    });
}

export async function followHumanThread(spaceId: string, channelId: string): Promise<void> {
  const db = dbForSpace(spaceId);
  const followedAt = now();
  await db.insert(schema.humanChannelStates).values({ channelId, threadFollowedAt: followedAt, updatedAt: followedAt })
    .onConflictDoUpdate({
      target: schema.humanChannelStates.channelId,
      set: { threadFollowedAt: followedAt, updatedAt: followedAt },
    });
}

/** Unfollow intentionally drops the cursor, preserving the previous re-follow-from-zero behavior. */
export async function unfollowHumanThread(spaceId: string, channelId: string): Promise<void> {
  await dbForSpace(spaceId).delete(schema.humanChannelStates)
    .where(and(
      eq(schema.humanChannelStates.channelId, channelId),
      isNotNull(schema.humanChannelStates.threadFollowedAt),
    ));
}

export async function setHumanThreadDone(spaceId: string, channelId: string, done: boolean): Promise<void> {
  await dbForSpace(spaceId).update(schema.humanChannelStates)
    .set({ threadDoneAt: done ? now() : null, updatedAt: now() })
    .where(and(
      eq(schema.humanChannelStates.channelId, channelId),
      isNotNull(schema.humanChannelStates.threadFollowedAt),
    ));
}

/** A new reply reactivates only an existing Human follow; it never follows on the Human's behalf. */
export async function reactivateFollowedHumanThread(spaceId: string, channelId: string): Promise<void> {
  await dbForSpace(spaceId).update(schema.humanChannelStates)
    .set({ threadDoneAt: null, updatedAt: now() })
    .where(and(
      eq(schema.humanChannelStates.channelId, channelId),
      isNotNull(schema.humanChannelStates.threadFollowedAt),
    ));
}
