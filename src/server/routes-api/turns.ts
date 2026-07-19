import type { SpaceCtx } from "./ctx.js";
import { TurnInspector } from "../../turns/turnInspector.js";
import { canHumanReadChannel } from "../channelAccess.js";
import { sendErr, sendJson } from "../util.js";

export async function handleTurns(ctx: SpaceCtx): Promise<boolean> {
  const match = /^\/api\/turns\/([^/]+)$/.exec(ctx.p);
  if (!match || ctx.method !== "GET") return false;
  const inspected = new TurnInspector(ctx.spaceId).inspect(match[1]!);
  if (!inspected?.turn.session) return (sendErr(ctx.res, 404, "turn not found"), true);
  if (!(await canHumanReadChannel(ctx.spaceId, inspected.turn.session.surfaceId))) {
    return (sendErr(ctx.res, 404, "turn not found"), true);
  }
  return (sendJson(ctx.res, 200, inspected), true);
}
