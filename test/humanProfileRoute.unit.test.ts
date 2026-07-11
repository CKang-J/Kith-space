import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { getHumanProfile } from "../src/app-data/appDatabase.ts";
import { closeAllDatabases, dbFor, schema } from "../src/db/index.ts";
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

test("/api/auth/me reads app.db as canonical Human profile and writes legacy rows as projections", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-human-route-"));
  const previousHome = process.env.KITH_SPACE_HOME;
  const previousJwt = process.env.JWT_SECRET;
  const previousDaemonKey = process.env.DAEMON_BOOTSTRAP_KEY;
  process.env.KITH_SPACE_HOME = path.join(root, "app-home");
  process.env.JWT_SECRET = "human-route-jwt-secret-for-tests";
  process.env.DAEMON_BOOTSTRAP_KEY = "human-route-daemon-secret-for-tests";
  try {
    const { human, home } = await ensurePersonalApp({ name: "Ada", homeRootPath: path.join(root, "home-space") });
    const db = dbFor(home.id);
    await db.update(schema.users).set({ displayName: "Legacy drift" }).where(eq(schema.users.id, human.id));
    const { handleAuthedAuth } = await import("../src/server/routes-api/auth.ts");

    const getCapture = responseCapture();
    await handleAuthedAuth({
      req: jsonRequest(),
      res: getCapture.res,
      url: new URL("http://localhost/api/auth/me"),
      method: "GET",
      p: "/api/auth/me",
      userId: human.id,
    });
    assert.equal(getCapture.response.status, 200);
    assert.equal(getCapture.response.body.displayName, "Ada");

    const patchCapture = responseCapture();
    await handleAuthedAuth({
      req: jsonRequest({ displayName: "Grace", email: "grace@example.test", description: "Local Human" }),
      res: patchCapture.res,
      url: new URL("http://localhost/api/auth/me"),
      method: "PATCH",
      p: "/api/auth/me",
      userId: human.id,
    });
    assert.equal(patchCapture.response.status, 200);
    assert.equal(patchCapture.response.body.displayName, "Grace");
    assert.deepEqual(
      { name: getHumanProfile()?.name, email: getHumanProfile()?.email, description: getHumanProfile()?.description },
      { name: "Grace", email: "grace@example.test", description: "Local Human" },
    );
    const legacy = (await db.select().from(schema.users).where(eq(schema.users.id, human.id)))[0];
    assert.equal(legacy?.displayName, "Grace");
    assert.equal(legacy?.email, "grace@example.test");
    assert.equal(legacy?.description, "Local Human");

    const clearEmailCapture = responseCapture();
    await handleAuthedAuth({
      req: jsonRequest({ email: null }),
      res: clearEmailCapture.res,
      url: new URL("http://localhost/api/auth/me"),
      method: "PATCH",
      p: "/api/auth/me",
      userId: human.id,
    });
    assert.equal(clearEmailCapture.response.status, 200);
    assert.equal(getHumanProfile()?.email, null);
    const clearedLegacy = (await db.select().from(schema.users).where(eq(schema.users.id, human.id)))[0];
    assert.equal(clearedLegacy?.email, `${human.id}@human.kith-space.invalid`);
  } finally {
    closeAllDatabases();
    if (previousHome === undefined) delete process.env.KITH_SPACE_HOME;
    else process.env.KITH_SPACE_HOME = previousHome;
    if (previousJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwt;
    if (previousDaemonKey === undefined) delete process.env.DAEMON_BOOTSTRAP_KEY;
    else process.env.DAEMON_BOOTSTRAP_KEY = previousDaemonKey;
    rmSync(root, { recursive: true, force: true });
  }
});
