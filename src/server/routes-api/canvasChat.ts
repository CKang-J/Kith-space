import { dbForSpace } from "../../db/index.js";
import { canHumanReadChannel } from "../channelAccess.js";
import { listEligibleCanvasExecutors } from "../../canvas/canvasChatExecutors.js";
import { sendErr, sendJson } from "../util.js";
import type { SpaceCtx } from "./ctx.js";

export async function handleCanvasChat(ctx: SpaceCtx): Promise<boolean> {
  const match = /^\/api\/channels\/([^/]+)\/canvas-executors$/.exec(ctx.p);
  if (!match || ctx.method !== "GET") return false;
  const channelId = decodeURIComponent(match[1]!);
  if (!(await canHumanReadChannel(ctx.spaceId, channelId))) {
    return (sendErr(ctx.res, 404, "channel not found"), true);
  }
  const executors = listEligibleCanvasExecutors(dbForSpace(ctx.spaceId), ctx.spaceId, channelId);
  return (sendJson(ctx.res, 200, { agents: executors }), true);
}
