import assert from "node:assert/strict";
import path from "node:path";
import { Readable } from "node:stream";

const root = process.env.KITH_SPACE_HOME;
assert.ok(root, "KITH_SPACE_HOME is required");
assert.ok(process.env.KITH_SPACE_DESKTOP_TOKEN, "KITH_SPACE_DESKTOP_TOKEN is required");

const { closeAppDatabase } = await import("../src/app-data/appDatabase.ts");
const { closeAllDatabases } = await import("../src/db/index.ts");
const { ensurePersonalApp } = await import("../src/db/personalApp.ts");
const { handleApi } = await import("../src/server/routes-api/index.ts");

type Capture = {
  status: number;
  body: any;
  headers: Map<string, unknown>;
};

async function api(input: {
  method: string;
  pathname: string;
  body?: unknown;
  headers?: Record<string, string>;
  remoteAddress?: string;
}): Promise<Capture> {
  const capture: Capture = { status: 0, body: undefined, headers: new Map() };
  const req = Readable.from(input.body === undefined ? [] : [JSON.stringify(input.body)]) as any;
  req.method = input.method;
  req.headers = { ...(input.body === undefined ? {} : { "content-type": "application/json" }), ...(input.headers ?? {}) };
  req.socket = { remoteAddress: input.remoteAddress ?? "127.0.0.1", encrypted: false };
  const res = {
    setHeader(name: string, value: unknown) { capture.headers.set(name.toLowerCase(), value); },
    writeHead(status: number, headers?: Record<string, unknown>) {
      capture.status = status;
      for (const [name, value] of Object.entries(headers ?? {})) capture.headers.set(name.toLowerCase(), value);
    },
    end(payload?: string) { capture.body = payload ? JSON.parse(payload) : undefined; },
  } as any;
  await handleApi(req, res, new URL(`http://localhost:7777${input.pathname}`), input.method);
  return capture;
}

function desktopHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "x-kith-desktop-token": process.env.KITH_SPACE_DESKTOP_TOKEN!, ...extra };
}

function sessionCookies(response: Capture): { cookie: string; csrf: string } {
  const setCookie = response.headers.get("set-cookie") as string[];
  assert.equal(setCookie.length, 2);
  const values = setCookie.map((value) => value.split(";", 1)[0]!);
  const csrf = decodeURIComponent(values.find((value) => value.startsWith("kith_csrf="))!.slice("kith_csrf=".length));
  return { cookie: values.join("; "), csrf };
}

const origin = "http://localhost:7777";

