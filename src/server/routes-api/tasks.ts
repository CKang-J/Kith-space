// Auto-extracted from the former routes-api.ts monolith — bodies are verbatim.
import type { SpaceCtx } from "./ctx.js";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { dbForSpace, schema } from "../../db/index.js";
import { TASK_STATUSES, assignTask, claimTask, convertMessageToTask, createMessage, deleteTask, setTaskExecutionMode, setTaskStatus, unclaimTask } from "../core.js";
import { normalizeTaskExecutionMode } from "../dispatchGuard.js";
import { readJson, sendErr, sendJson } from "../util.js";
import { attachMentions } from "./shared.js";
import { canHumanReadChannel } from "../channelAccess.js";
import { getTaskDetails, reportTask, submitTaskDelivery } from "../tasks/taskService.js";
import { sendTaskOperationError } from "../tasks/taskHttp.js";
import { humanIdentityForId } from "../../human/humanIdentity.js";
import { activeChannels } from "../../channels/channelLifecycle.js";

export async function handleTasks(ctx: SpaceCtx): Promise<boolean> {
  const { req, res, method, p, humanId, spaceId } = ctx;
  const db = dbForSpace(spaceId);
  // ---- Tasks (messages as tasks) ----
  const tch = /^\/api\/tasks\/channel\/([^/]+)$/.exec(p);
  if (tch && method === "GET") {
    if (!(await canHumanReadChannel(spaceId, tch[1]!))) return (sendErr(res, 403, "forbidden"), true);
    const rows = await db.select().from(schema.messages)
      .where(and(eq(schema.messages.channelId, tch[1]!), isNotNull(schema.messages.taskStatus)))
      .orderBy(asc(schema.messages.taskNumber));
    return (sendJson(res, 200, { tasks: await attachMentions(spaceId, rows) }), true);
  }
  if (tch && method === "POST") { // New Task: bulk create tasks, body { tasks: [{ title }] }
    if (!(await canHumanReadChannel(spaceId, tch[1]!))) return (sendErr(res, 403, "forbidden"), true);
    const b = await readJson(req);
    const inputs = Array.isArray(b.tasks) ? b.tasks : [];
    const tasks = inputs.map((t: any) => ({
      title: String(t?.title ?? "").trim(),
      mode: normalizeTaskExecutionMode(t?.executionMode ?? b.executionMode),
    })).filter((task: { title: string }) => !!task.title);
    if (!tasks.length) return (sendErr(res, 400, "tasks[].title required"), true);
    if (tasks.some((task: { mode: unknown }) => !task.mode)) return (sendErr(res, 400, "executionMode must be autopilot or plan-first"), true);
    const human = humanIdentityForId(humanId);
    if (!human) return (sendErr(res, 403, "not the local Human"), true);
    const created: (typeof schema.messages.$inferSelect)[] = [];
    try {
      for (const task of tasks) created.push(await createMessage({ spaceId, channelId: tch[1]!, senderType: "human", senderId: humanId, senderName: human.displayName, content: task.title, asTask: true, taskExecutionMode: task.mode!, taskParentId: b.parentTaskId ?? null }));
    } catch (error) {
      if (sendTaskOperationError(res, error)) return true;
      throw error;
    }
    return (sendJson(res, 200, { tasks: await attachMentions(spaceId, created) }), true);
  }
  if (p === "/api/tasks/space" && method === "GET") {
    // The one local Human owns the Space and can see tasks from every live channel.
    const accessible = await activeChannels(spaceId, await db.select().from(schema.channels)
      .where(eq(schema.channels.spaceId, spaceId)));
    const accessibleIds = accessible.map((channel) => channel.id);
    if (!accessibleIds.length) return (sendJson(res, 200, { tasks: [] }), true);
    const rows = await db.select().from(schema.messages)
      .where(and(eq(schema.messages.spaceId, spaceId), isNotNull(schema.messages.taskStatus), inArray(schema.messages.channelId, accessibleIds)))
      .orderBy(asc(schema.messages.taskNumber));
    return (sendJson(res, 200, { tasks: await attachMentions(spaceId, rows) }), true);
  }
  if (p === "/api/tasks/convert-message" && method === "POST") {
    const b = await readJson(req);
    if (!b.messageId) return (sendErr(res, 400, "messageId required"), true);
    const m = (await db.select().from(schema.messages).where(and(eq(schema.messages.id, b.messageId), eq(schema.messages.spaceId, spaceId))))[0];
    if (!m) return (sendErr(res, 404, "message not found"), true);
    if (!(await canHumanReadChannel(spaceId, m.channelId))) return (sendErr(res, 404, "message not found"), true);
    const mode = normalizeTaskExecutionMode(b.executionMode);
    if (!mode) return (sendErr(res, 400, "executionMode must be autopilot or plan-first"), true);
    let t;
    try { t = await convertMessageToTask(spaceId, b.messageId, { type: "human", id: humanId }, mode); }
    catch (error) { if (sendTaskOperationError(res, error)) return true; throw error; }
    return (t ? sendJson(res, 200, { ok: true, id: t.id, taskNumber: t.taskNumber }) : sendErr(res, 404, "message not found"), true);
  }
  const tmode = /^\/api\/tasks\/([^/]+)\/mode$/.exec(p);
  if (tmode && method === "PATCH") {
    const task = (await db.select().from(schema.messages).where(and(eq(schema.messages.id, tmode[1]!), eq(schema.messages.spaceId, spaceId), isNotNull(schema.messages.taskStatus))))[0];
    if (!task || !(await canHumanReadChannel(spaceId, task.channelId))) return (sendErr(res, 404, "task not found"), true);
    const body = await readJson(req).catch(() => ({}));
    const mode = normalizeTaskExecutionMode(body.executionMode ?? body.mode);
    if (!mode) return (sendErr(res, 400, "executionMode must be autopilot or plan-first"), true);
    const updated = await setTaskExecutionMode(spaceId, task.id, mode);
    return (updated ? sendJson(res, 200, { ok: true, executionMode: updated.taskExecutionMode, revision: updated.taskRevision }) : sendErr(res, 404, "task not found"), true);
  }
  const tact = /^\/api\/tasks\/([^/]+)\/(claim|unclaim|status|assign)$/.exec(p);
  if (tact && method === "PATCH") { // claim/unclaim/status are all PATCH
    const [, taskId, action] = tact;
    const m = (await db.select().from(schema.messages).where(and(eq(schema.messages.id, taskId!), eq(schema.messages.spaceId, spaceId))))[0];
    if (!m) return (sendErr(res, 404, "task not found"), true);
    if (!(await canHumanReadChannel(spaceId, m.channelId))) return (sendErr(res, 404, "task not found"), true);
    const b = await readJson(req).catch(() => ({}));
    let r;
    try {
      if (action === "claim") r = await claimTask(spaceId, taskId!, "human", humanId, b.expectedRevision);
      else if (action === "unclaim") r = await unclaimTask(spaceId, taskId!, { type: "human", id: humanId }, b.expectedRevision);
      else if (action === "assign") {
        const assignee = b.assigneeId
          ? (await db.select().from(schema.agents).where(and(eq(schema.agents.id, String(b.assigneeId)), eq(schema.agents.spaceId, spaceId), isNull(schema.agents.deletedAt))))[0]
          : (await db.select().from(schema.agents).where(and(eq(schema.agents.name, String(b.to ?? "").replace(/^@/, "")), eq(schema.agents.spaceId, spaceId), isNull(schema.agents.deletedAt))))[0];
        if (!assignee) return (sendErr(res, 404, "target agent not found"), true);
        r = await assignTask(spaceId, taskId!, assignee.id, { type: "human", id: humanId }, b.expectedRevision);
      } else {
        const st = String(b?.status ?? "");
        if (!(TASK_STATUSES as readonly string[]).includes(st)) return (sendErr(res, 400, `valid status is required (${TASK_STATUSES.join(", ")})`), true);
        r = await setTaskStatus(spaceId, taskId!, st, { type: "human", id: humanId }, { from: b.from, expectedRevision: b.expectedRevision });
      }
    } catch (error) {
      if (sendTaskOperationError(res, error)) return true;
      throw error;
    }
    return (r ? sendJson(res, 200, { ok: true, taskStatus: r.taskStatus, assigneeId: r.taskAssigneeId, revision: r.taskRevision }) : sendErr(res, 404, "task not found"), true);
  }
  const treport = /^\/api\/tasks\/([^/]+)\/report$/.exec(p);
  if (treport && method === "POST") {
    const task = (await db.select().from(schema.messages).where(and(eq(schema.messages.id, treport[1]!), eq(schema.messages.spaceId, spaceId), isNotNull(schema.messages.taskStatus))))[0];
    if (!task || !(await canHumanReadChannel(spaceId, task.channelId))) return (sendErr(res, 404, "task not found"), true);
    const body = await readJson(req);
    const human = humanIdentityForId(humanId);
    if (!human) return (sendErr(res, 403, "not the local Human"), true);
    try {
      const result = await reportTask({ spaceId, taskId: task.id, actor: { type: "human", id: humanId, name: human.displayName }, kind: body.kind, content: String(body.content ?? ""), artifactRefs: body.artifactRefs });
      return (sendJson(res, 200, { ok: true, reportMessageId: result.report.id, threadId: result.report.channelId }), true);
    } catch (error) { if (sendTaskOperationError(res, error)) return true; throw error; }
  }
  const tdelivery = /^\/api\/tasks\/([^/]+)\/delivery$/.exec(p);
  if (tdelivery && method === "POST") {
    const task = (await db.select().from(schema.messages).where(and(eq(schema.messages.id, tdelivery[1]!), eq(schema.messages.spaceId, spaceId), isNotNull(schema.messages.taskStatus))))[0];
    if (!task || !(await canHumanReadChannel(spaceId, task.channelId))) return (sendErr(res, 404, "task not found"), true);
    const body = await readJson(req);
    const human = humanIdentityForId(humanId);
    if (!human) return (sendErr(res, 403, "not the local Human"), true);
    try {
      const result = await submitTaskDelivery({ spaceId, taskId: task.id, actor: { type: "human", id: humanId, name: human.displayName }, expectedRevision: Number(body.expectedRevision), summary: String(body.summary ?? ""), childTaskIds: body.childTaskIds, artifactRefs: body.artifactRefs });
      return (sendJson(res, 200, { ok: true, deliveryMessageId: result.delivery.id, taskStatus: result.task.taskStatus, revision: result.task.taskRevision, reportMessageIds: result.reportMessageIds }), true);
    } catch (error) { if (sendTaskOperationError(res, error)) return true; throw error; }
  }
  const tget = /^\/api\/tasks\/([^/]+)$/.exec(p);
  if (tget && method === "GET") {
    const details = await getTaskDetails(spaceId, tget[1]!);
    if (!details || !(await canHumanReadChannel(spaceId, details.task.channelId))) return (sendErr(res, 404, "task not found"), true);
    return (sendJson(res, 200, details), true);
  }
  const tdel = /^\/api\/tasks\/([^/]+)$/.exec(p);
  if (tdel && method === "DELETE") { // delete task = revert to plain message (clear task fields); source message is preserved
    const m = (await db.select().from(schema.messages).where(and(eq(schema.messages.id, tdel[1]!), eq(schema.messages.spaceId, spaceId))))[0];
    if (!m) return (sendErr(res, 404, "task not found"), true);
    if (!(await canHumanReadChannel(spaceId, m.channelId))) return (sendErr(res, 404, "task not found"), true);
    const r = await deleteTask(spaceId, tdel[1]!);
    return (r ? sendJson(res, 200, { ok: true }) : sendErr(res, 404, "task not found"), true);
  }
  return false;
}
