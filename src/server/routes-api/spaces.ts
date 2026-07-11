import { eq } from "drizzle-orm";
import { readJson, sendErr, sendJson } from "../util.js";
import { getHumanProfile } from "../../app-data/appDatabase.js";
import { dbForSpace, schema } from "../../db/index.js";
import {
  createLocalSpace,
  getLocalSpace,
  listLocalSpaces,
  localSpaceUnreadSummary,
  SpaceServiceError,
  updateLocalSpace,
} from "../../spaces/spaceService.js";
import type { UserCtx } from "./ctx.js";

async function serializeSpace(space: ReturnType<typeof getLocalSpace>) {
  const [legacyPresentation] = await dbForSpace(space.id)
    .select({ avatarUrl: schema.servers.avatarUrl })
    .from(schema.servers)
    .where(eq(schema.servers.id, space.id));
  return {
    id: space.id,
    name: space.name,
    slug: space.slug,
    rootPath: space.rootPath,
    lastOpenedAt: space.lastOpenedAt.toISOString(),
    avatarUrl: legacyPresentation?.avatarUrl ?? null,
  };
}

function sendSpaceError(res: UserCtx["res"], error: unknown): true {
  if (!(error instanceof SpaceServiceError)) throw error;
  const status = error.code === "SPACE_NOT_FOUND"
    ? 404
    : error.code === "SPACE_SLUG_CONFLICT"
      ? 409
      : 400;
  sendErr(res, status, error.message, { code: error.code });
  return true;
}

/** Canonical single-Human Space API. Legacy /api/servers stays isolated in servers.ts until A2.3/A2.4. */
export async function handleSpacesUserScope(ctx: UserCtx): Promise<boolean> {
  const { req, res, method, p, userId } = ctx;
  if (p !== "/api/spaces" && !p.startsWith("/api/spaces/")) return false;
  const human = getHumanProfile();
  if (!human || human.id !== userId) return (sendErr(res, 403, "not the local Human"), true);

  if (p === "/api/spaces" && method === "GET") {
    return (sendJson(res, 200, await Promise.all(listLocalSpaces().map(serializeSpace))), true);
  }

  if (p === "/api/spaces" && method === "POST") {
    const body = await readJson(req);
    try {
      const space = await createLocalSpace({
        name: body.name,
        slug: body.slug,
        rootPath: typeof body.rootPath === "string" && body.rootPath.trim() ? body.rootPath.trim() : undefined,
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

  const match = /^\/api\/spaces\/([^/]+)$/.exec(p);
  if (!match || (method !== "GET" && method !== "PATCH")) return false;
  try {
    const space = method === "PATCH"
      ? await updateLocalSpace(match[1]!, await readJson(req))
      : getLocalSpace(match[1]!);
    return (sendJson(res, 200, await serializeSpace(space)), true);
  } catch (error) {
    return sendSpaceError(res, error);
  }
}
