import type { BaseCtx } from "./ctx.js";
import { getHumanProfile } from "../../app-data/appDatabase.js";
import { AccessTokenService, BrowserAccessPolicy, BrowserSessionService, type BrowserAccessMode } from "../../browser-access/index.js";
import { isDesktopTrustedRequest } from "../../local-runtime/internalCredentials.js";
import { readJson, sendErr, sendJson } from "../util.js";
import {
  BrowserTokenAttemptLimiter,
  browserCsrfToken,
  browserOriginAllowed,
  clearBrowserSessionCookies,
  newBrowserCsrfToken,
  readBrowserAuthBody,
  setBrowserSessionCookies,
} from "../browserSessionHttp.js";
import { authenticateHumanRequest, type HumanRequestAuth } from "../humanRequestAuth.js";

const accessTokens = new AccessTokenService();
const sessions = new BrowserSessionService(accessTokens);
const policy = new BrowserAccessPolicy();
const attempts = new BrowserTokenAttemptLimiter();

export const LAN_HTTP_WARNING = "HTTP only. Use Kith-space only on a trusted private LAN. Do not port-forward or expose it to the internet.";

function humanJson() {
  const human = getHumanProfile();
  return human ? {
    id: human.id,
    name: human.name,
    displayName: human.name,
    email: human.email,
    description: human.description,
    avatarUrl: null,
  } : null;
}

function isSecure(req: BaseCtx["req"]): boolean {
  return !!(req.socket as typeof req.socket & { encrypted?: boolean }).encrypted;
}

function attemptKey(req: BaseCtx["req"]): string {
  return req.socket.remoteAddress || "unknown";
}

function validSettingsInput(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "request body must be an object";
  const input = body as Record<string, unknown>;
  if (input.mode !== undefined && (typeof input.mode !== "string" || !["off", "local", "lan"].includes(input.mode))) return "mode must be off, local, or lan";
  if (input.port !== undefined && (!Number.isInteger(input.port) || (input.port as number) < 1 || (input.port as number) > 65535)) return "port must be an integer from 1 to 65535";
  if (Object.prototype.hasOwnProperty.call(input, "accessToken") && typeof input.accessToken !== "string" && input.accessToken !== null) return "accessToken must be a string or null";
  const custom = typeof input.accessToken === "string" ? input.accessToken.trim() : "";
  if (custom && (custom.length < 16 || custom.length > 256)) return "custom accessToken must be 16 to 256 characters";
  return null;
}

/** Self-authenticating browser endpoints. They never return the submitted Access Token. */
export async function handlePublicBrowserAuth(ctx: BaseCtx): Promise<boolean> {
  const { req, res, method, p } = ctx;
  if (p === "/api/browser-auth/session" && method === "GET") {
    const auth = authenticateHumanRequest(req);
    const human = auth ? humanJson() : null;
    if (!auth || !human) {
      clearBrowserSessionCookies(res, isSecure(req));
      return (sendErr(res, 401, "browser authorization required"), true);
    }
    // The shared frontend requires a non-empty mutation nonce. Desktop requests are trusted by
    // their private header (and do not need browser CSRF validation), so this value is deliberately
    // ephemeral and carries no authority of its own.
    if (auth.kind === "desktop") {
      return (sendJson(res, 200, { authenticated: true, user: human, csrfToken: newBrowserCsrfToken() }), true);
    }
    let csrf = browserCsrfToken(req);
    if (!csrf) {
      csrf = newBrowserCsrfToken();
      setBrowserSessionCookies(res, auth.sessionToken!, csrf, isSecure(req));
    }
    return (sendJson(res, 200, { authenticated: true, user: human, csrfToken: csrf }), true);
  }

  if (p === "/api/browser-auth/verify" && method === "POST") {
    const settings = policy.getSettings();
    if (settings.mode === "off") return (sendErr(res, 403, "browser access is disabled"), true);
    if (!browserOriginAllowed(req, settings.mode, true)) return (sendErr(res, 403, "origin not allowed"), true);
    if (!settings.hasAccessToken) return (sendErr(res, 409, "browser access token is not configured"), true);
    const key = attemptKey(req);
    const limit = attempts.inspect(key);
    if (!limit.allowed) {
      res.setHeader("retry-after", String(limit.retryAfterSeconds));
      return (sendErr(res, 429, "too many access token attempts"), true);
    }
    const parsed = await readBrowserAuthBody(req);
    if (parsed.tooLarge) return (sendErr(res, 413, "request body too large"), true);
    const submitted = parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
      && typeof (parsed.value as Record<string, unknown>).token === "string"
      ? (parsed.value as Record<string, string>).token
      : "";
    const session = submitted ? await sessions.create(submitted) : undefined;
    if (!session) {
      attempts.fail(key);
      return (sendErr(res, 401, "invalid access token"), true);
    }
    attempts.clear(key);
    const csrf = newBrowserCsrfToken();
    setBrowserSessionCookies(res, session.token, csrf, isSecure(req));
    return (sendJson(res, 200, { ok: true, user: humanJson(), csrfToken: csrf }), true);
  }
  return false;
}

export async function handleAuthenticatedBrowserAuth(ctx: BaseCtx, auth: HumanRequestAuth): Promise<boolean> {
  const { req, res, method, p } = ctx;
  if (p !== "/api/browser-auth/session" || method !== "DELETE") return false;
  if (auth.kind === "browser" && auth.sessionToken) sessions.revoke(auth.sessionToken);
  clearBrowserSessionCookies(res, isSecure(req));
  return (sendJson(res, 200, { ok: true }), true);
}

function settingsJson() {
  const settings = policy.getSettings();
  return {
    ...settings,
    activeSessions: sessions.count(),
    lanWarning: settings.mode === "lan" ? LAN_HTTP_WARNING : null,
  };
}

/** Desktop-only settings interface. A browser session receives 404, never a partial settings view. */
export async function handleDesktopBrowserAccess(ctx: BaseCtx): Promise<boolean> {
  const { req, res, method, p } = ctx;
  if (!p.startsWith("/api/desktop/browser-access")) return false;
  if (!isDesktopTrustedRequest(req)) return (sendErr(res, 404, "not found"), true);

  if (p === "/api/desktop/browser-access" && method === "GET") {
    return (sendJson(res, 200, settingsJson()), true);
  }
  if (p === "/api/desktop/browser-access" && method === "PUT") {
    const body = await readJson(req) as unknown;
    const invalid = validSettingsInput(body);
    if (invalid) return (sendErr(res, 400, invalid), true);
    const input = body as Record<string, any>;
    const before = policy.getSettings();
    const requestedMode = (input.mode ?? before.mode) as BrowserAccessMode;
    const tokenRequested = Object.prototype.hasOwnProperty.call(input, "accessToken");
    const needsInitialToken = !before.hasAccessToken && requestedMode !== "off";
    let rotated: { token: string; revision: number } | undefined;
    if (tokenRequested || needsInitialToken) rotated = await accessTokens.rotate(input.accessToken);
    const next = policy.updateSettings({
      ...(input.mode !== undefined ? { mode: input.mode } : {}),
      ...(input.port !== undefined ? { port: input.port } : {}),
    });
    return (sendJson(res, 200, {
      ...settingsJson(),
      ...(rotated ? { accessToken: rotated.token } : {}),
      restartRequired: next.mode !== before.mode || next.port !== before.port,
    }), true);
  }
  if (p === "/api/desktop/browser-access/revoke-sessions" && method === "POST") {
    const revoked = sessions.revokeAll();
    return (sendJson(res, 200, { ok: true, revoked }), true);
  }
  return (sendErr(res, 404, "not found"), true);
}
