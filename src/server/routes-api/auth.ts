// Auto-extracted from the former routes-api.ts monolith — bodies are verbatim.
import { randomUUID } from "node:crypto";
import type { BaseCtx, UserCtx } from "./ctx.js";
import { and, eq } from "drizzle-orm";
import { AppDataError, getHumanProfile, updateHumanProfile } from "../../app-data/appDatabase.js";
import { allWorkspaceDbs, schema } from "../../db/index.js";
import { findJoinLinkByToken, findServerBySlug, findUserByEmail, findUserById, findUserByName, updateUserCopies } from "../../db/lookup.js";
import { devLoginEnabled, hashPassword, isValidEmail, passwordError, safeEqual, setupToken, signUser, verifyPassword } from "../auth.js";
import { DESC_TOO_LONG, createServer, descTooLong } from "../core.js";
import { REGISTER_RATE_LIMIT, REGISTER_RATE_WINDOW_MS, clientIp, rateLimit } from "../ratelimit.js";
import { readJson, sendErr, sendJson } from "../util.js";

export async function handlePublicAuth(ctx: BaseCtx): Promise<boolean> {
  const { req, res, url, method, p } = ctx;

  // ---- auth ----
  // Dev-login: public username→JWT shortcut for local development ONLY. Gated behind ALLOW_DEV_LOGIN (default off),
  // so production never exposes it. When disabled it 404s — indistinguishable from a non-existent route (no endpoint leak).
  if (p === "/api/auth/dev-login" && method === "POST") {
    if (!devLoginEnabled()) return (sendErr(res, 404, "not found"), true);
    const b = await readJson(req);
    const name = String(b.name ?? "you").trim();
    if (!name || name.length > 64) return (sendErr(res, 400, "invalid name"), true);
    let u = (await findUserByName(name))?.value;
    if (!u) u = { id: randomUUID(), name, displayName: name, email: `${name}@dev.local`, passwordHash: null, gravatarHash: null, avatarUrl: null, description: null, createdAt: new Date() };
    // Multi-tenant: each user has isolated data — ensure the user has their own server (creates an empty one if absent, zero channels/agents; "you" owns the seeded default workspace)
    let mine = false;
    for (const { db } of allWorkspaceDbs()) if ((await db.select().from(schema.servers).where(eq(schema.servers.ownerId, u.id)))[0]) { mine = true; break; }
    if (!mine) await createServer(`${name}'s workspace`, `u-${u.id.slice(0, 8)}`, u.id, { owner: u });
    if (!u) return (sendErr(res, 500, "dev-login failed"), true);
    return (sendJson(res, 200, { token: signUser(u!.id), user: { id: u!.id, name: u!.name, displayName: u!.displayName } }), true);
  }
  // First-deploy admin setup: one-time, token-gated. Disabled (404) unless ADMIN_SETUP_TOKEN is configured.
  // First-run guard: only initializes the seeded default-workspace owner while it still has no password — so it
  // self-closes (410) once an admin password exists. This unblocks the seeded "you" admin after dev-login is turned off,
  // without ever hard-coding a default password. Placed BEFORE the auth gate (the operator has no JWT yet).
  if (p === "/api/auth/setup" && method === "POST") {
    const tok = setupToken();
    if (!tok) return (sendErr(res, 404, "not found"), true);
    const rl = rateLimit("auth:setup", clientIp(req), 5);
    if (!rl.ok) return (sendErr(res, 429, "too many requests", { retryAfter: rl.retryAfter }), true);
    const b = await readJson(req);
    if (!safeEqual(String(b.token ?? ""), tok)) return (sendErr(res, 403, "invalid setup token"), true);
    const located = await findServerBySlug("home");
    const ws = located?.value;
    if (!ws || !located) return (sendErr(res, 409, "no default workspace; run seed first"), true);
    const db = located.db;
    const admin = (await db.select().from(schema.users).where(eq(schema.users.id, ws.ownerId)))[0];
    if (!admin) return (sendErr(res, 409, "default workspace owner missing"), true);
    if (admin.passwordHash) return (sendErr(res, 410, "already initialized"), true);
    const pwErr = passwordError(b.password);
    if (pwErr) return (sendErr(res, 400, pwErr), true);
    const patch: Record<string, unknown> = { passwordHash: hashPassword(String(b.password)) };
    if (b.email !== undefined) {
      if (!isValidEmail(b.email)) return (sendErr(res, 400, "invalid email"), true);
      if (b.email !== admin.email) {
        const dup = (await findUserByEmail(b.email))?.value;
        if (dup) return (sendErr(res, 409, "email already in use"), true);
        patch.email = b.email;
      }
    }
    if (typeof b.displayName === "string" && b.displayName.trim()) patch.displayName = b.displayName.trim();
    const human = getHumanProfile();
    if (human?.id === admin.id && (patch.email !== undefined || patch.displayName !== undefined)) {
      try {
        updateHumanProfile({
          ...(patch.email !== undefined ? { email: patch.email as string } : {}),
          ...(patch.displayName !== undefined ? { name: patch.displayName as string } : {}),
        });
      } catch (error) {
        if (error instanceof AppDataError) return (sendErr(res, 400, error.message, { code: error.code }), true);
        throw error;
      }
    }
    await updateUserCopies(admin.id, patch);
    return (sendJson(res, 200, { token: signUser(admin.id), user: { id: admin.id, name: admin.name, email: (patch.email as string) ?? admin.email } }), true);
  }
  if (p === "/api/auth/register" && method === "POST") {
    const rl = rateLimit("auth:register", clientIp(req), REGISTER_RATE_LIMIT, REGISTER_RATE_WINDOW_MS);
    if (!rl.ok) return (sendErr(res, 429, "too many registrations from this IP — please try again later", { code: "auth_rate_limited", retryAfter: rl.retryAfter }), true);
    const b = await readJson(req);
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name || name.length > 64) return (sendErr(res, 400, "invalid name", { code: "auth_register_name_invalid" }), true);
    if (!isValidEmail(b.email)) return (sendErr(res, 400, "invalid email", { code: "auth_email_invalid" }), true);
    const pwErr = passwordError(b.password);
    if (pwErr) return (sendErr(res, 400, pwErr, { code: "auth_password_invalid" }), true);
    const dup = (await findUserByEmail(b.email))?.value ?? (await findUserByName(name))?.value;
    if (dup) return (sendErr(res, 409, dup.email === b.email ? "email already registered" : "username already taken", { code: dup.email === b.email ? "auth_register_email_taken" : "auth_register_username_taken" }), true);
    const u = { id: randomUUID(), name, displayName: typeof b.displayName === "string" && b.displayName.trim() ? b.displayName.trim() : name, email: b.email, passwordHash: hashPassword(String(b.password)) };
    await createServer(`${name}'s workspace`, `u-${u.id.slice(0, 8)}`, u.id, { owner: u }); // Create personal workspace on registration (aligned with dev-login; without it, entering the app with no server causes bootstrap to crash)
    return (sendJson(res, 200, { token: signUser(u.id), user: { id: u.id, name: u.name } }), true);
  }
  // Login: return stable, user-actionable error codes. This intentionally distinguishes an unknown email from a
  // wrong password for self-hosted workspace UX; the endpoint remains rate-limited to reduce enumeration/brute-force abuse.
  if (p === "/api/auth/login" && method === "POST") {
    const rl = rateLimit("auth:login", clientIp(req));
    if (!rl.ok) return (sendErr(res, 429, "too many requests", { code: "auth_rate_limited", retryAfter: rl.retryAfter }), true);
    const b = await readJson(req);
    if (typeof b.email !== "string" || typeof b.password !== "string" || !b.email.trim() || !b.password.trim()) return (sendErr(res, 400, "email and password required", { code: "auth_login_fields_required" }), true);
    if (!isValidEmail(b.email)) return (sendErr(res, 400, "invalid email", { code: "auth_email_invalid" }), true);
    const u = (await findUserByEmail(b.email))?.value;
    if (!u) return (sendErr(res, 404, "email not found", { code: "auth_login_email_not_found" }), true);
    if (!verifyPassword(b.password, u.passwordHash)) return (sendErr(res, 401, "password incorrect", { code: "auth_login_password_wrong" }), true);
    return (sendJson(res, 200, { token: signUser(u.id), user: { id: u.id, name: u.name } }), true);
  }
  // Invite info (public, no auth required): the /join/:token landing page uses this to display "X invited you to join workspace Y"
  if (p === "/api/auth/invite-info" && method === "GET") {
    const token = url.searchParams.get("token") ?? "";
    const found = token ? await findJoinLinkByToken(token) : undefined;
    const link = found?.value;
    if (!link || !found) return (sendJson(res, 200, { valid: false }), true);
    const db = found.db;
    const expired = !!link.expiresAt && new Date(link.expiresAt as any).getTime() < Date.now();
    const exhausted = link.maxUses != null && link.useCount >= link.maxUses;
    const srv = (await db.select().from(schema.servers).where(eq(schema.servers.id, link.serverId)))[0];
    const inviter = link.createdByUserId ? (await db.select().from(schema.users).where(eq(schema.users.id, link.createdByUserId)))[0] : null;
    return (sendJson(res, 200, {
      valid: !expired && !exhausted && !!srv,
      spaceName: srv?.name,
      spaceSlug: srv?.slug,
      inviterName: inviter?.displayName || inviter?.name || null,
      role: link.role,
      // A2.3 compatibility fields for old invite clients.
      serverName: srv?.name,
      serverSlug: srv?.slug,
    }), true);
  }
  return false;
}

