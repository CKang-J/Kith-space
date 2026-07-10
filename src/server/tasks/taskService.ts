import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { dbFor, schema } from "../../db/index.js";
import { nextSeq, publish } from "../realtime.js";
import { serializeMsg } from "../core.js";
import { isTaskStatus, parseTaskActionMetadata, TaskOperationError, type TaskArtifactRef, type TaskReportKind } from "./taskTypes.js";

type Actor = { type: "user" | "agent"; id: string; name: string };
type Message = typeof schema.messages.$inferSelect;

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

async function publishThreadUpdate(serverId: string, threadId: string, parentMessageId: string, sender: Actor): Promise<void> {
  const db = dbFor(serverId);
  const replies = await db.select({ id: schema.messages.id }).from(schema.messages).where(eq(schema.messages.channelId, threadId));
  const participants = await db.select({ id: schema.channelMembers.memberId }).from(schema.channelMembers).where(eq(schema.channelMembers.channelId, threadId));
  const parent = (await db.select({ channelId: schema.messages.channelId }).from(schema.messages).where(eq(schema.messages.id, parentMessageId)))[0];
  await publish(serverId, {
    type: "thread:updated",
    threadChannelId: threadId,
    parentMessageId,
    parentChannelId: parent?.channelId ?? null,
    replyCount: replies.length,
    participantIds: participants.map((participant) => participant.id),
    senderId: sender.id,
    senderType: sender.type,
  });
}

export async function reportTask(input: {
  serverId: string;
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
  const seq = await nextSeq(input.serverId);
  const db = dbFor(input.serverId);
  let task!: Message;
  let report!: Message;
  db.transaction((tx) => {
    task = tx.select().from(schema.messages).where(and(
      eq(schema.messages.id, input.taskId),
      eq(schema.messages.serverId, input.serverId),
      isNotNull(schema.messages.taskStatus),
    )).get()!;
    if (!task) throw new TaskOperationError("NOT_FOUND", "task not found");
    if (!task.threadId) throw new TaskOperationError("INVALID_ARGUMENT", "task has no report thread", currentView(task));
    report = tx.insert(schema.messages).values({
      id: randomUUID(),
      seq,
      serverId: input.serverId,
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
    tx.insert(schema.channelMembers).values({ channelId: task.threadId, memberType: input.actor.type, memberId: input.actor.id }).onConflictDoNothing().run();
    tx.update(schema.channels).set({ lastMessageAt: new Date() }).where(eq(schema.channels.id, task.threadId)).run();
  });
  const thread = (await db.select().from(schema.channels).where(eq(schema.channels.id, report.channelId)))[0];
  await publish(input.serverId, { type: "message", channelId: report.channelId, message: { ...serializeMsg(report, []), channelType: thread?.type ?? null } });
  await publishThreadUpdate(input.serverId, report.channelId, task.id, input.actor);
  return { task, report };
}

export async function submitTaskDelivery(input: {
  serverId: string;
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
  const seq = await nextSeq(input.serverId);
  const db = dbFor(input.serverId);
  let task!: Message;
  let delivery!: Message;
  let children: Message[] = [];
  let reportMessageIds: string[] = [];
  db.transaction((tx) => {
    const current = tx.select().from(schema.messages).where(and(
      eq(schema.messages.id, input.taskId),
      eq(schema.messages.serverId, input.serverId),
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
        eq(schema.messages.serverId, input.serverId),
        inArray(schema.messages.id, childTaskIds),
        eq(schema.messages.taskParentId, current.id),
        isNotNull(schema.messages.taskStatus),
      )).all();
      if (children.length !== childTaskIds.length) throw new TaskOperationError("INVALID_ARGUMENT", "every childTaskId must be a direct child of the delivery task");
    }
    const sourceThreadIds = children.flatMap((child) => child.threadId ? [child.threadId] : []);
    if (sourceThreadIds.length) {
      reportMessageIds = tx.select().from(schema.messages).where(and(
        eq(schema.messages.serverId, input.serverId),
        inArray(schema.messages.channelId, sourceThreadIds),
      )).all().filter((message) => parseTaskActionMetadata(message.actionMetadata)?.kind === "task-report").map((message) => message.id);
    }
    delivery = tx.insert(schema.messages).values({
      id: randomUUID(),
      seq,
      serverId: input.serverId,
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
      eq(schema.messages.serverId, input.serverId),
      eq(schema.messages.taskStatus, "in_progress"),
      eq(schema.messages.taskRevision, input.expectedRevision),
    )).returning().get()!;
    if (!task) throw new TaskOperationError("CONFLICT", "delivery lost a concurrent task update", currentView(current));
    tx.update(schema.channels).set({ lastMessageAt: new Date() }).where(eq(schema.channels.id, current.channelId)).run();
  });
  const channel = (await db.select().from(schema.channels).where(eq(schema.channels.id, delivery.channelId)))[0];
  await publish(input.serverId, { type: "message", channelId: delivery.channelId, message: { ...serializeMsg(delivery, []), channelType: channel?.type ?? null } });
  await publish(input.serverId, { type: "task", op: "updated", task: serializeMsg(task, []) });
  return { task, delivery, children, reportMessageIds };
}

export async function getTaskDetails(serverId: string, taskId: string) {
  const db = dbFor(serverId);
  const task = (await db.select().from(schema.messages).where(and(
    eq(schema.messages.id, taskId),
    eq(schema.messages.serverId, serverId),
    isNotNull(schema.messages.taskStatus),
  )))[0];
  if (!task) return null;
  const parent = task.taskParentId
    ? (await db.select().from(schema.messages).where(and(eq(schema.messages.id, task.taskParentId), isNotNull(schema.messages.taskStatus))))[0] ?? null
    : null;
  const children = await db.select().from(schema.messages).where(and(
    eq(schema.messages.serverId, serverId),
    eq(schema.messages.taskParentId, task.id),
    isNotNull(schema.messages.taskStatus),
  )).orderBy(asc(schema.messages.taskNumber));
  const reportThreads = [task, ...children].flatMap((item) => item.threadId ? [item.threadId] : []);
  const reports = reportThreads.length
    ? (await db.select().from(schema.messages).where(and(eq(schema.messages.serverId, serverId), inArray(schema.messages.channelId, reportThreads))).orderBy(asc(schema.messages.seq)))
      .filter((message) => parseTaskActionMetadata(message.actionMetadata)?.kind === "task-report")
    : [];
  const deliveryCandidates = await db.select().from(schema.messages).where(and(
    eq(schema.messages.serverId, serverId),
    eq(schema.messages.channelId, task.channelId),
  )).orderBy(asc(schema.messages.seq));
  const deliveries = deliveryCandidates.filter((message) => {
    const metadata = parseTaskActionMetadata(message.actionMetadata);
    return metadata?.kind === "task-delivery" && metadata.taskId === task.id;
  });
  return { task, parent, children, reports, deliveries };
}
