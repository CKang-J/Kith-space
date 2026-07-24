import { and, count, eq, gt, inArray, isNotNull, isNull, max, ne, or } from "drizzle-orm";
import { dbForSpace, schema } from "../db/index.js";

export interface ThreadSummary {
  threadChannelId: string;
  parentMessageId: string;
  parentChannelId: string;
  parentMessageText: string;
  parentSender: {
    type: string;
    id: string | null;
    name: string;
  };
  replyCount: number;
  unreadCount: number;
  followed: boolean;
  lastReplyAt: Date | null;
  createdAt: Date;
}

/** List every live thread rooted in one base channel or DM, independent of message paging. */
export async function listThreadSummaries(input: {
  spaceId: string;
  parentChannelId: string;
  humanId: string;
}): Promise<ThreadSummary[]> {
  const db = dbForSpace(input.spaceId);
  const threads = await db.select({
    threadChannelId: schema.channels.id,
    parentMessageId: schema.messages.id,
    parentChannelId: schema.messages.channelId,
    parentMessageText: schema.messages.content,
    parentSenderType: schema.messages.senderType,
    parentSenderId: schema.messages.senderId,
    parentSenderName: schema.messages.senderName,
    createdAt: schema.channels.createdAt,
  }).from(schema.channels)
    .innerJoin(schema.messages, eq(schema.channels.parentMessageId, schema.messages.id))
    .where(and(
      eq(schema.channels.spaceId, input.spaceId),
      eq(schema.channels.type, "thread"),
      isNull(schema.channels.deletedAt),
      eq(schema.messages.spaceId, input.spaceId),
      eq(schema.messages.channelId, input.parentChannelId),
    ));

  if (!threads.length) return [];
  const threadIds = threads.map((thread) => thread.threadChannelId);
  const [replyRows, stateRows, unreadRows] = await Promise.all([
    db.select({
      channelId: schema.messages.channelId,
      replyCount: count(),
      lastReplyAt: max(schema.messages.createdAt),
    }).from(schema.messages)
      .where(inArray(schema.messages.channelId, threadIds))
      .groupBy(schema.messages.channelId),
    db.select().from(schema.humanChannelStates)
      .where(inArray(schema.humanChannelStates.channelId, threadIds)),
    db.select({
      channelId: schema.messages.channelId,
      unreadCount: count(),
    }).from(schema.messages)
      .innerJoin(schema.humanChannelStates, eq(schema.humanChannelStates.channelId, schema.messages.channelId))
      .where(and(
        inArray(schema.messages.channelId, threadIds),
        isNotNull(schema.humanChannelStates.threadFollowedAt),
        isNull(schema.humanChannelStates.threadDoneAt),
        gt(schema.messages.seq, schema.humanChannelStates.lastReadSeq),
        or(isNull(schema.messages.senderId), ne(schema.messages.senderId, input.humanId)),
      ))
      .groupBy(schema.messages.channelId),
  ]);

  const repliesByThread = new Map(replyRows.map((row) => [row.channelId, row]));
  const statesByThread = new Map(stateRows.map((row) => [row.channelId, row]));
  const unreadByThread = new Map(unreadRows.map((row) => [row.channelId, Number(row.unreadCount)]));

  return threads.map((thread) => {
    const replies = repliesByThread.get(thread.threadChannelId);
    const state = statesByThread.get(thread.threadChannelId);
    return {
      threadChannelId: thread.threadChannelId,
      parentMessageId: thread.parentMessageId,
      parentChannelId: thread.parentChannelId,
      parentMessageText: thread.parentMessageText,
      parentSender: {
        type: thread.parentSenderType,
        id: thread.parentSenderId,
        name: thread.parentSenderName,
      },
      replyCount: Number(replies?.replyCount ?? 0),
      unreadCount: unreadByThread.get(thread.threadChannelId) ?? 0,
      followed: Boolean(state?.threadFollowedAt),
      lastReplyAt: replies?.lastReplyAt ?? null,
      createdAt: thread.createdAt,
    };
  }).sort((left, right) => {
    const rightActivity = (right.lastReplyAt ?? right.createdAt).getTime();
    const leftActivity = (left.lastReplyAt ?? left.createdAt).getTime();
    return rightActivity - leftActivity || right.threadChannelId.localeCompare(left.threadChannelId);
  });
}
