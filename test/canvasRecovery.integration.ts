import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

const root = process.env.KITH_SPACE_HOME;
assert.ok(root, "KITH_SPACE_HOME is required");
assert.ok(process.env.KITH_SPACE_DESKTOP_TOKEN, "KITH_SPACE_DESKTOP_TOKEN is required");

const { closeAppDatabase } = await import("../src/app-data/appDatabase.ts");
const { closeAllDatabases, registerSpace, unregisterSpace } = await import("../src/db/index.ts");
const { ensurePersonalApp } = await import("../src/db/personalApp.ts");
const { handleApi } = await import("../src/server/routes-api/index.ts");

async function api(method: string, pathname: string, spaceId: string, body?: unknown) {
  const capture = { status: 0, body: undefined as any };
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as any;
  req.method = method;
  req.headers = {
    "x-kith-desktop-token": process.env.KITH_SPACE_DESKTOP_TOKEN,
    "x-space-id": spaceId,
    ...(body === undefined ? {} : { "content-type": "application/json" }),
  };
  req.socket = { remoteAddress: "127.0.0.1", encrypted: false };
  const res = {
    writeHead(status: number) { capture.status = status; },
    end(payload?: string) { capture.body = payload ? JSON.parse(payload) : undefined; },
  } as any;
  await handleApi(req, res, new URL(`http://localhost:7777${pathname}`), method);
  return capture;
}

const spaceA = randomUUID();
const spaceB = randomUUID();
try {
  await ensurePersonalApp({ name: "Ada", homeRootPath: path.join(root, "home") });
  registerSpace({ id: spaceA, name: "Canvas A", slug: `canvas-a-${spaceA}`, rootPath: path.join(root, "spaces", spaceA) });
  registerSpace({ id: spaceB, name: "Canvas B", slug: `canvas-b-${spaceB}`, rootPath: path.join(root, "spaces", spaceB) });
  const canvasId = randomUUID();
  const created = await api("POST", "/api/canvases", spaceA, {
    title: "Offline deletion", document: {}, canvasId, operationId: randomUUID(),
  });
  assert.equal(created.status, 201);
  const deleted = await api("DELETE", `/api/canvases/${canvasId}`, spaceA, {
    operationId: randomUUID(), expectedRevision: created.body.revisions.revision,
  });
  assert.equal(deleted.status, 200);

  const recovery = await api("GET", `/api/canvases/${canvasId}/changes?after=0`, spaceA);
  assert.equal(recovery.status, 200);
  assert.deepEqual(recovery.body, {
    deleted: true,
    canvasId,
    spaceId: spaceA,
    sequence: 1,
  });

  const crossSpace = await api("GET", `/api/canvases/${canvasId}/changes?after=0`, spaceB);
  assert.equal(crossSpace.status, 404);
} finally {
  closeAllDatabases();
  unregisterSpace(spaceA);
  unregisterSpace(spaceB);
  closeAppDatabase();
}
