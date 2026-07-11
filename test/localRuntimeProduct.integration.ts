import assert from "node:assert/strict";
import path from "node:path";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { closeAllDatabases, dbForSpace, schema } from "../src/db/index.ts";
import { ensurePersonalApp } from "../src/db/personalApp.ts";
import { signUser } from "../src/server/auth.ts";
import { handleApi } from "../src/server/routes-api/index.ts";

type ResponseCapture = { status: number; body: any };

async function api(spaceId: string, token: string, method: string, pathname: string, body?: unknown): Promise<ResponseCapture> {
  const capture: ResponseCapture = { status: 0, body: undefined };
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as any;
  req.headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-space-id": spaceId,
  };
  const res = {
    writeHead(status: number) { capture.status = status; },
    end(payload?: string) { capture.body = payload ? JSON.parse(payload) : undefined; },
  } as any;
  await handleApi(req, res, new URL(`http://localhost${pathname}`), method);
  return capture;
}

const root = process.env.KITH_SPACE_HOME;
assert.ok(root, "KITH_SPACE_HOME is required");

try {
  const { human, home } = await ensurePersonalApp({ name: "Ada", homeRootPath: path.join(root, "home") });
  const token = signUser(human.id);
  const db = dbForSpace(home.id);

  const created = await api(home.id, token, "POST", "/api/agents", {
    name: "local-helper",
    displayName: "Local Helper",
    runtime: "codex",
    model: "gpt-5.4",
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.name, "local-helper");
  assert.equal(created.body.started, false);

  const row = (await db.select().from(schema.agents).where(eq(schema.agents.id, created.body.id)))[0];
  assert.ok(row);

  const staleClient = await api(home.id, token, "POST", "/api/agents", {
    name: "legacy-machine-client",
    machineId: null,
  });
  assert.equal(staleClient.status, 400);
  assert.match(staleClient.body.error, /machineId is no longer supported/);

  const listed = await api(home.id, token, "GET", "/api/agents");
  assert.equal(listed.status, 200);
  const listedAgent = listed.body.find((agent: any) => agent.id === created.body.id);
  assert.ok(listedAgent);
  assert.equal(Object.prototype.hasOwnProperty.call(listedAgent, "machineId"), false);

  const detail = await api(home.id, token, "GET", `/api/agents/${created.body.id}`);
  assert.equal(detail.status, 200);
  assert.equal(Object.prototype.hasOwnProperty.call(detail.body, "machineId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(detail.body, "agentTokenHash"), false);

  const stalePatch = await api(home.id, token, "PATCH", `/api/agents/${created.body.id}`, { machineId: "legacy" });
  assert.equal(stalePatch.status, 400);

  const models = await api(home.id, token, "GET", "/api/local-runtime/models/codex");
  assert.equal(models.status, 200);
  assert.ok(models.body.models.some((model: any) => model.id === "gpt-5.4"));

  const retiredMachines = await api(home.id, token, "GET", `/api/spaces/${home.id}/machines`);
  assert.equal(retiredMachines.status, 404);
} finally {
  closeAllDatabases();
}
