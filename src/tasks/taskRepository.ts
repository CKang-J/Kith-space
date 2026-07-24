import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { allocateTaskNumber, taskNumberKey, type SpaceTransaction } from "../counters.js";
import { dbForSpace, schema } from "../db/index.js";
import { assertTaskTransition } from "./taskPolicy.js";
import { insertTaskOwningThread, taskThreadMembership } from "./taskCreation.js";
import { isTaskStatus, TaskOperationError, type TaskStatus } from "./taskTypes.js";
import { DeliveryJournal } from "../deliveries/deliveryJournal.js";
import { revokeTaskScopedThreadAccessInTransaction } from "../channels/taskScopedAccess.js";
import type { RevokedTaskScopedAccess } from "../channels/taskScopedAccess.js";

type Message = typeof schema.messages.$inferSelect;
type MessageInsert = typeof schema.messages.$inferInsert;

export interface TaskMutationResult {
  task: Message;
  changed: boolean;
  audit?: Message;
  revokedTaskAccess?: RevokedTaskScopedAccess;
}

export interface TaskDispatchChainInsert {
  id: string;
  spaceId: string;
  rootMessageId: string;
  taskMessageId: string;
  channelId: string;
  dispatchDepth: number;
}

export interface TaskAuditWrite {
  message: MessageInsert;
  dispatchChain?: TaskDispatchChainInsert;
  agentMembership?: { channelId: string; agentId: string; watermark: number };
}

function insertAudit(tx: SpaceTransaction, write: TaskAuditWrite | undefined): Message | undefined {
  if (!write) return undefined;
  if (write.dispatchChain) {
    tx.insert(schema.dispatchChains).values({
      id: write.dispatchChain.id,
      spaceId: write.dispatchChain.spaceId,
      rootMessageId: write.dispatchChain.rootMessageId,
      taskMessageId: write.dispatchChain.taskMessageId,
      channelId: write.dispatchChain.channelId,
      maxDepthSeen: write.dispatchChain.dispatchDepth,
    }).onConflictDoNothing().run();
  }
  if (write.agentMembership) {
    const thread = tx.select().from(schema.channels).where(eq(schema.channels.id, write.agentMembership.channelId)).get();
    const task = thread?.parentMessageId
      ? tx.select().from(schema.messages).where(eq(schema.messages.id, thread.parentMessageId)).get()
      : null;
    if (thread && task) {
      tx.insert(schema.channelAgentMembers).values(taskThreadMembership(tx, {
        parentChannelId: task.channelId,
        threadId: thread.id,
        taskId: task.id,
        agentId: write.agentMembership.agentId,
        watermark: write.agentMembership.watermark,
      })).onConflictDoUpdate({
        target: [schema.channelAgentMembers.channelId, schema.channelAgentMembers.agentId],
        set: taskThreadMembership(tx, {
          parentChannelId: task.channelId,
          threadId: thread.id,
          taskId: task.id,
          agentId: write.agentMembership.agentId,
          watermark: write.agentMembership.watermark,
        }),
      }).run();
    }
  }
  const audit = tx.insert(schema.messages).values(write.message).returning().get();
  new DeliveryJournal().persistChannelMessageInTransaction(tx, audit.spaceId, audit);
  tx.update(schema.channels).set({ lastMessageAt: new Date() })
    .where(eq(schema.channels.id, audit.channelId)).run();
  return audit;
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

class ConversionLost extends Error {}

export function convertMessageRecord(input: {
  spaceId: string;
  messageId: string;
  executionMode: "autopilot" | "plan-first";
  audit?: (task: Message) => TaskAuditWrite;
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
      const threadId = existingThread?.id ?? insertTaskOwningThread(tx, { ...current, channelId: current.channelId });
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
      const audit = insertAudit(tx, input.audit?.(updated));
      result = { task: updated, changed: true, audit };
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
  audit?: (task: Message) => TaskAuditWrite;
  precondition?: (tx: SpaceTransaction, task: Message) => void;
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
    input.precondition?.(tx, current);
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
    const audit = insertAudit(tx, input.audit?.(updated));
    result = { task: updated, changed: true, audit };
  });
  return result;
}

export function unclaimTaskRecord(input: {
  spaceId: string;
  messageId: string;
  by?: { type: "human" | "agent"; id: string };
  expectedRevision?: number;
  audit?: (task: Message) => TaskAuditWrite;
  precondition?: (tx: SpaceTransaction, task: Message) => void;
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
    input.precondition?.(tx, current);
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
    const audit = insertAudit(tx, input.audit?.(updated));
    const revokedTaskAccess = current.taskAssigneeType === "agent" && current.taskAssigneeId && current.threadId
      ? revokeTaskScopedThreadAccessInTransaction(tx, { threadId: current.threadId, agentIds: [current.taskAssigneeId] })
      : undefined;
    result = { task: updated, changed: true, audit, revokedTaskAccess };
  });
  return result;
}

export function assignTaskRecord(input: {
  spaceId: string;
  messageId: string;
  assigneeId: string;
  by?: { type: "human" | "agent"; id: string };
  expectedRevision?: number;
  audit?: (task: Message) => TaskAuditWrite;
  precondition?: (tx: SpaceTransaction, task: Message) => void;
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
    input.precondition?.(tx, current);
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
    const audit = insertAudit(tx, input.audit?.(updated));
    const revokedTaskAccess = current.taskAssigneeType === "agent" && current.taskAssigneeId
      && current.taskAssigneeId !== input.assigneeId && current.threadId
      ? revokeTaskScopedThreadAccessInTransaction(tx, { threadId: current.threadId, agentIds: [current.taskAssigneeId] })
      : undefined;
    result = { task: updated, changed: true, audit, revokedTaskAccess };
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
  dispatchChain?: TaskDispatchChainInsert;
  agentMembership?: TaskAuditWrite["agentMembership"];
  precondition?: (tx: SpaceTransaction, task: Message) => void;
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
    input.precondition?.(tx, current);
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
    const audit = insertAudit(tx, input.audit
      ? {
          message: input.audit,
          dispatchChain: input.dispatchChain,
          agentMembership: input.agentMembership,
        }
      : undefined);
    // Revoke last so a terminal audit cannot recreate the bounded membership or leave a new delivery pending.
    const revokedTaskAccess = finished && updated.threadId
      ? revokeTaskScopedThreadAccessInTransaction(tx, { threadId: updated.threadId })
      : undefined;
    result = { task: updated, changed: true, audit, revokedTaskAccess };
  });
  return result;
}
