import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { allocateTaskNumber, taskNumberKey, type SpaceTransaction } from "../../counters.js";
import { dbForSpace, schema } from "../../db/index.js";
import { assertTaskTransition } from "./taskPolicy.js";
import { isTaskStatus, TaskOperationError, type TaskStatus } from "./taskTypes.js";
import { initialAgentResponseWakeWatermarks } from "../../agents/agentResponseSettings.js";

type Message = typeof schema.messages.$inferSelect;
type MessageInsert = typeof schema.messages.$inferInsert;
type Channel = typeof schema.channels.$inferSelect;

export interface TaskMutationResult {
  task: Message;
  changed: boolean;
  audit?: Message;
}

function snapshot(task: Message) {
  return {
    id: task.id,
    status: task.taskStatus,
    revision: task.taskRevision,
    assigneeId: task.taskAssigneeId,
  };
}

function conflict(message: string, task: Message): never {
  throw new TaskOperationError("CONFLICT", message, snapshot(task));
}

function requireTaskStatus(task: Message): TaskStatus {
  if (!isTaskStatus(task.taskStatus)) throw new TaskOperationError("NOT_FOUND", "task not found");
  return task.taskStatus;
}

function checkExpected(task: Message, expectedRevision?: number, expectedStatus?: TaskStatus): void {
  if (expectedRevision != null && task.taskRevision !== expectedRevision) conflict("task revision is stale", task);
  if (expectedStatus != null && task.taskStatus !== expectedStatus) conflict("task status changed", task);
}

function insertThread(
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
    if (input.parentTaskId) {
      const parent = tx.select({ id: schema.messages.id, channelId: schema.messages.channelId }).from(schema.messages).where(and(
        eq(schema.messages.id, input.parentTaskId),
        eq(schema.messages.spaceId, input.spaceId),
        isNotNull(schema.messages.taskStatus),
      )).get();
      if (!parent) throw new TaskOperationError("INVALID_ARGUMENT", "parent task not found");
      if (parent.channelId !== input.channel.id) throw new TaskOperationError("INVALID_ARGUMENT", "parent and child tasks must use the same channel");
    }
    const taskNumber = allocateTaskNumber(tx, taskNumberKey(input.spaceId, input.channel));
    const threadId = insertThread(tx, {
      id: String(input.message.id),
      spaceId: input.spaceId,
      senderType: input.message.senderType,
      senderId: input.message.senderId,
    }, input.assigneeId, Number(input.message.seq ?? 0));
    created = tx.insert(schema.messages).values({
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
  });
  return created;
}

class ConversionLost extends Error {}

export function convertMessageRecord(input: {
  spaceId: string;
  messageId: string;
  executionMode: "autopilot" | "plan-first";
}): TaskMutationResult | null {
  const db = dbForSpace(input.spaceId);
  let result: TaskMutationResult | null = null;
  try {
    db.transaction((tx) => {
      const current = tx.select().from(schema.messages).where(and(
        eq(schema.messages.id, input.messageId),
        eq(schema.messages.spaceId, input.spaceId),
      )).get();
      if (!current) return;
      if (current.taskStatus) { result = { task: current, changed: false }; return; }
      const channel = tx.select().from(schema.channels).where(eq(schema.channels.id, current.channelId)).get();
      if (!channel) throw new TaskOperationError("INVALID_ARGUMENT", "task channel not found");
      const taskNumber = allocateTaskNumber(tx, taskNumberKey(input.spaceId, channel));
      const existingThread = tx.select().from(schema.channels).where(and(
        eq(schema.channels.spaceId, input.spaceId),
        eq(schema.channels.type, "thread"),
        eq(schema.channels.parentMessageId, current.id),
      )).get();
      const threadId = existingThread?.id ?? insertThread(tx, current);
      const updated = tx.update(schema.messages).set({
        taskStatus: "todo",
        taskNumber,
        taskRevision: 1,
        taskExecutionMode: input.executionMode,
        threadId,
        updatedAt: new Date(),
      }).where(and(
        eq(schema.messages.id, current.id),
        eq(schema.messages.spaceId, input.spaceId),
        isNull(schema.messages.taskStatus),
      )).returning().get();
      if (!updated) throw new ConversionLost();
      result = { task: updated, changed: true };
    });
  } catch (error) {
    if (!(error instanceof ConversionLost)) throw error;
    const current = db.select().from(schema.messages).where(and(
      eq(schema.messages.id, input.messageId),
      eq(schema.messages.spaceId, input.spaceId),
      isNotNull(schema.messages.taskStatus),
    )).get();
    return current ? { task: current, changed: false } : null;
  }
  return result;
}

