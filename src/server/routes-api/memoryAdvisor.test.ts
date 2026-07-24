import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../../db/index.js";
import { kithSpaceHome } from "../../paths.js";
import type { SpaceCtx } from "./ctx.js";
import { handleMemoryAdvisor } from "./memoryAdvisor.js";

function responseCapture() {
  const capture: { status?: number; body?: string } = {};
  const res = {
    writeHead(status: number) { capture.status = status; return this; },
    end(body?: string) { capture.body = body; return this; },
  } as unknown as ServerResponse;
  return { capture, res };
}

function request(body?: unknown): IncomingMessage {
  return Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as unknown as IncomingMessage;
}

test("Human advisor routes expose honest support and persist pause/budget settings", async () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  registerSpace({ id: spaceId, name: "Advisor API", slug: `advisor-api-${spaceId}`, rootPath: path.join(kithSpaceHome(), "advisor-api", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "advisor", displayName: "Advisor", runtime: "claude" }).run();
    const getResponse = responseCapture();
    const getUrl = new URL(`http://localhost/api/agents/${agentId}/memory-advisor`);
    await handleMemoryAdvisor({ req: request(), res: getResponse.res, url: getUrl, method: "GET", p: getUrl.pathname,
      humanId: "human", spaceId } satisfies SpaceCtx);
    assert.equal(getResponse.capture.status, 200);
    const initial = JSON.parse(getResponse.capture.body ?? "{}") as { support: { toolIsolation: string } };
    assert.equal(initial.support.toolIsolation, "enforced");

    const patchResponse = responseCapture();
    await handleMemoryAdvisor({ req: request({ paused: true, dailyTokenLimit: 1234, dailyCostMicrosLimit: 5678 }),
      res: patchResponse.res, url: getUrl, method: "PATCH", p: getUrl.pathname, humanId: "human", spaceId } satisfies SpaceCtx);
    assert.equal(patchResponse.capture.status, 200);
    const patched = JSON.parse(patchResponse.capture.body ?? "{}") as { settings: { pausedAt: string | number; dailyTokenLimit: number; dailyCostMicrosLimit: number } };
    assert.ok(patched.settings.pausedAt);
    assert.equal(patched.settings.dailyTokenLimit, 1234);
    assert.equal(patched.settings.dailyCostMicrosLimit, 5678);

    db.update(schema.agents).set({ runtime: "codex" }).where(eq(schema.agents.id, agentId)).run();
    const unsupportedResponse = responseCapture();
    await handleMemoryAdvisor({ req: request(), res: unsupportedResponse.res, url: getUrl, method: "GET", p: getUrl.pathname,
      humanId: "human", spaceId } satisfies SpaceCtx);
    const unsupported = JSON.parse(unsupportedResponse.capture.body ?? "{}") as { support: { toolIsolation: string } };
    assert.equal(unsupported.support.toolIsolation, "unsupported");
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});
