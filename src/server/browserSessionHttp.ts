import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { BrowserAccessMode } from "../browser-access/index.js";
import { isLoopbackAddress } from "../local-runtime/internalCredentials.js";
import { safeEqual } from "./auth.js";

export const BROWSER_SESSION_COOKIE = "kith_session";
export const BROWSER_CSRF_COOKIE = "kith_csrf";
export const BROWSER_AUTH_BODY_LIMIT = 4 * 1024;
const COOKIE_MAX_AGE_SECONDS = 10 * 365 * 24 * 60 * 60;

export async function readBrowserAuthBody(
  req: IncomingMessage,
): Promise<{ value: unknown; tooLarge: boolean }> {
  return new Promise((resolve) => {
    let body = "";
    let bytes = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > BROWSER_AUTH_BODY_LIMIT) {
        tooLarge = true;
        body = "";
        return;
      }
      if (!tooLarge) body += chunk;
    });
    req.on("end", () => {
      if (tooLarge) return resolve({ value: null, tooLarge: true });
      try { resolve({ value: body ? JSON.parse(body) : {}, tooLarge: false }); }
      catch { resolve({ value: null, tooLarge: false }); }
    });
  });
}

function cookies(req: IncomingMessage): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at < 1) continue;
    const name = part.slice(0, at).trim();
    const raw = part.slice(at + 1).trim();
    try { out.set(name, decodeURIComponent(raw)); } catch { /* ignore malformed cookie */ }
  }
  return out;
}

export function browserSessionToken(req: IncomingMessage): string | null {
  return cookies(req).get(BROWSER_SESSION_COOKIE) ?? null;
}

export function browserCsrfToken(req: IncomingMessage): string | null {
  return cookies(req).get(BROWSER_CSRF_COOKIE) ?? null;
}

export function newBrowserCsrfToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function cookie(name: string, value: string, options: { httpOnly?: boolean; secure?: boolean; maxAge: number }): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${options.maxAge}`,
    "SameSite=Strict",
    ...(options.httpOnly ? ["HttpOnly"] : []),
    ...(options.secure ? ["Secure"] : []),
  ].join("; ");
}

export function setBrowserSessionCookies(
  res: ServerResponse,
  sessionToken: string,
  csrfToken: string,
  secure = false,
): void {
  res.setHeader("set-cookie", [
    cookie(BROWSER_SESSION_COOKIE, sessionToken, { httpOnly: true, secure, maxAge: COOKIE_MAX_AGE_SECONDS }),
    cookie(BROWSER_CSRF_COOKIE, csrfToken, { secure, maxAge: COOKIE_MAX_AGE_SECONDS }),
  ]);
}

export function clearBrowserSessionCookies(res: ServerResponse, secure = false): void {
  res.setHeader("set-cookie", [
    cookie(BROWSER_SESSION_COOKIE, "", { httpOnly: true, secure, maxAge: 0 }),
    cookie(BROWSER_CSRF_COOKIE, "", { secure, maxAge: 0 }),
  ]);
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

export function requestPeerIsLoopback(req: IncomingMessage): boolean {
  return isLoopbackAddress(req.socket.remoteAddress);
}

/** Browser origins are mode-scoped. Missing Origin is accepted only for read requests. */
export function browserOriginAllowed(req: IncomingMessage, mode: BrowserAccessMode, requireOrigin = false): boolean {
  if (mode === "off") return false;
  if (mode === "local" && !requestPeerIsLoopback(req)) return false;
  const raw = req.headers.origin;
  if (!raw) return !requireOrigin;
  let origin: URL;
  try { origin = new URL(raw); } catch { return false; }
  if (origin.protocol !== "http:" && origin.protocol !== "https:") return false;
  if (mode === "local") return isLoopback(origin.hostname);
  const requestHost = (req.headers.host ?? "").trim().toLowerCase();
  return !!requestHost && origin.host.toLowerCase() === requestHost;
}

export function browserMutationAllowed(req: IncomingMessage, mode: BrowserAccessMode): boolean {
  const method = req.method ?? "GET";
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  if (!browserOriginAllowed(req, mode, true)) return false;
  const header = typeof req.headers["x-kith-csrf"] === "string" ? req.headers["x-kith-csrf"] : "";
  const csrf = browserCsrfToken(req) ?? "";
  return !!header && !!csrf && safeEqual(header, csrf);
}

type Attempt = { failures: number; resetAt: number };

/** Small in-memory limiter for the only public secret-verification endpoint. */
export class BrowserTokenAttemptLimiter {
  private attempts = new Map<string, Attempt>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 15 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  inspect(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const item = this.attempts.get(key);
    const now = this.now();
    if (!item || item.resetAt <= now) {
      if (item) this.attempts.delete(key);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return {
      allowed: item.failures < this.maxFailures,
      retryAfterSeconds: Math.max(1, Math.ceil((item.resetAt - now) / 1000)),
    };
  }

  fail(key: string): void {
    const now = this.now();
    const current = this.attempts.get(key);
    if (!current || current.resetAt <= now) {
      this.attempts.set(key, { failures: 1, resetAt: now + this.windowMs });
      return;
    }
    current.failures += 1;
  }

  clear(key: string): void {
    this.attempts.delete(key);
  }
}
