import assert from "node:assert/strict";
import path from "node:path";
import { Readable } from "node:stream";

const root = process.env.KITH_SPACE_HOME;
assert.ok(root, "KITH_SPACE_HOME is required");
assert.ok(process.env.KITH_SPACE_DESKTOP_TOKEN, "KITH_SPACE_DESKTOP_TOKEN is required");

const { closeAppDatabase } = await import("../src/app-data/appDatabase.ts");
const { AccessTokenService, BrowserAccessPolicy, BrowserSessionService } = await import("../src/browser-access/index.ts");
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

try {
  await ensurePersonalApp({ name: "Ada", homeRootPath: path.join(root, "home") });

  const accessToken = await new AccessTokenService().rotate("desktop-settings-browser-token");
  new BrowserAccessPolicy().updateSettings({ mode: "local" });
  const browserSession = await new BrowserSessionService().create(accessToken.token);
  assert.ok(browserSession);
  const browserHeaders = {
    cookie: `kith_session=${browserSession.token}`,
    host: "localhost:7777",
  };
  const authenticatedBrowser = await api({
    method: "GET",
    pathname: "/api/browser-auth/session",
    headers: browserHeaders,
  });
  assert.equal(authenticatedBrowser.status, 200);

  const browserHidden = await api({
    method: "GET",
    pathname: "/api/desktop/settings",
    headers: browserHeaders,
  });
  assert.equal(browserHidden.status, 404);

  const wrongDesktopToken = await api({
    method: "GET",
    pathname: "/api/desktop/settings",
    headers: { "x-kith-desktop-token": "wrong-token" },
  });
  assert.equal(wrongDesktopToken.status, 404);

  const remoteDesktop = await api({
    method: "GET",
    pathname: "/api/desktop/settings",
    headers: desktopHeaders(),
    remoteAddress: "192.168.1.25",
  });
  assert.equal(remoteDesktop.status, 404);

  const defaults = await api({
    method: "GET",
    pathname: "/api/desktop/settings",
    headers: desktopHeaders(),
  });
  assert.equal(defaults.status, 200);
  assert.deepEqual(defaults.body, {
    closeBehavior: "tray",
    launchAtLogin: false,
  });

  for (const body of [
    null,
    {},
    { closeBehavior: "hide" },
    { launchAtLogin: "yes" },
    { closeBehavior: "tray", extra: true },
  ]) {
    const invalid = await api({
      method: "PUT",
      pathname: "/api/desktop/settings",
      headers: desktopHeaders(),
      body,
    });
    assert.equal(invalid.status, 400);
  }

  const updated = await api({
    method: "PUT",
    pathname: "/api/desktop/settings",
    headers: desktopHeaders(),
    body: { closeBehavior: "quit", launchAtLogin: true },
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body, {
    closeBehavior: "quit",
    launchAtLogin: true,
  });

  const persisted = await api({
    method: "GET",
    pathname: "/api/desktop/settings",
    headers: desktopHeaders(),
  });
  assert.equal(persisted.status, 200);
  assert.deepEqual(persisted.body, updated.body);
} finally {
  closeAllDatabases();
  closeAppDatabase();
}
