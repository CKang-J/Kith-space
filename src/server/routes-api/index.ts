// User-facing REST: /api/*  (Bearer JWT + x-space-id)
//
// Thin dispatcher. It owns ONLY the three auth gates and the dispatch order; the actual route
// logic lives in the per-domain handlers in this directory. Each gate widens the context
// (public → +userId → +spaceId, see ./ctx.ts) and then delegates to the handlers registered
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
import type { BaseCtx, UserCtx, ServerCtx } from "./ctx.js";
import { handlePublicAuth, handleAuthedAuth } from "./auth.js";
import { handlePublicAttachmentGet, handleAttachments } from "./attachments.js";
import { handleSpacesUserScope } from "./spaces.js";
import { handleServersUserScope, handleServersServerScope } from "./servers.js";
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
  const userId = human.id;
  const user: UserCtx = { ...base, userId };
  if (await handleAuthedAuth(user)) return true;
  if (await handleSpacesUserScope(user)) return true;
  if (await handleServersUserScope(user)) return true;

  // ---- gate 2: require a registered local Space context ----
  const resolvedSpace = spaceIdHeader(req);
  if (resolvedSpace.conflict) return (sendErr(res, 400, "x-space-id and x-server-id headers disagree"), true);
  const spaceId = resolvedSpace.spaceId;
  if (!spaceId) return (sendErr(res, 400, "x-space-id header required"), true);
  const pathSpaceId = /^\/api\/spaces\/([^/]+)(?:\/|$)/.exec(p)?.[1];
  if (pathSpaceId && pathSpaceId !== spaceId) return (sendErr(res, 400, "path Space and x-space-id disagree"), true);
  if (!spaceRecord(spaceId)) return (sendErr(res, 404, "Space not found"), true);
  touchSpace(spaceId);
  // New clients use /api/spaces. Legacy handlers keep their old path matchers until A2.3/A2.4 removes them.
  const legacyPath = p.replace(/^\/api\/spaces(?=\/)/, "/api/servers");
  const sctx: ServerCtx = { ...user, p: legacyPath, spaceId, serverId: spaceId };

  if (await handleAgents(sctx)) return true;
  if (await handleReminders(sctx)) return true;
  if (await handleChannels(sctx)) return true;
  if (await handleMessages(sctx)) return true;
  if (await handleAttachments(sctx)) return true;
  if (await handleServersServerScope(sctx)) return true;
  if (await handleDispatch(sctx)) return true;
  if (await handleTasks(sctx)) return true;

  return (sendErr(res, 404, "not found"), true);
}
