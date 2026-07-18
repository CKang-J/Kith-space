import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { assertChannelWritable } from "../channels/channelLifecycle.js";
import { nextSeq } from "../counters.js";
import { dbForSpace, schema } from "../db/index.js";
import { getHumanIdentity } from "../human/humanIdentity.js";
import { humanChannelState, reactivateFollowedHumanThread } from "../human/humanChannelState.js";
import { serializeMessage } from "../messages/messageSerialization.js";
import { isTaskStatus, parseTaskActionMetadata, TaskOperationError, type TaskArtifactRef, type TaskReportKind } from "./taskTypes.js";

type Actor = { type: "human" | "agent"; id: string; name: string };
type Message = typeof schema.messages.$inferSelect;

export interface TaskWorkflowEventSink {
  publish(spaceId: string, event: unknown): Promise<void>;
}

let eventSink: TaskWorkflowEventSink | null = null;

export function configureTaskWorkflowEvents(sink: TaskWorkflowEventSink): void {
  eventSink = sink;
}

async function publish(spaceId: string, event: unknown): Promise<void> {
  if (!eventSink) throw new Error("Task workflow event sink is not configured");
  await eventSink.publish(spaceId, event);
}

function currentView(task: Message) {
  return { id: task.id, status: task.taskStatus, revision: task.taskRevision, assigneeId: task.taskAssigneeId };
}

function validateArtifacts(value: TaskArtifactRef[] | undefined): TaskArtifactRef[] {
  const refs = value ?? [];
  if (!refs.every((ref) => ref && ["file", "url", "message"].includes(ref.kind) && typeof ref.ref === "string" && !!ref.ref.trim())) {
    throw new TaskOperationError("INVALID_ARGUMENT", "artifactRefs must contain file, url, or message references");
  }
  return refs.map((ref) => ({ ...ref, ref: ref.ref.trim() }));
}

async function assertTaskWritable(spaceId: string, taskId: string): Promise<void> {
  const task = (await dbForSpace(spaceId).select({ channelId: schema.messages.channelId }).from(schema.messages).where(and(
    eq(schema.messages.id, taskId),
    eq(schema.messages.spaceId, spaceId),
    isNotNull(schema.messages.taskStatus),
  )))[0];
  if (!task) throw new TaskOperationError("NOT_FOUND", "task not found");
  await assertChannelWritable(spaceId, task.channelId);
}

async function publishThreadUpdate(spaceId: string, threadId: string, parentMessageId: string, sender: Actor): Promise<void> {
  const db = dbForSpace(spaceId);
  const replies = await db.select({ id: schema.messages.id }).from(schema.messages).where(eq(schema.messages.channelId, threadId));
  const participants = await db.select({ id: schema.channelAgentMembers.agentId }).from(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.channelId, threadId));
  const humanState = await humanChannelState(spaceId, threadId);
  const parent = (await db.select({ channelId: schema.messages.channelId }).from(schema.messages).where(eq(schema.messages.id, parentMessageId)))[0];
  await publish(spaceId, {
    type: "thread:updated",
    threadChannelId: threadId,
    parentMessageId,
    parentChannelId: parent?.channelId ?? null,
    replyCount: replies.length,
    participantIds: [
      ...participants.map((participant) => participant.id),
      ...(humanState?.threadFollowedAt ? [getHumanIdentity()?.id].filter((id): id is string => Boolean(id)) : []),
    ],
    senderId: sender.id,
    senderType: sender.type,
  });
}

