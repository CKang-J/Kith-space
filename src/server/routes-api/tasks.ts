// Auto-extracted from the former routes-api.ts monolith — bodies are verbatim.
import type { ServerCtx } from "./ctx.js";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { dbFor, schema } from "../../db/index.js";
import { TASK_STATUSES, claimTask, convertMessageToTask, createMessage, deleteTask, setTaskExecutionMode, setTaskStatus, unclaimTask } from "../core.js";
import { normalizeTaskExecutionMode } from "../dispatchGuard.js";
import { readJson, sendErr, sendJson } from "../util.js";
import { attachMentions } from "./shared.js";
import { canUserReadChannel } from "../channelAccess.js";

export async function handleTasks(ctx: ServerCtx): Promise<boolean> {
  const { req, res, method, p, userId, serverId } = ctx;
  const db = dbFor(serverId);
  // ---- Tasks (messages as tasks) ----
  const tch = /^\/api\/tasks\/channel\/([^/]+)$/.exec(p);
  if (tch && method === "GET") {
    if (!(await canUserReadChannel(serverId, tch[1]!, userId))) return (sendErr(res, 403, "forbidden"), true); // invariant 3: private/DM channel tasks not visible to non-members
    const rows = await db.select().from(schema.messages)
      .where(and(eq(schema.messages.channelId, tch[1]!), isNotNull(schema.messages.taskStatus)))
      .orderBy(asc(schema.messages.taskNumber));
    return (sendJson(res, 200, { tasks: await attachMentions(serverId, rows) }), true);
  }
  if (tch && method === "POST") { // New Task: bulk create tasks, body { tasks: [{ title }] }
    if (!(await canUserReadChannel(serverId, tch[1]!, userId))) return (sendErr(res, 403, "forbidden"), true); // invariant 3: non-members must not create tasks in private/DM channels
    const b = await readJson(req);
    const inputs = Array.isArray(b.tasks) ? b.tasks : [];
    const tasks = inputs.map((t: any) => ({
      title: String(t?.title ?? "").trim(),
      mode: normalizeTaskExecutionMode(t?.executionMode ?? b.executionMode),
    })).filter((task: { title: string }) => !!task.title);
    if (!tasks.length) return (sendErr(res, 400, "tasks[].title required"), true);
    if (tasks.some((task: { mode: unknown }) => !task.mode)) return (sendErr(res, 400, "executionMode must be autopilot or plan-first"), true);
    const u = (await db.select().from(schema.users).where(eq(schema.users.id, userId)))[0];
    const created: (typeof schema.messages.$inferSelect)[] = [];
    for (const task of tasks) created.push(await createMessage({ serverId, channelId: tch[1]!, senderType: "user", senderId: userId, senderName: u!.name, content: task.title, asTask: true, taskExecutionMode: task.mode! }));
    return (sendJson(res, 200, { tasks: await attachMentions(serverId, created) }), true);
  }
  if (p === "/api/tasks/server" && method === "GET") {
    // Invariant 3: only surface tasks from channels the user may read — their own memberships + all public channels.
    // Private/DM channel tasks must not leak to non-members (same guard as GET /tasks/channel/:id above).
    const memberOf = await db.select({ channelId: schema.channelMembers.channelId }).from(schema.channelMembers)
      .where(and(eq(schema.channelMembers.memberType, "user"), eq(schema.channelMembers.memberId, userId)));
    const publicChs = await db.select({ id: schema.channels.id }).from(schema.channels)
      .where(and(eq(schema.channels.serverId, serverId), eq(schema.channels.type, "channel"), isNull(schema.channels.deletedAt)));
    const accessibleIds = [...new Set([...memberOf.map((m) => m.channelId), ...publicChs.map((c) => c.id)])];
    if (!accessibleIds.length) return (sendJson(res, 200, { tasks: [] }), true);
    const rows = await db.select().from(schema.messages)
      .where(and(eq(schema.messages.serverId, serverId), isNotNull(schema.messages.taskStatus), inArray(schema.messages.channelId, accessibleIds)))
      .orderBy(asc(schema.messages.taskNumber));
    return (sendJson(res, 200, { tasks: await attachMentions(serverId, rows) }), true);
  }
  if (p === "/api/tasks/convert-message" && method === "POST") {
    const b = await readJson(req);
    if (!b.messageId) return (sendErr(res, 400, "messageId required"), true);
    const m = (await db.select().from(schema.messages).where(and(eq(schema.messages.id, b.messageId), eq(schema.messages.serverId, serverId))))[0];
    if (!m) return (sendErr(res, 404, "message not found"), true);
    if (!(await canUserReadChannel(serverId, m.channelId, userId))) return (sendErr(res, 404, "message not found"), true); // invariant 3 (IDOR-B4): non-members can't promote a private/DM channel's message
    const mode = normalizeTaskExecutionMode(b.executionMode);
    if (!mode) return (sendErr(res, 400, "executionMode must be autopilot or plan-first"), true);
    const t = await convertMessageToTask(serverId, b.messageId, { type: "user", id: userId }, mode);
    return (t ? sendJson(res, 200, { ok: true, id: t.id, taskNumber: t.taskNumber }) : sendErr(res, 404, "message not found"), true);
  }
  const tmode = /^\/api\/tasks\/([^/]+)\/mode$/.exec(p);
  if (tmode && method === "PATCH") {
    const task = (await db.select().from(schema.messages).where(and(eq(schema.messages.id, tmode[1]!), eq(schema.messages.serverId, serverId), isNotNull(schema.messages.taskStatus))))[0];
    if (!task || !(await canUserReadChannel(serverId, task.channelId, userId))) return (sendErr(res, 404, "task not found"), true);
    const body = await readJson(req).catch(() => ({}));
    const mode = normalizeTaskExecutionMode(body.executionMode ?? body.mode);
    if (!mode) return (sendErr(res, 400, "executionMode must be autopilot or plan-first"), true);
    const updated = await setTaskExecutionMode(serverId, task.id, mode);
    return (updated ? sendJson(res, 200, { ok: true, executionMode: updated.taskExecutionMode }) : sendErr(res, 404, "task not found"), true);
  }
  const tact = /^\/api\/tasks\/([^/]+)\/(claim|unclaim|status)$/.exec(p);
  if (tact && method === "PATCH") { // claim/unclaim/status are all PATCH
    const [, taskId, action] = tact;
    const m = (await db.select().from(schema.messages).where(and(eq(schema.messages.id, taskId!), eq(schema.messages.serverId, serverId))))[0];
    if (!m) return (sendErr(res, 404, "task not found"), true);
    if (!(await canUserReadChannel(serverId, m.channelId, userId))) return (sendErr(res, 404, "task not found"), true); // invariant 3 (IDOR-B4): non-members can't claim/unclaim/status a private/DM channel's task
    let r;
    if (action === "claim") {
      r = await claimTask(serverId, taskId!, "user", userId);
      if (!r) return (sendErr(res, 409, "already claimed", { code: "CLAIM_FAILED" }), true); // atomic claim failed: someone else got there first
    }
    else if (action === "unclaim") r = await unclaimTask(serverId, taskId!, { type: "user", id: userId });
    else { const b = await readJson(req).catch(() => ({})); const st = String(b?.status ?? ""); if (!(TASK_STATUSES as readonly string[]).includes(st)) return (sendErr(res, 400, `valid status is required (${TASK_STATUSES.join(", ")})`), true); r = await setTaskStatus(serverId, taskId!, st, { type: "user", id: userId }); }
    return (r ? sendJson(res, 200, { ok: true, taskStatus: r.taskStatus }) : sendErr(res, 404, "task not found"), true);
  }
  const tdel = /^\/api\/tasks\/([^/]+)$/.exec(p);
  if (tdel && method === "DELETE") { // delete task = revert to plain message (clear task fields); source message is preserved
    const m = (await db.select().from(schema.messages).where(and(eq(schema.messages.id, tdel[1]!), eq(schema.messages.serverId, serverId))))[0];
    if (!m) return (sendErr(res, 404, "task not found"), true);
    if (!(await canUserReadChannel(serverId, m.channelId, userId))) return (sendErr(res, 404, "task not found"), true); // invariant 3 (IDOR-B4): non-members can't delete a private/DM channel's task
    const r = await deleteTask(serverId, tdel[1]!);
    return (r ? sendJson(res, 200, { ok: true }) : sendErr(res, 404, "task not found"), true);
  }
  return false;
}
