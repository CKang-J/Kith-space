import { randomUUID } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { initialAgentResponseWakeWatermarks } from "../agents/agentResponseSettings.js";
import { allocateTaskNumber, taskNumberKey, type SpaceTransaction } from "../counters.js";
import { dbForSpace, schema } from "../db/index.js";
import { TaskOperationError } from "./taskTypes.js";

type Message = typeof schema.messages.$inferSelect;
type MessageInsert = typeof schema.messages.$inferInsert;
type Channel = typeof schema.channels.$inferSelect;

export function insertTaskOwningThread(
  tx: SpaceTransaction,
  task: { id: string; spaceId: string; senderType: string; senderId?: string | null },
  assigneeId?: string | null,
  membershipWatermark = 0,
): string {
  const threadId = randomUUID();
  tx.insert(schema.channels).values({
    id: threadId,
    spaceId: task.spaceId,
    type: "thread",
    parentMessageId: task.id,
    name: `thread-${task.id.slice(0, 8)}`,
  }).run();
  if (task.senderType === "human") {
    const followedAt = new Date();
    tx.insert(schema.humanChannelStates).values({
      channelId: threadId,
      threadFollowedAt: followedAt,
      updatedAt: followedAt,
    }).onConflictDoUpdate({
      target: schema.humanChannelStates.channelId,
      set: { threadFollowedAt: followedAt, updatedAt: followedAt },
    }).run();
  }
  const agentMembers = new Set<string>();
  if (task.senderType === "agent" && task.senderId) agentMembers.add(task.senderId);
  if (assigneeId) agentMembers.add(assigneeId);
  if (agentMembers.size) {
    tx.insert(schema.channelAgentMembers).values([...agentMembers].map((agentId) => ({
      channelId: threadId,
      agentId,
      lastReadSeq: membershipWatermark,
      ...initialAgentResponseWakeWatermarks(membershipWatermark),
    }))).onConflictDoNothing().run();
  }
  return threadId;
}

export function createTaskRecord(input: {
  spaceId: string;
  channel: Channel;
  message: MessageInsert;
  parentTaskId?: string | null;
  assigneeId?: string | null;
}): Message {
  const db = dbForSpace(input.spaceId);
  let created!: Message;
  db.transaction((tx) => {
    created = createTaskRecordInTransaction(tx, input);
  });
  return created;
}

export function createTaskRecordInTransaction(
  tx: SpaceTransaction,
  input: {
    spaceId: string;
    channel: Channel;
    message: MessageInsert;
    parentTaskId?: string | null;
    assigneeId?: string | null;
  },
): Message {
  if (input.parentTaskId) {
    const parent = tx.select({ id: schema.messages.id, channelId: schema.messages.channelId })
      .from(schema.messages).where(and(
        eq(schema.messages.id, input.parentTaskId),
        eq(schema.messages.spaceId, input.spaceId),
        isNotNull(schema.messages.taskStatus),
      )).get();
    if (!parent) throw new TaskOperationError("INVALID_ARGUMENT", "parent task not found");
    if (parent.channelId !== input.channel.id) {
      throw new TaskOperationError("INVALID_ARGUMENT", "parent and child tasks must use the same channel");
    }
  }
  const taskNumber = allocateTaskNumber(tx, taskNumberKey(input.spaceId, input.channel));
  const threadId = insertTaskOwningThread(tx, {
    id: String(input.message.id),
    spaceId: input.spaceId,
    senderType: input.message.senderType,
    senderId: input.message.senderId,
  }, input.assigneeId, Number(input.message.seq ?? 0));
  return tx.insert(schema.messages).values({
    ...input.message,
    taskStatus: input.assigneeId ? "in_progress" : "todo",
    taskNumber,
    taskParentId: input.parentTaskId ?? null,
    taskAssigneeType: input.assigneeId ? "agent" : null,
    taskAssigneeId: input.assigneeId ?? null,
    taskClaimedAt: input.assigneeId ? new Date() : null,
    taskRevision: 1,
    threadId,
  }).returning().get();
}
