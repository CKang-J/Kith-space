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

async function api(input: {
  method: string;
  pathname: string;
  body?: unknown;
  headers?: Record<string, string>;
}): Promise<{ status: number; body: any }> {
  const capture = { status: 0, body: undefined as any };
  const req = Readable.from(input.body === undefined ? [] : [JSON.stringify(input.body)]) as any;
  req.method = input.method;
  req.headers = { ...(input.body === undefined ? {} : { "content-type": "application/json" }), ...(input.headers ?? {}) };
  req.socket = { remoteAddress: "127.0.0.1", encrypted: false };
  const res = {
    writeHead(status: number) { capture.status = status; },
    end(payload?: string) { capture.body = payload ? JSON.parse(payload) : undefined; },
  } as any;
  await handleApi(req, res, new URL(`http://localhost:7777${input.pathname}`), input.method);
  return capture;
}

const desktopHeaders = {
  "x-kith-desktop-token": process.env.KITH_SPACE_DESKTOP_TOKEN,
};

try {
  await ensurePersonalApp({ name: "Ada", homeRootPath: path.join(root, "home") });
  const accessToken = await new AccessTokenService().rotate("appearance-settings-browser-token");
  new BrowserAccessPolicy().updateSettings({ mode: "local" });
  const browserSession = await new BrowserSessionService().create(accessToken.token);
  assert.ok(browserSession);

  const anonymous = await api({
    method: "GET",
    pathname: "/api/settings/appearance",
  });
  assert.equal(anonymous.status, 401);

  const defaults = await api({
    method: "GET",
    pathname: "/api/settings/appearance",
    headers: desktopHeaders,
  });
  assert.equal(defaults.status, 200);
  assert.deepEqual(defaults.body, {
    interfaceFont: "sora",
    contentFont: "follow_interface",
    codeFont: "system_monospace",
    uiFontSize: 14,
    colorMode: "system",
  });

  const csrf = "appearance-settings-csrf";
  const browserUpdated = await api({
    method: "PATCH",
    pathname: "/api/settings/appearance",
    headers: {
      cookie: `kith_session=${browserSession.token}; kith_csrf=${csrf}`,
      host: "localhost:5273",
      origin: "http://localhost:5273",
      "x-kith-csrf": csrf,
    },
    body: { interfaceFont: "jetbrains_mono" },
  });
  assert.equal(browserUpdated.status, 200);
  assert.equal(browserUpdated.body.interfaceFont, "jetbrains_mono");

  const invalid = await api({
    method: "PATCH",
    pathname: "/api/settings/appearance",
    headers: desktopHeaders,
    body: { codeFont: "sora" },
  });
  assert.equal(invalid.status, 400);

  const updated = await api({
    method: "PATCH",
    pathname: "/api/settings/appearance",
    headers: desktopHeaders,
    body: { interfaceFont: "geist", codeFont: "jetbrains_mono" },
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body, {
    interfaceFont: "geist",
    contentFont: "follow_interface",
    codeFont: "jetbrains_mono",
    uiFontSize: 14,
    colorMode: "system",
  });

  const persisted = await api({
    method: "GET",
    pathname: "/api/settings/appearance",
    headers: desktopHeaders,
  });
  assert.equal(persisted.status, 200);
  assert.deepEqual(persisted.body, updated.body);
} finally {
  closeAllDatabases();
  closeAppDatabase();
}
