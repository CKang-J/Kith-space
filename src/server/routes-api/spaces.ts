import { readJson, sendErr, sendJson } from "../util.js";
import { getHomeSpaceId, getHumanProfile } from "../../app-data/appDatabase.js";
import {
  createLocalSpace,
  getLocalSpace,
  listLocalSpaces,
  localSpaceUnreadSummary,
  openLocalSpace,
  removeLocalSpace,
  relocateLocalSpace,
  SpaceServiceError,
  updateLocalSpace,
} from "../../spaces/spaceService.js";
import { inspectRegisteredSpaceRoot, SpaceRootError } from "../../spaces/spaceRootService.js";
import type { HumanCtx } from "./ctx.js";

async function serializeSpace(
  space: ReturnType<typeof getLocalSpace>,
  homeSpaceId = getHomeSpaceId(),
) {
  const root = inspectRegisteredSpaceRoot(space);
  return {
    id: space.id,
    isHome: space.id === homeSpaceId,
    name: space.name,
    slug: space.slug,
    rootPath: space.rootPath,
    lastOpenedAt: space.lastOpenedAt.toISOString(),
    avatarUrl: root.status === "ready" ? root.identity.avatarUrl : null,
    status: root.status,
    ...(root.status === "ready" ? {} : {
      rootError: root.rootError.message,
      code: root.rootError.code,
    }),
  };
}

function sendSpaceError(res: HumanCtx["res"], error: unknown): true {
  if (!(error instanceof SpaceServiceError) && !(error instanceof SpaceRootError)) throw error;
  const status = error.code === "SPACE_NOT_FOUND"
    ? 404
    : [
        "SPACE_SLUG_CONFLICT",
        "SPACE_ROOT_ATTACH_REQUIRED",
        "SPACE_ROOT_ALREADY_REGISTERED",
        "SPACE_ID_ALREADY_REGISTERED",
        "SPACE_ID_MISMATCH",
      ].includes(error.code)
      ? 409
      : 400;
  sendErr(res, status, error.message, { code: error.code });
  return true;
}

export async function handleSpacesHumanScope(ctx: HumanCtx): Promise<boolean> {
  const { req, res, method, p, humanId } = ctx;
  if (p !== "/api/spaces" && !p.startsWith("/api/spaces/")) return false;
  const human = getHumanProfile();
  if (!human || human.id !== humanId) return (sendErr(res, 403, "not the local Human"), true);

  if (p === "/api/spaces" && method === "GET") {
    const homeSpaceId = getHomeSpaceId();
    return (sendJson(
      res,
      200,
      await Promise.all(listLocalSpaces().map((space) => serializeSpace(space, homeSpaceId))),
    ), true);
  }

  if (p === "/api/spaces" && method === "POST") {
    const body = await readJson(req);
    try {
      const space = await createLocalSpace({
        name: body.name,
        slug: body.slug,
        rootPath: body.rootPath,
        mode: body.mode,
      });
      return (sendJson(res, 201, await serializeSpace(space)), true);
    } catch (error) {
      return sendSpaceError(res, error);
    }
  }

  if (p === "/api/spaces/unread-summary" && method === "GET") {
    try {
      return (sendJson(res, 200, await localSpaceUnreadSummary()), true);
    } catch (error) {
      return sendSpaceError(res, error);
    }
  }

  const relocateMatch = /^\/api\/spaces\/([^/]+)\/relocate$/.exec(p);
  if (relocateMatch && method === "POST") {
    try {
      const space = await relocateLocalSpace(relocateMatch[1]!, await readJson(req));
      return (sendJson(res, 200, await serializeSpace(space)), true);
    } catch (error) {
      return sendSpaceError(res, error);
    }
  }

  const openMatch = /^\/api\/spaces\/([^/]+)\/open$/.exec(p);
  if (openMatch && method === "POST") {
    try {
      return (sendJson(res, 200, await serializeSpace(openLocalSpace(openMatch[1]!))), true);
    } catch (error) {
      return sendSpaceError(res, error);
    }
  }

  const match = /^\/api\/spaces\/([^/]+)$/.exec(p);
  if (!match || (method !== "GET" && method !== "PATCH" && method !== "DELETE")) return false;
  try {
    if (method === "DELETE") {
      await removeLocalSpace(match[1]!);
      return (sendJson(res, 200, { ok: true }), true);
    }
    const space = method === "PATCH" ? await updateLocalSpace(match[1]!, await readJson(req)) : getLocalSpace(match[1]!);
    return (sendJson(res, 200, await serializeSpace(space)), true);
  } catch (error) {
    return sendSpaceError(res, error);
  }
}
