import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { getHumanProfile } from "../src/app-data/appDatabase.ts";
import { closeAllDatabases } from "../src/db/index.ts";
import { ensurePersonalApp } from "../src/db/personalApp.ts";

type CapturedResponse = {
  status: number;
  body: any;
};

function responseCapture(): { response: CapturedResponse; res: any } {
  const response: CapturedResponse = { status: 0, body: undefined };
  return {
    response,
    res: {
      writeHead(status: number) { response.status = status; },
      end(body?: string) { response.body = body ? JSON.parse(body) : undefined; },
    },
  };
}

function jsonRequest(body?: unknown): any {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as any;
  req.headers = {};
  return req;
}

test("/api/auth/me reads and updates the canonical app.db Human profile", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-human-route-"));
  const previousHome = process.env.KITH_SPACE_HOME;
  const previousDesktopToken = process.env.KITH_SPACE_DESKTOP_TOKEN;
  const previousWorkerToken = process.env.KITH_SPACE_WORKER_TOKEN;
  process.env.KITH_SPACE_HOME = path.join(root, "app-home");
  process.env.KITH_SPACE_DESKTOP_TOKEN = "human-route-desktop-token-for-tests";
  process.env.KITH_SPACE_WORKER_TOKEN = "human-route-worker-token-for-tests";
  try {
    const { human } = await ensurePersonalApp({ name: "Ada", homeRootPath: path.join(root, "home-space") });
    const { handleAuthedAuth } = await import("../src/server/routes-api/auth.ts");

    const getCapture = responseCapture();
    await handleAuthedAuth({
      req: jsonRequest(),
      res: getCapture.res,
      url: new URL("http://localhost/api/auth/me"),
      method: "GET",
      p: "/api/auth/me",
      humanId: human.id,
    });
    assert.equal(getCapture.response.status, 200);
    assert.equal(getCapture.response.body.name, "Ada");
    assert.equal(getCapture.response.body.displayName, "Ada");

    const patchCapture = responseCapture();
    await handleAuthedAuth({
      req: jsonRequest({ name: "Grace", email: "grace@example.test", description: "Local Human" }),
      res: patchCapture.res,
      url: new URL("http://localhost/api/auth/me"),
      method: "PATCH",
      p: "/api/auth/me",
      humanId: human.id,
    });
    assert.equal(patchCapture.response.status, 200);
    assert.equal(patchCapture.response.body.name, "Grace");
    assert.equal(patchCapture.response.body.displayName, "Grace");
    assert.deepEqual(
      { name: getHumanProfile()?.name, email: getHumanProfile()?.email, description: getHumanProfile()?.description },
      { name: "Grace", email: "grace@example.test", description: "Local Human" },
    );
    const clearEmailCapture = responseCapture();
    await handleAuthedAuth({
      req: jsonRequest({ email: null }),
      res: clearEmailCapture.res,
      url: new URL("http://localhost/api/auth/me"),
      method: "PATCH",
      p: "/api/auth/me",
      humanId: human.id,
    });
    assert.equal(clearEmailCapture.response.status, 200);
    assert.equal(getHumanProfile()?.email, null);
  } finally {
    closeAllDatabases();
    if (previousHome === undefined) delete process.env.KITH_SPACE_HOME;
    else process.env.KITH_SPACE_HOME = previousHome;
    if (previousDesktopToken === undefined) delete process.env.KITH_SPACE_DESKTOP_TOKEN;
    else process.env.KITH_SPACE_DESKTOP_TOKEN = previousDesktopToken;
    if (previousWorkerToken === undefined) delete process.env.KITH_SPACE_WORKER_TOKEN;
    else process.env.KITH_SPACE_WORKER_TOKEN = previousWorkerToken;
    rmSync(root, { recursive: true, force: true });
  }
});
