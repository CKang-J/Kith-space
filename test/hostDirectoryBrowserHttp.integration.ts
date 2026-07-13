import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

const root = process.env.KITH_SPACE_HOME;
assert.ok(root, "KITH_SPACE_HOME is required");

const { closeAppDatabase } = await import("../src/app-data/appDatabase.ts");
const { AccessTokenService, BrowserAccessPolicy, BrowserSessionService } = await import("../src/browser-access/index.ts");
const { closeAllDatabases } = await import("../src/db/index.ts");
const { ensurePersonalApp } = await import("../src/db/personalApp.ts");
const { handleApi } = await import("../src/server/routes-api/index.ts");

async function api(pathname: string, headers: Record<string, string> = {}) {
  const capture: { status: number; body: any } = { status: 0, body: undefined };
  const req = Readable.from([]) as any;
  req.method = "GET";
  req.headers = headers;
  req.socket = { remoteAddress: "127.0.0.1", encrypted: false };
  const res = {
    writeHead(status: number) { capture.status = status; },
    end(payload?: string) { capture.body = payload ? JSON.parse(payload) : undefined; },
  } as any;
  await handleApi(req, res, new URL(`http://localhost:7777${pathname}`), "GET");
  return capture;
}

try {
  await ensurePersonalApp({ name: "Ada", homeRootPath: path.join(root, "home") });
  mkdirSync(path.join(root, "visible-folder"), { recursive: true });
  writeFileSync(path.join(root, "hidden-file.txt"), "file");

  const token = await new AccessTokenService().rotate("host-directory-browser-token");
  new BrowserAccessPolicy().updateSettings({ mode: "local" });
  const session = await new BrowserSessionService().create(token.token);
  assert.ok(session);
  const headers = { cookie: `kith_session=${session.token}`, host: "localhost:7777" };

  const unauthorized = await api(`/api/host-directories?path=${encodeURIComponent(root)}`);
  assert.equal(unauthorized.status, 401);

  const listed = await api(`/api/host-directories?path=${encodeURIComponent(root)}`, headers);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.path, path.resolve(root));
  assert.ok(listed.body.entries.some((entry: any) => entry.name === "visible-folder"));
  assert.ok(!listed.body.entries.some((entry: any) => entry.name === "hidden-file.txt"));

  const invalid = await api("/api/host-directories?path=relative", headers);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, "HOST_PATH_INVALID");
} finally {
  closeAllDatabases();
  closeAppDatabase();
}
