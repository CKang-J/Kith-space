import { and, eq, isNotNull } from "drizzle-orm";
import { dbFor, schema } from "../../db/index.js";
import { canHumanReadChannel } from "../channelAccess.js";
import {
  resumeSpaceDispatch,
  resumeTaskDispatch,
  spaceDispatchStatus,
  stopSpaceDispatch,
  stopTaskDispatch,
  taskDispatchStatus,
} from "../dispatchControl.js";
import { readJson, sendErr, sendJson } from "../util.js";
import type { ServerCtx } from "./ctx.js";

async function readableTask(serverId: string, taskId: string) {
  const db = dbFor(serverId);
  const task = db.select({ id: schema.messages.id, channelId: schema.messages.channelId }).from(schema.messages).where(and(
    eq(schema.messages.id, taskId),
    eq(schema.messages.serverId, serverId),
    isNotNull(schema.messages.taskStatus),
  )).get();
  if (!task || !(await canHumanReadChannel(serverId, task.channelId))) return null;
  return task;
}

export async function handleDispatch(ctx: ServerCtx): Promise<boolean> {
  const { req, res, method, p, serverId } = ctx;
  const taskRoute = /^\/api\/tasks\/([^/]+)\/dispatch\/(status|stop|resume)$/.exec(p);
  if (taskRoute) {
    const [, taskId, action] = taskRoute;
    if (!await readableTask(serverId, taskId!)) return (sendErr(res, 404, "task not found"), true);
    if (action === "status" && method === "GET") return (sendJson(res, 200, await taskDispatchStatus(serverId, taskId!)), true);
    if ((action === "stop" || action === "resume") && method === "POST") {
      const body = action === "stop" ? await readJson(req).catch(() => ({})) : {};
      const status = action === "stop"
        ? await stopTaskDispatch(serverId, taskId!, String(body.reason ?? "stopped by user"))
        : await resumeTaskDispatch(serverId, taskId!);
      return (sendJson(res, 200, status), true);
    }
    return (sendErr(res, 405, "method not allowed"), true);
  }

  const spaceRoute = /^\/api\/servers\/([^/]+)\/dispatch\/(status|stop|resume)$/.exec(p);
  if (spaceRoute) {
    const [, pathServerId, action] = spaceRoute;
    if (pathServerId !== serverId) return (sendErr(res, 404, "workspace not found"), true);
    if (action === "status" && method === "GET") return (sendJson(res, 200, await spaceDispatchStatus(serverId)), true);
    if ((action === "stop" || action === "resume") && method === "POST") {
      const body = action === "stop" ? await readJson(req).catch(() => ({})) : {};
      const status = action === "stop"
        ? await stopSpaceDispatch(serverId, String(body.reason ?? "stopped by user"))
        : await resumeSpaceDispatch(serverId);
      return (sendJson(res, 200, status), true);
    }
    return (sendErr(res, 405, "method not allowed"), true);
  }

  return false;
}
