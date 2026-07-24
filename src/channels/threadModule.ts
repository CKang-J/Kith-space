import { and, eq } from "drizzle-orm";
import { dbForSpace, schema } from "../db/index.js";
import { getHumanIdentity } from "../human/humanIdentity.js";
import { followHumanThread, humanChannelState } from "../human/humanChannelState.js";
import { addChannelMembers } from "./channelMembership.js";
import { assertChannelWritable } from "./channelLifecycle.js";

export interface ThreadEventSink {
  publish(spaceId: string, event: unknown): Promise<void>;
}

export interface ThreadModule {
  getOrCreateThread(
    spaceId: string,
    parentMessageId: string,
    creator?: { type: "human" | "agent"; id: string },
  ): Promise<typeof schema.channels.$inferSelect>;
}

export function createThreadModule(eventSink: ThreadEventSink): ThreadModule {
  async function publishCreated(
    spaceId: string,
    thread: typeof schema.channels.$inferSelect,
    creator?: { type: "human" | "agent"; id: string },
  ): Promise<void> {
    const db = dbForSpace(spaceId);
    const replies = db.select({ id: schema.messages.id }).from(schema.messages)
      .where(eq(schema.messages.channelId, thread.id)).all();
    const participants = db.select({ id: schema.channelAgentMembers.agentId }).from(schema.channelAgentMembers)
      .where(eq(schema.channelAgentMembers.channelId, thread.id)).all();
    const humanState = await humanChannelState(spaceId, thread.id);
    const parent = thread.parentMessageId
      ? db.select({ channelId: schema.messages.channelId }).from(schema.messages)
          .where(eq(schema.messages.id, thread.parentMessageId)).get()
      : null;
    await eventSink.publish(spaceId, {
      type: "thread:updated",
      threadChannelId: thread.id,
      parentMessageId: thread.parentMessageId,
      parentChannelId: parent?.channelId ?? null,
      replyCount: replies.length,
      participantIds: [
        ...participants.map((participant) => participant.id),
        ...(humanState?.threadFollowedAt
          ? [getHumanIdentity()?.id].filter((id): id is string => Boolean(id))
          : []),
      ],
      senderId: creator?.id ?? null,
      senderType: creator?.type ?? "system",
    });
  }

  return {
    async getOrCreateThread(spaceId, parentMessageId, creator) {
      const db = dbForSpace(spaceId);
      const parent = db.select({ channelId: schema.messages.channelId }).from(schema.messages).where(and(
        eq(schema.messages.id, parentMessageId),
        eq(schema.messages.spaceId, spaceId),
      )).get();
      if (!parent) throw new Error(`parent message not found: ${parentMessageId}`);
      await assertChannelWritable(spaceId, parent.channelId);
      let thread = db.select().from(schema.channels).where(and(
        eq(schema.channels.spaceId, spaceId),
        eq(schema.channels.type, "thread"),
        eq(schema.channels.parentMessageId, parentMessageId),
      )).get();
      let created = false;
      if (!thread) {
        const inserted = db.insert(schema.channels).values({
          spaceId,
          type: "thread",
          parentMessageId,
          name: `thread-${parentMessageId.slice(0, 8)}`,
        }).onConflictDoNothing().returning().get();
        thread = inserted ?? db.select().from(schema.channels).where(and(
          eq(schema.channels.spaceId, spaceId),
          eq(schema.channels.type, "thread"),
          eq(schema.channels.parentMessageId, parentMessageId),
        )).get()!;
        created = Boolean(inserted);
        if (inserted) {
          const parentMessage = db.select().from(schema.messages)
            .where(eq(schema.messages.id, parentMessageId)).get();
          if (parentMessage?.senderType === "human") {
            await followHumanThread(spaceId, thread.id);
          } else if (parentMessage?.senderType === "agent" && parentMessage.senderId) {
            await addChannelMembers(spaceId, thread.id, [{ type: "agent", id: parentMessage.senderId }]);
          }
        }
      }
      if (creator?.type === "human") await followHumanThread(spaceId, thread.id);
      else if (creator) await addChannelMembers(spaceId, thread.id, [{ type: "agent", id: creator.id }]);
      if (created) await publishCreated(spaceId, thread, creator);
      return thread;
    },
  };
}
