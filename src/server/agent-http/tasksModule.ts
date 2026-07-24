import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { dbForSpace, schema } from "../../db/index.js";
import {
  TASK_STATUSES,
  assignTask,
  claimTask,
  convertMessageToTask,
  createMessage,
  resolveMessageId,
  resolveTarget,
  setTaskStatus,
  unclaimTask,
} from "../core.js";
import { normalizeTaskExecutionMode } from "../dispatchGuard.js";
import { sendTaskOperationError } from "../tasks/taskHttp.js";
import { getTaskDetails, reportTask, submitTaskDelivery } from "../taskWorkflowAdapter.js";
import { readJson, sendErr, sendJson } from "../util.js";
import type { AgentHttpContext } from "./context.js";

export async function handleTasksModule(context: AgentHttpContext): Promise<boolean> {
  const { req, res, url, method, path, agent, spaceId } = context;
  const db = dbForSpace(spaceId);

  const ensureTask = async (messageId: string) => {
    const current = db.select({ status: schema.messages.taskStatus }).from(schema.messages)
      .where(eq(schema.messages.id, messageId)).get();
    if (current && !current.status) {
      await convertMessageToTask(spaceId, messageId, { type: "agent", id: agent.id });
    }
  };
  const resolveTaskReference = async (body: Record<string, any>, requireExistingTask = false) => {
    if (body.number != null && body.channel) {
      const target = await resolveTarget(spaceId, String(body.channel), agent.id);
      if (!target) return null;
      return db.select({ id: schema.messages.id }).from(schema.messages).where(and(
        eq(schema.messages.channelId, target.channelId),
        eq(schema.messages.taskNumber, Number(body.number)),
        ...(requireExistingTask ? [isNotNull(schema.messages.taskStatus)] : []),
      )).get()?.id ?? null;
    }
    return resolveMessageId(spaceId, body.messageId, agent.id);
  };

  if (path === "/agent-api/task/list" && method === "GET") {
    const target = await resolveTarget(spaceId, url.searchParams.get("channel") ?? "", agent.id);
    if (!target) return (sendErr(res, 404, "channel not found"), true);
    const tasks = db.select().from(schema.messages).where(and(
      eq(schema.messages.channelId, target.channelId),
      isNotNull(schema.messages.taskStatus),
    )).orderBy(asc(schema.messages.taskNumber)).all();
    sendJson(res, 200, {
      tasks: tasks.map((task) => ({
        number: task.taskNumber,
        status: task.taskStatus,
        executionMode: task.taskExecutionMode,
        content: task.content,
        id: task.id,
        threadId: task.threadId,
        parentTaskId: task.taskParentId,
        assigneeId: task.taskAssigneeId,
        revision: task.taskRevision,
      })),
    });
    return true;
  }

  if (path === "/agent-api/task/get" && method === "GET") {
    const messageId = await resolveMessageId(
      spaceId,
      url.searchParams.get("messageId") ?? url.searchParams.get("id"),
      agent.id,
    );
    if (!messageId) return (sendErr(res, 404, "task not found"), true);
    const details = await getTaskDetails(spaceId, messageId);
    if (!details) return (sendErr(res, 404, "task not found"), true);
    sendJson(res, 200, details);
    return true;
  }

  if (path === "/agent-api/task/claim" && method === "POST") {
    const body = await readJson(req);
    const messageId = await resolveTaskReference(body);
    if (!messageId) return (sendErr(res, 404, "task not found"), true);
    await ensureTask(messageId);
    let claimed;
    try {
      claimed = await claimTask(spaceId, messageId, "agent", agent.id, body.expectedRevision);
    } catch (error) {
      if (sendTaskOperationError(res, error)) return true;
      throw error;
    }
    if (!claimed) return (sendErr(res, 404, "task not found"), true);
    const task = db.select().from(schema.messages).where(eq(schema.messages.id, messageId)).get();
    const threadTarget = task ? `thread:${messageId.slice(0, 8)}` : null;
    sendJson(res, 200, {
      ok: true,
      claimed: messageId,
      number: task?.taskNumber ?? null,
      revision: claimed.taskRevision,
      threadTarget,
      followUp: threadTarget
        ? `Follow up in the task's thread: kith-space message send --target "${threadTarget}"`
        : null,
    });
    return true;
  }

  if (path === "/agent-api/task/update" && method === "POST") {
    const body = await readJson(req);
    const messageId = await resolveTaskReference(body);
    if (!messageId) return (sendErr(res, 404, "message not found"), true);
    if (!(TASK_STATUSES as readonly string[]).includes(String(body.status))) {
      return (sendErr(res, 400, `valid status is required (${TASK_STATUSES.join(", ")})`), true);
    }
    await ensureTask(messageId);
    let updated;
    try {
      updated = await setTaskStatus(
        spaceId,
        messageId,
        body.status,
        { type: "agent", id: agent.id },
        { from: body.from, expectedRevision: body.expectedRevision },
      );
    } catch (error) {
      if (sendTaskOperationError(res, error)) return true;
      throw error;
    }
    if (!updated) return (sendErr(res, 404, "task not found"), true);
    sendJson(res, 200, { ok: true, status: updated.taskStatus, revision: updated.taskRevision });
    return true;
  }

  if (path === "/agent-api/task/assign" && method === "POST") {
    const body = await readJson(req);
    const assigneeName = String(body.to ?? "").trim().replace(/^@/, "");
    if (!assigneeName) return (sendErr(res, 400, "to required"), true);
    const assignee = db.select().from(schema.agents).where(and(
      eq(schema.agents.spaceId, spaceId),
      eq(schema.agents.name, assigneeName),
      isNull(schema.agents.deletedAt),
    )).get();
    if (!assignee) return (sendErr(res, 404, "target agent not found"), true);
    const messageId = await resolveTaskReference(body, true);
    if (!messageId) return (sendErr(res, 404, "task not found"), true);
    let assigned;
    try {
      assigned = await assignTask(
        spaceId,
        messageId,
        assignee.id,
        { type: "agent", id: agent.id },
        body.expectedRevision,
      );
    } catch (error) {
      if (sendTaskOperationError(res, error)) return true;
      throw error;
    }
    if (!assigned) return (sendErr(res, 404, "task not found"), true);
    const threadTarget = `thread:${assigned.id.slice(0, 8)}`;
    sendJson(res, 200, {
      ok: true,
      assigned: assigned.id,
      number: assigned.taskNumber ?? null,
      revision: assigned.taskRevision,
      to: assignee.name,
      threadTarget,
      followUp: `Follow up in the task's thread: kith-space message send --target "${threadTarget}"`,
    });
    return true;
  }

  if (path === "/agent-api/task/new" && method === "POST") {
    const body = await readJson(req);
    const tasks = (Array.isArray(body.tasks)
      ? body.tasks
      : body.title ? [{ title: body.title, executionMode: body.executionMode }] : [])
      .map((task: any) => ({
        title: String(task?.title ?? "").trim(),
        mode: normalizeTaskExecutionMode(task?.executionMode ?? body.executionMode),
      }))
      .filter((task: { title: string }) => Boolean(task.title));
    if (!tasks.length) return (sendErr(res, 400, "title required"), true);
    if (tasks.some((task: { mode: unknown }) => !task.mode)) {
      return (sendErr(res, 400, "executionMode must be autopilot or plan-first"), true);
    }
    const target = await resolveTarget(spaceId, body.target ?? body.channel ?? "", agent.id);
    if (!target) return (sendErr(res, 404, "channel not found"), true);
    const parentTaskId = body.parentTaskId
      ? await resolveMessageId(spaceId, body.parentTaskId, agent.id)
      : null;
    if (body.parentTaskId && !parentTaskId) return (sendErr(res, 404, "parent task not found"), true);
    const created = [];
    try {
      for (const task of tasks) {
        const message = await createMessage({
          spaceId,
          channelId: target.channelId,
          senderType: "agent",
          senderId: agent.id,
          senderName: agent.name,
          content: task.title,
          asTask: true,
          taskExecutionMode: task.mode!,
          taskParentId: parentTaskId,
        });
        created.push({
          id: message.id,
          number: message.taskNumber,
          content: message.content,
          executionMode: message.taskExecutionMode,
          threadId: message.threadId,
          parentTaskId: message.taskParentId,
          revision: message.taskRevision,
        });
      }
    } catch (error) {
      if (sendTaskOperationError(res, error)) return true;
      throw error;
    }
    sendJson(res, 200, { ok: true, tasks: created });
    return true;
  }

  if (path === "/agent-api/task/report" && method === "POST") {
    const body = await readJson(req);
    const messageId = await resolveMessageId(spaceId, body.messageId ?? body.taskId, agent.id);
    if (!messageId) return (sendErr(res, 404, "task not found"), true);
    try {
      const result = await reportTask({
        spaceId,
        taskId: messageId,
        actor: { type: "agent", id: agent.id, name: agent.name },
        kind: body.kind,
        content: String(body.content ?? ""),
        artifactRefs: body.artifactRefs,
      });
      sendJson(res, 200, {
        ok: true,
        taskId: messageId,
        reportMessageId: result.report.id,
        threadId: result.report.channelId,
        threadTarget: `thread:${messageId.slice(0, 8)}`,
      });
      return true;
    } catch (error) {
      if (sendTaskOperationError(res, error)) return true;
      throw error;
    }
  }

  if (path === "/agent-api/task/delivery" && method === "POST") {
    const body = await readJson(req);
    const messageId = await resolveMessageId(spaceId, body.messageId ?? body.taskId, agent.id);
    if (!messageId) return (sendErr(res, 404, "task not found"), true);
    try {
      const result = await submitTaskDelivery({
        spaceId,
        taskId: messageId,
        actor: { type: "agent", id: agent.id, name: agent.name },
        expectedRevision: Number(body.expectedRevision),
        summary: String(body.summary ?? ""),
        childTaskIds: body.childTaskIds,
        artifactRefs: body.artifactRefs,
      });
      sendJson(res, 200, {
        ok: true,
        taskId: messageId,
        deliveryMessageId: result.delivery.id,
        status: result.task.taskStatus,
        revision: result.task.taskRevision,
        childTaskIds: result.children.map((child) => child.id),
        reportMessageIds: result.reportMessageIds,
      });
      return true;
    } catch (error) {
      if (sendTaskOperationError(res, error)) return true;
      throw error;
    }
  }

  if (path === "/agent-api/task/unclaim" && method === "POST") {
    const body = await readJson(req);
    const messageId = await resolveMessageId(spaceId, body.messageId, agent.id);
    if (!messageId) return (sendErr(res, 404, "message not found"), true);
    let task;
    try {
      task = await unclaimTask(
        spaceId,
        messageId,
        { type: "agent", id: agent.id },
        body.expectedRevision,
      );
    } catch (error) {
      if (sendTaskOperationError(res, error)) return true;
      throw error;
    }
    if (!task) return (sendErr(res, 404, "task not found"), true);
    sendJson(res, 200, { ok: true, taskStatus: task.taskStatus });
    return true;
  }

  return false;
}
