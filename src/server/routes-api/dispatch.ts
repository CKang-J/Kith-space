import { and, eq, isNotNull } from "drizzle-orm";
import { dbForSpace, schema } from "../../db/index.js";
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
import type { SpaceCtx } from "./ctx.js";

async function readableTask(spaceId: string, taskId: string) {
  const db = dbForSpace(spaceId);
  const task = db.select({ id: schema.messages.id, channelId: schema.messages.channelId }).from(schema.messages).where(and(
    eq(schema.messages.id, taskId),
    eq(schema.messages.spaceId, spaceId),
    isNotNull(schema.messages.taskStatus),
  )).get();
  if (!task || !(await canHumanReadChannel(spaceId, task.channelId))) return null;
  return task;
}

export async function handleDispatch(ctx: SpaceCtx): Promise<boolean> {
  const { req, res, method, p, spaceId } = ctx;
  const taskRoute = /^\/api\/tasks\/([^/]+)\/dispatch\/(status|stop|resume)$/.exec(p);
  if (taskRoute) {
    const [, taskId, action] = taskRoute;
    if (!await readableTask(spaceId, taskId!)) return (sendErr(res, 404, "task not found"), true);
    if (action === "status" && method === "GET") return (sendJson(res, 200, await taskDispatchStatus(spaceId, taskId!)), true);
    if ((action === "stop" || action === "resume") && method === "POST") {
      const body = action === "stop" ? await readJson(req).catch(() => ({})) : {};
      const status = action === "stop"
        ? await stopTaskDispatch(spaceId, taskId!, String(body.reason ?? "stopped by user"))
        : await resumeTaskDispatch(spaceId, taskId!);
      return (sendJson(res, 200, status), true);
    }
    return (sendErr(res, 405, "method not allowed"), true);
  }

  const spaceRoute = /^\/api\/spaces\/([^/]+)\/dispatch\/(status|stop|resume)$/.exec(p);
  if (spaceRoute) {
    const [, pathSpaceId, action] = spaceRoute;
    if (pathSpaceId !== spaceId) return (sendErr(res, 404, "Space not found"), true);
    if (action === "status" && method === "GET") return (sendJson(res, 200, await spaceDispatchStatus(spaceId)), true);
    if ((action === "stop" || action === "resume") && method === "POST") {
      const body = action === "stop" ? await readJson(req).catch(() => ({})) : {};
      const status = action === "stop"
        ? await stopSpaceDispatch(spaceId, String(body.reason ?? "stopped by user"))
        : await resumeSpaceDispatch(spaceId);
      return (sendJson(res, 200, status), true);
    }
    return (sendErr(res, 405, "method not allowed"), true);
  }

  return false;
}
