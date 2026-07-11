import type { BaseCtx, UserCtx } from "./ctx.js";
import { AppDataError, getHumanProfile, updateHumanProfile } from "../../app-data/appDatabase.js";
import { findUserById, updateUserCopies } from "../../db/lookup.js";
import { devLoginEnabled, signUser } from "../auth.js";
import { DESC_TOO_LONG, descTooLong } from "../core.js";
import { readJson, sendErr, sendJson } from "../util.js";

/** Temporary local-development JWT bootstrap. A3 replaces this transport. */
export async function handlePublicAuth(ctx: BaseCtx): Promise<boolean> {
  const { res, method, p } = ctx;
  if (p !== "/api/auth/dev-login" || method !== "POST") return false;
  if (!devLoginEnabled()) return (sendErr(res, 404, "not found"), true);
  const human = getHumanProfile();
  if (!human) return (sendErr(res, 409, "Human profile is not initialized"), true);
  return (sendJson(res, 200, {
    token: signUser(human.id),
    user: { id: human.id, name: human.name, displayName: human.name },
  }), true);
}

/** Canonical Human profile API. Legacy workspace copies remain only until A2.3b/A2.2b. */
export async function handleAuthedAuth(ctx: UserCtx): Promise<boolean> {
  const { req, res, method, p, userId } = ctx;
  if (p === "/api/auth/me" && method === "GET") {
    const human = getHumanProfile();
    if (!human || human.id !== userId) return (sendErr(res, 404, "not found"), true);
    const legacy = (await findUserById(userId))?.value;
    return (sendJson(res, 200, {
      id: human.id,
      name: human.name,
      displayName: human.name,
      email: human.email,
      description: human.description,
      avatarUrl: legacy?.avatarUrl ?? null,
    }), true);
  }
  if (p === "/api/auth/me" && method === "PATCH") {
    const current = getHumanProfile();
    if (!current || current.id !== userId) return (sendErr(res, 404, "not found"), true);
    const body = await readJson(req);
    if (descTooLong(body.description)) return (sendErr(res, 400, DESC_TOO_LONG), true);
    let human = current;
    try {
      human = updateHumanProfile({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
      });
    } catch (error) {
      if (error instanceof AppDataError) return (sendErr(res, 400, error.message, { code: error.code }), true);
      throw error;
    }
    const legacyPatch: Record<string, unknown> = {
      displayName: human.name,
      email: human.email ?? `${human.id}@human.kith-space.invalid`,
      description: human.description,
    };
    if (body.avatarUrl !== undefined) legacyPatch.avatarUrl = body.avatarUrl;
    await updateUserCopies(userId, legacyPatch);
    const legacy = (await findUserById(userId))?.value;
    return (sendJson(res, 200, {
      id: human.id,
      name: human.name,
      displayName: human.name,
      email: human.email,
      description: human.description,
      avatarUrl: legacy?.avatarUrl ?? null,
    }), true);
  }
  return false;
}