try {
  const { human, home } = await ensurePersonalApp({ name: "Ada", homeRootPath: path.join(root, "home") });

  const anonymous = await api({ method: "GET", pathname: "/api/spaces" });
  assert.equal(anonymous.status, 401);

  const hiddenDesktopSettings = await api({ method: "GET", pathname: "/api/desktop/browser-access" });
  assert.equal(hiddenDesktopSettings.status, 404);

  const desktopSession = await api({
    method: "GET",
    pathname: "/api/browser-auth/session",
    headers: desktopHeaders(),
  });
  assert.equal(desktopSession.status, 200);
  assert.equal(desktopSession.body.user.id, human.id);
  assert.match(desktopSession.body.csrfToken, /^[A-Za-z0-9_-]+$/);

  const malformedSettings = await api({
    method: "PUT",
    pathname: "/api/desktop/browser-access",
    headers: desktopHeaders(),
    body: null,
  });
  assert.equal(malformedSettings.status, 400);

  const configured = await api({
    method: "PUT",
    pathname: "/api/desktop/browser-access",
    headers: desktopHeaders(),
    body: { mode: "local", port: 7777, accessToken: "correct-horse-browser-token" },
  });
  assert.equal(configured.status, 200);
  assert.equal(configured.body.mode, "local");
  assert.equal(configured.body.hasAccessToken, true);
  assert.equal(configured.body.accessToken, "correct-horse-browser-token");

  const remoteDesktopTrust = await api({
    method: "GET",
    pathname: "/api/desktop/browser-access",
    headers: desktopHeaders(),
    remoteAddress: "192.168.1.25",
  });
  assert.equal(remoteDesktopTrust.status, 404);

  const remoteLocalMode = await api({
    method: "POST",
    pathname: "/api/browser-auth/verify",
    headers: { origin, host: "localhost:7777" },
    body: { token: "correct-horse-browser-token" },
    remoteAddress: "192.168.1.25",
  });
  assert.equal(remoteLocalMode.status, 403);

  const oversizedVerification = await api({
    method: "POST",
    pathname: "/api/browser-auth/verify",
    headers: { origin, host: "localhost:7777" },
    body: { token: "x".repeat(5000) },
  });
  assert.equal(oversizedVerification.status, 413);

  const wrong = await api({
    method: "POST",
    pathname: "/api/browser-auth/verify",
    headers: { origin, host: "localhost:7777" },
    body: { token: "wrong-browser-token-value" },
  });
  assert.equal(wrong.status, 401);
  assert.equal(JSON.stringify(wrong.body).includes("wrong-browser-token-value"), false);

  const verified = await api({
    method: "POST",
    pathname: "/api/browser-auth/verify",
    headers: { origin, host: "localhost:7777" },
    body: { token: "correct-horse-browser-token" },
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.user.id, human.id);
  const session = sessionCookies(verified);

  const bootstrapped = await api({
    method: "GET",
    pathname: "/api/browser-auth/session",
    headers: { cookie: session.cookie, host: "localhost:7777" },
  });
  assert.equal(bootstrapped.status, 200);
  assert.equal(bootstrapped.body.csrfToken, session.csrf);

  const spaces = await api({
    method: "GET",
    pathname: "/api/spaces",
    headers: { cookie: session.cookie, host: "localhost:7777" },
  });
  assert.equal(spaces.status, 200);
  assert.ok(spaces.body.some((space: any) => space.id === home.id));

  const missingCsrf = await api({
    method: "PATCH",
    pathname: "/api/auth/me",
    headers: { cookie: session.cookie, origin, host: "localhost:7777" },
    body: { description: "blocked" },
  });
  assert.equal(missingCsrf.status, 403);

  const updated = await api({
    method: "PATCH",
    pathname: "/api/auth/me",
    headers: { cookie: session.cookie, origin, host: "localhost:7777", "x-kith-csrf": session.csrf },
    body: { description: "allowed" },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.description, "allowed");

  const browserCannotReadDesktopSettings = await api({
    method: "GET",
    pathname: "/api/desktop/browser-access",
    headers: { cookie: session.cookie, host: "localhost:7777" },
  });
  assert.equal(browserCannotReadDesktopSettings.status, 404);

  const desktopBypassesBrowserCsrf = await api({
    method: "PATCH",
    pathname: "/api/auth/me",
    headers: desktopHeaders(),
    body: { description: "desktop" },
  });
  assert.equal(desktopBypassesBrowserCsrf.status, 200);

  const logoutWithoutCsrf = await api({
    method: "POST",
    pathname: "/api/browser-auth/logout",
    headers: { cookie: session.cookie, origin, host: "localhost:7777" },
  });
  assert.equal(logoutWithoutCsrf.status, 403);

  const logout = await api({
    method: "POST",
    pathname: "/api/browser-auth/logout",
    headers: { cookie: session.cookie, origin, host: "localhost:7777", "x-kith-csrf": session.csrf },
  });
  assert.equal(logout.status, 200);
  const loggedOut = await api({ method: "GET", pathname: "/api/browser-auth/session", headers: { cookie: session.cookie, host: "localhost:7777" } });
  assert.equal(loggedOut.status, 401);

  const beforeRotation = await api({
    method: "POST", pathname: "/api/browser-auth/verify", headers: { origin, host: "localhost:7777" }, body: { token: "correct-horse-browser-token" },
  });
  const oldSession = sessionCookies(beforeRotation);
  const rotated = await api({
    method: "PUT",
    pathname: "/api/desktop/browser-access",
    headers: desktopHeaders(),
    body: { accessToken: "new-correct-horse-token" },
  });
  assert.equal(rotated.status, 200);
  assert.equal(rotated.body.activeSessions, 0);
  const invalidated = await api({ method: "GET", pathname: "/api/browser-auth/session", headers: { cookie: oldSession.cookie, host: "localhost:7777" } });
  assert.equal(invalidated.status, 401);

  for (let attempt = 0; attempt < 5; attempt++) {
    const failed = await api({
      method: "POST",
      pathname: "/api/browser-auth/verify",
      headers: { origin, host: "localhost:7777" },
      body: { token: "definitely-wrong-token" },
    });
    assert.equal(failed.status, 401);
  }
  const limited = await api({
    method: "POST",
    pathname: "/api/browser-auth/verify",
    headers: { origin, host: "localhost:7777" },
    body: { token: "new-correct-horse-token" },
  });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
} finally {
  closeAllDatabases();
  closeAppDatabase();
}