export async function reportTask(input: {
  spaceId: string;
  taskId: string;
  actor: Actor;
  kind: TaskReportKind;
  content: string;
  artifactRefs?: TaskArtifactRef[];
}): Promise<{ task: Message; report: Message }> {
  const content = input.content.trim();
  if (!content) throw new TaskOperationError("INVALID_ARGUMENT", "report content is required");
  if (!["progress", "blocker", "question", "result"].includes(input.kind)) {
    throw new TaskOperationError("INVALID_ARGUMENT", "invalid task report kind");
  }
  const artifactRefs = validateArtifacts(input.artifactRefs);
  await assertTaskWritable(input.spaceId, input.taskId);
  const seq = await nextSeq(input.spaceId);
  const db = dbForSpace(input.spaceId);
  let task!: Message;
  let report!: Message;
  db.transaction((tx) => {
    task = tx.select().from(schema.messages).where(and(
      eq(schema.messages.id, input.taskId),
      eq(schema.messages.spaceId, input.spaceId),
      isNotNull(schema.messages.taskStatus),
    )).get()!;
    if (!task) throw new TaskOperationError("NOT_FOUND", "task not found");
    if (!task.threadId) throw new TaskOperationError("INVALID_ARGUMENT", "task has no report thread", currentView(task));
    report = tx.insert(schema.messages).values({
      id: randomUUID(),
      seq,
      spaceId: input.spaceId,
      channelId: task.threadId,
      senderType: input.actor.type,
      senderId: input.actor.id,
      senderName: input.actor.name,
      messageType: "action",
      content,
      searchText: content,
      actionMetadata: { kind: "task-report", taskId: task.id, reportKind: input.kind, artifactRefs },
      dispatchChainId: task.dispatchChainId,
      dispatchDepth: task.dispatchDepth,
    }).returning().get();
    if (input.actor.type === "human") {
      const followedAt = new Date();
      tx.insert(schema.humanChannelStates).values({ channelId: task.threadId, threadFollowedAt: followedAt, threadDoneAt: null, updatedAt: followedAt })
        .onConflictDoUpdate({
          target: schema.humanChannelStates.channelId,
          set: { threadFollowedAt: followedAt, threadDoneAt: null, updatedAt: followedAt },
        }).run();
    } else {
      tx.insert(schema.channelAgentMembers).values({ channelId: task.threadId, agentId: input.actor.id }).onConflictDoNothing().run();
    }
    tx.update(schema.channels).set({ lastMessageAt: new Date() }).where(eq(schema.channels.id, task.threadId)).run();
  });
  await reactivateFollowedHumanThread(input.spaceId, report.channelId);
  const thread = (await db.select().from(schema.channels).where(eq(schema.channels.id, report.channelId)))[0];
  await publish(input.spaceId, { type: "message", channelId: report.channelId, message: { ...serializeMessage(report, []), channelType: thread?.type ?? null } });
  await publishThreadUpdate(input.spaceId, report.channelId, task.id, input.actor);
  return { task, report };
}