export function claimTaskRecord(input: {
  spaceId: string;
  messageId: string;
  assigneeType: "human" | "agent";
  assigneeId: string;
  expectedRevision?: number;
}): TaskMutationResult | null {
  const db = dbForSpace(input.spaceId);
  let result: TaskMutationResult | null = null;
  db.transaction((tx) => {
    const current = tx.select().from(schema.messages).where(and(
      eq(schema.messages.id, input.messageId),
      eq(schema.messages.spaceId, input.spaceId),
      isNotNull(schema.messages.taskStatus),
    )).get();
    if (!current) return;
    const status = requireTaskStatus(current);
    if ((status === "todo" || status === "in_progress")
      && current.taskAssigneeType === input.assigneeType && current.taskAssigneeId === input.assigneeId) {
      result = { task: current, changed: false };
      return;
    }
    checkExpected(current, input.expectedRevision);
    if (current.taskAssigneeId) conflict("task is already claimed", current);
    if (status !== "todo" && status !== "in_progress") {
      throw new TaskOperationError("INVALID_TRANSITION", `task in ${status} cannot be claimed`, snapshot(current));
    }
    const updated = tx.update(schema.messages).set({
      taskStatus: "in_progress",
      taskAssigneeType: input.assigneeType,
      taskAssigneeId: input.assigneeId,
      taskClaimedAt: new Date(),
      taskRevision: sql`${schema.messages.taskRevision} + 1`,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.messages.id, current.id),
      eq(schema.messages.spaceId, input.spaceId),
      eq(schema.messages.taskRevision, current.taskRevision),
      eq(schema.messages.taskStatus, status),
      isNull(schema.messages.taskAssigneeId),
    )).returning().get();
    if (!updated) conflict("task claim lost a concurrent race", current);
    result = { task: updated, changed: true };
  });
  return result;
}

export function unclaimTaskRecord(input: {
  spaceId: string;
  messageId: string;
  by?: { type: "human" | "agent"; id: string };
  expectedRevision?: number;
}): TaskMutationResult | null {
  const db = dbForSpace(input.spaceId);
  let result: TaskMutationResult | null = null;
  db.transaction((tx) => {
    const current = tx.select().from(schema.messages).where(and(
      eq(schema.messages.id, input.messageId),
      eq(schema.messages.spaceId, input.spaceId),
      isNotNull(schema.messages.taskStatus),
    )).get();
    if (!current) return;
    const status = requireTaskStatus(current);
    if (!current.taskAssigneeId && status === "todo") { result = { task: current, changed: false }; return; }
    checkExpected(current, input.expectedRevision);
    if (input.by?.type === "agent" && current.taskAssigneeId !== input.by.id) conflict("only the assignee can release this task", current);
    assertTaskTransition(status, "todo");
    const updated = tx.update(schema.messages).set({
      taskStatus: "todo",
      taskAssigneeType: null,
      taskAssigneeId: null,
      taskClaimedAt: null,
      taskCompletedAt: null,
      taskRevision: sql`${schema.messages.taskRevision} + 1`,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.messages.id, current.id),
      eq(schema.messages.spaceId, input.spaceId),
      eq(schema.messages.taskRevision, current.taskRevision),
      eq(schema.messages.taskStatus, status),
    )).returning().get();
    if (!updated) conflict("task release lost a concurrent race", current);
    result = { task: updated, changed: true };
  });
  return result;
}