export async function handleAuthedAuth(ctx: UserCtx): Promise<boolean> {
  const { req, res, method, p, userId } = ctx;
  // Accept invite (requires auth): join a workspace via a join-link token. Idempotent.
  if (p === "/api/auth/accept-invite" && method === "POST") {
    const b = await readJson(req);
    const found = b.token ? await findJoinLinkByToken(String(b.token)) : undefined;
    const link = found?.value;
    if (!link || !found) return (sendErr(res, 404, "invalid invite"), true);
    const db = found.db;
    if (link.expiresAt && new Date(link.expiresAt as any).getTime() < Date.now()) return (sendErr(res, 410, "invite expired"), true);
    if (link.maxUses != null && link.useCount >= link.maxUses) return (sendErr(res, 410, "invite exhausted"), true);
    const srv = (await db.select().from(schema.servers).where(eq(schema.servers.id, link.serverId)))[0];
    if (!srv) return (sendErr(res, 404, "server gone"), true);
    const existing = (await db.select().from(schema.serverMembers).where(and(eq(schema.serverMembers.serverId, link.serverId), eq(schema.serverMembers.userId, userId))))[0];
    if (!existing) {
      const user = (await findUserById(userId))?.value;
      if (!user) return (sendErr(res, 404, "user not found"), true);
      await db.insert(schema.users).values(user).onConflictDoNothing();
      await db.insert(schema.serverMembers).values({ serverId: link.serverId, userId, role: link.role });
      await db.update(schema.joinLinks).set({ useCount: link.useCount + 1 }).where(eq(schema.joinLinks.id, link.id));
      const all = (await db.select().from(schema.channels).where(and(eq(schema.channels.serverId, link.serverId), eq(schema.channels.name, "all"))))[0];
      if (all) await db.insert(schema.channelMembers).values({ channelId: all.id, memberType: "user", memberId: userId }).onConflictDoNothing();
    }
    return (sendJson(res, 200, {
      spaceSlug: srv.slug,
      spaceId: srv.id,
      already: !!existing,
      // A2.3 compatibility fields for old invite clients.
      serverSlug: srv.slug,
      serverId: srv.id,
    }), true);
  }

  if (p === "/api/auth/me" && method === "GET") {
    const human = getHumanProfile();
    if (!human || human.id !== userId) return (sendErr(res, 404, "not found"), true);
    const legacy = (await findUserById(userId))?.value;
    return (sendJson(res, 200, {
      id: human.id,
      name: legacy?.name ?? "you",
      displayName: human.name,
      email: human.email,
      description: human.description,
      avatarUrl: legacy?.avatarUrl ?? null,
    }), true);
  }
  if (p === "/api/auth/me" && method === "PATCH") {
    const current = getHumanProfile();
    if (!current || current.id !== userId) return (sendErr(res, 404, "not found"), true);
    const b = await readJson(req);
    if (descTooLong(b.description)) return (sendErr(res, 400, DESC_TOO_LONG), true);
    let human = current;
    try {
      human = updateHumanProfile({
        ...(b.displayName !== undefined ? { name: b.displayName } : {}),
        ...(b.email !== undefined ? { email: b.email } : {}),
        ...(b.description !== undefined ? { description: b.description } : {}),
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
    if (b.avatarUrl !== undefined) legacyPatch.avatarUrl = b.avatarUrl;
    await updateUserCopies(userId, legacyPatch);
    const legacy = (await findUserById(userId))?.value;
    return (sendJson(res, 200, {
      id: human.id,
      name: legacy?.name ?? "you",
      displayName: human.name,
      email: human.email,
      description: human.description,
      avatarUrl: legacy?.avatarUrl ?? null,
    }), true);
  }
  return false;
}
