// User-facing REST: /api/*  (Bearer JWT + x-space-id)
//
// Thin dispatcher. It owns ONLY the three auth gates and the dispatch order; the actual route
// logic lives in the per-domain handlers in this directory. Each gate widens the context
// (public → +humanId → +spaceId, see ./ctx.ts) and then delegates to the handlers registered
// behind that gate. A handler returns `true` once it has matched a route and written the
// response, `false` to let the next handler try.
//
// Two things here are security-load-bearing and must not be reordered casually:
//   1. Gate order — which gate a handler sits behind IS its auth level (see docs/authorization.md).
//   2. Gate-2 dispatch order — preserves the former monolith's EFFECTIVE first-match resolution
//      (not its physical line order: e.g. the `/api/channels/saved` routes now live in messages.ts
//      and are reached only after handleChannels declines them — safe because no channels.ts guard
//      matches those paths/methods). When adding a route, check it can't be shadowed by an
//      earlier-dispatched module's guard for the same path+method.
import type { IncomingMessage, ServerResponse } from "node:http";
import { spaceRecord, touchSpace } from "../../db/index.js";
import { localHumanForSubject } from "../../human/humanAuthority.js";
import { sendErr, bearer, spaceIdHeader } from "../util.js";
import { verifyUser } from "../auth.js";
import type { BaseCtx, HumanCtx, SpaceCtx } from "./ctx.js";
import { handlePublicAuth, handleAuthedAuth } from "./auth.js";
import { handlePublicAttachmentGet, handleAttachments } from "./attachments.js";
import { handleSpacesHumanScope } from "./spaces.js";
import { handleLocalRuntimeHumanScope } from "./localRuntime.js";
import { handleSpacePreferences } from "./spacePreferences.js";
import { handleAgents } from "./agents.js";
import { handleReminders } from "./reminders.js";
import { handleChannels } from "./channels.js";
import { handleMessages } from "./messages.js";
import { handleTasks } from "./tasks.js";
import { handleDispatch } from "./dispatch.js";

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL, method: string): Promise<boolean> {
  const p = url.pathname;
  if (!p.startsWith("/api/")) return false;
  const base: BaseCtx = { req, res, url, method, p };

  // ---- gate 0: public / self-authenticating ----
  if (await handlePublicAuth(base)) return true;
  if (await handlePublicAttachmentGet(base)) return true;

  // ---- gate 1: require a logged-in user ----
  const subjectId = verifyUser(bearer(req));
  if (!subjectId) return (sendErr(res, 401, "unauthorized"), true);
  const human = localHumanForSubject(subjectId);
  if (!human) return (sendErr(res, 403, "not the local Human"), true);
  const humanId = human.id;
  const humanCtx: HumanCtx = { ...base, humanId };
  if (await handleAuthedAuth(humanCtx)) return true;
  if (await handleLocalRuntimeHumanScope(humanCtx)) return true;
  if (await handleSpacesHumanScope(humanCtx)) return true;

  // ---- gate 2: require a registered local Space context ----
  const spaceId = spaceIdHeader(req);
  if (!spaceId) return (sendErr(res, 400, "x-space-id header required"), true);
  const pathSpaceId = /^\/api\/spaces\/([^/]+)(?:\/|$)/.exec(p)?.[1];
  if (pathSpaceId && pathSpaceId !== spaceId) return (sendErr(res, 400, "path Space and x-space-id disagree"), true);
  if (!spaceRecord(spaceId)) return (sendErr(res, 404, "Space not found"), true);
  touchSpace(spaceId);
  const spaceCtx: SpaceCtx = { ...humanCtx, spaceId };

  if (await handleAgents(spaceCtx)) return true;
  if (await handleReminders(spaceCtx)) return true;
  if (await handleChannels(spaceCtx)) return true;
  if (await handleMessages(spaceCtx)) return true;
  if (await handleAttachments(spaceCtx)) return true;
  if (await handleSpacePreferences(spaceCtx)) return true;
  if (await handleDispatch(spaceCtx)) return true;
  if (await handleTasks(spaceCtx)) return true;

  return (sendErr(res, 404, "not found"), true);
}