export function assignTaskRecord(input: {
  spaceId: string;
  messageId: string;
  assigneeId: string;
  by?: { type: "human" | "agent"; id: string };
  expectedRevision?: number;
}): TaskMutationResult | null {
  const db = dbForSpace(input.spaceId);
  let result: TaskMutationResult | null = null;
  db.transaction((tx) => {
    const current = tx.select().from(schema.messages).where(and(
      eq(schema.messages.id, input.messageId),
      eq(schema.messages.spaceId, input.spaceId),
      isNotNull(schema.messages.taskStatus),
    )).get();
    if (!current) return;
    const status = requireTaskStatus(current);
    if (current.taskAssigneeType === "agent" && current.taskAssigneeId === input.assigneeId) {
      result = { task: current, changed: false };
      return;
    }
    checkExpected(current, input.expectedRevision);
    if (current.taskAssigneeId && input.expectedRevision == null
      && !(input.by?.type === "agent" && input.by.id === current.taskAssigneeId)) {
      conflict("expectedRevision is required to reassign a task owned by someone else", current);
    }
    if (status === "done" || status === "closed") {
      throw new TaskOperationError("INVALID_TRANSITION", `task in ${status} cannot be assigned`, snapshot(current));
    }
    const updated = tx.update(schema.messages).set({
      taskStatus: status === "todo" ? "in_progress" : status,
      taskAssigneeType: "agent",
      taskAssigneeId: input.assigneeId,
      taskClaimedAt: new Date(),
      taskRevision: sql`${schema.messages.taskRevision} + 1`,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.messages.id, current.id),
      eq(schema.messages.spaceId, input.spaceId),
      eq(schema.messages.taskRevision, current.taskRevision),
      eq(schema.messages.taskStatus, status),
      current.taskAssigneeId == null
        ? isNull(schema.messages.taskAssigneeId)
        : eq(schema.messages.taskAssigneeId, current.taskAssigneeId),
    )).returning().get();
    if (!updated) conflict("task assignment lost a concurrent race", current);
    result = { task: updated, changed: true };
  });
  return result;
}

export function transitionTaskRecord(input: {
  spaceId: string;
  messageId: string;
  to: TaskStatus;
  from?: TaskStatus;
  expectedRevision?: number;
  audit?: MessageInsert;
}): TaskMutationResult | null {
  const db = dbForSpace(input.spaceId);
  let result: TaskMutationResult | null = null;
  db.transaction((tx) => {
    const current = tx.select().from(schema.messages).where(and(
      eq(schema.messages.id, input.messageId),
      eq(schema.messages.spaceId, input.spaceId),
      isNotNull(schema.messages.taskStatus),
    )).get();
    if (!current) return;
    const status = requireTaskStatus(current);
    if (status === input.to) { result = { task: current, changed: false }; return; }
    checkExpected(current, input.expectedRevision, input.from);
    assertTaskTransition(status, input.to);
    const finished = input.to === "done" || input.to === "closed";
    const updated = tx.update(schema.messages).set({
      taskStatus: input.to,
      taskCompletedAt: finished ? new Date() : null,
      taskRevision: sql`${schema.messages.taskRevision} + 1`,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.messages.id, current.id),
      eq(schema.messages.spaceId, input.spaceId),
      eq(schema.messages.taskRevision, current.taskRevision),
      eq(schema.messages.taskStatus, status),
    )).returning().get();
    if (!updated) conflict("task transition lost a concurrent race", current);
    const audit = input.audit ? tx.insert(schema.messages).values(input.audit).returning().get() : undefined;
    if (audit) tx.update(schema.channels).set({ lastMessageAt: new Date() }).where(eq(schema.channels.id, audit.channelId)).run();
    result = { task: updated, changed: true, audit };
  });
  return result;
}