export async function submitTaskDelivery(input: {
  spaceId: string;
  taskId: string;
  actor: Actor;
  expectedRevision: number;
  summary: string;
  childTaskIds?: string[];
  artifactRefs?: TaskArtifactRef[];
}): Promise<{ task: Message; delivery: Message; children: Message[]; reportMessageIds: string[] }> {
  const summary = input.summary.trim();
  if (!summary) throw new TaskOperationError("INVALID_ARGUMENT", "delivery summary is required");
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new TaskOperationError("INVALID_ARGUMENT", "expectedRevision is required");
  }
  const childTaskIds = [...new Set(input.childTaskIds ?? [])];
  const artifactRefs = validateArtifacts(input.artifactRefs);
  await assertTaskWritable(input.spaceId, input.taskId);
  const seq = await nextSeq(input.spaceId);
  const db = dbForSpace(input.spaceId);
  let task!: Message;
  let delivery!: Message;
  let children: Message[] = [];
  let reportMessageIds: string[] = [];
  db.transaction((tx) => {
    const current = tx.select().from(schema.messages).where(and(
      eq(schema.messages.id, input.taskId),
      eq(schema.messages.spaceId, input.spaceId),
      isNotNull(schema.messages.taskStatus),
    )).get();
    if (!current) throw new TaskOperationError("NOT_FOUND", "task not found");
    if (current.taskRevision !== input.expectedRevision) {
      throw new TaskOperationError("CONFLICT", "task revision is stale", currentView(current));
    }
    if (current.taskStatus !== "in_progress") {
      throw new TaskOperationError("INVALID_TRANSITION", `delivery requires in_progress, current status is ${current.taskStatus}`, currentView(current));
    }
    if (childTaskIds.length) {
      children = tx.select().from(schema.messages).where(and(
        eq(schema.messages.spaceId, input.spaceId),
        inArray(schema.messages.id, childTaskIds),
        eq(schema.messages.taskParentId, current.id),
        isNotNull(schema.messages.taskStatus),
      )).all();
      if (children.length !== childTaskIds.length) throw new TaskOperationError("INVALID_ARGUMENT", "every childTaskId must be a direct child of the delivery task");
    }
    const sourceThreadIds = children.flatMap((child) => child.threadId ? [child.threadId] : []);
    if (sourceThreadIds.length) {
      reportMessageIds = tx.select().from(schema.messages).where(and(
        eq(schema.messages.spaceId, input.spaceId),
        inArray(schema.messages.channelId, sourceThreadIds),
      )).all().filter((message) => parseTaskActionMetadata(message.actionMetadata)?.kind === "task-report").map((message) => message.id);
    }
    delivery = tx.insert(schema.messages).values({
      id: randomUUID(),
      seq,
      spaceId: input.spaceId,
      channelId: current.channelId,
      senderType: input.actor.type,
      senderId: input.actor.id,
      senderName: input.actor.name,
      messageType: "action",
      content: summary,
      searchText: summary,
      actionMetadata: {
        kind: "task-delivery",
        taskId: current.id,
        childTaskIds,
        sourceThreadIds,
        reportMessageIds,
        artifactRefs,
      },
      dispatchChainId: current.dispatchChainId,
      dispatchDepth: current.dispatchDepth,
    }).returning().get();
    task = tx.update(schema.messages).set({
      taskStatus: "in_review",
      taskCompletedAt: null,
      taskRevision: sql`${schema.messages.taskRevision} + 1`,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.messages.id, current.id),
      eq(schema.messages.spaceId, input.spaceId),
      eq(schema.messages.taskStatus, "in_progress"),
      eq(schema.messages.taskRevision, input.expectedRevision),
    )).returning().get()!;
    if (!task) throw new TaskOperationError("CONFLICT", "delivery lost a concurrent task update", currentView(current));
    tx.update(schema.channels).set({ lastMessageAt: new Date() }).where(eq(schema.channels.id, current.channelId)).run();
  });
  const channel = (await db.select().from(schema.channels).where(eq(schema.channels.id, delivery.channelId)))[0];
  await publish(input.spaceId, { type: "message", channelId: delivery.channelId, message: { ...serializeMessage(delivery, []), channelType: channel?.type ?? null } });
  await publish(input.spaceId, { type: "task", op: "updated", task: serializeMessage(task, []) });
  return { task, delivery, children, reportMessageIds };
}

export async function getTaskDetails(spaceId: string, taskId: string) {
  const db = dbForSpace(spaceId);
  const task = (await db.select().from(schema.messages).where(and(
    eq(schema.messages.id, taskId),
    eq(schema.messages.spaceId, spaceId),
    isNotNull(schema.messages.taskStatus),
  )))[0];
  if (!task) return null;
  const parent = task.taskParentId
    ? (await db.select().from(schema.messages).where(and(eq(schema.messages.id, task.taskParentId), isNotNull(schema.messages.taskStatus))))[0] ?? null
    : null;
  const children = await db.select().from(schema.messages).where(and(
    eq(schema.messages.spaceId, spaceId),
    eq(schema.messages.taskParentId, task.id),
    isNotNull(schema.messages.taskStatus),
  )).orderBy(asc(schema.messages.taskNumber));
  const reportThreads = [task, ...children].flatMap((item) => item.threadId ? [item.threadId] : []);
  const reports = reportThreads.length
    ? (await db.select().from(schema.messages).where(and(eq(schema.messages.spaceId, spaceId), inArray(schema.messages.channelId, reportThreads))).orderBy(asc(schema.messages.seq)))
      .filter((message) => parseTaskActionMetadata(message.actionMetadata)?.kind === "task-report")
    : [];
  const deliveryCandidates = await db.select().from(schema.messages).where(and(
    eq(schema.messages.spaceId, spaceId),
    eq(schema.messages.channelId, task.channelId),
  )).orderBy(asc(schema.messages.seq));
  const deliveries = deliveryCandidates.filter((message) => {
    const metadata = parseTaskActionMetadata(message.actionMetadata);
    return metadata?.kind === "task-delivery" && metadata.taskId === task.id;
  });
  return { task, parent, children, reports, deliveries };
}
