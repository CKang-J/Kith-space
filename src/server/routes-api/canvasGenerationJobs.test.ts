import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { CanvasCore } from "../../canvas/canvasCore.js";
import { createGenerationJob } from "../../canvas/generation/generationJobQueue.js";
import { closeSpaceDb, dbForSpace, registerSpace, unregisterSpace } from "../../db/index.js";
import { kithSpaceHome } from "../../paths.js";
import { handleCanvasGenerationJobs } from "./canvasGenerationJobs.js";

test("canvas-generation-jobs by-turn route returns only that turn's jobs", async () => {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "canvas-genjobs-by-turn", spaceId);
  registerSpace({ id: spaceId, name: "Gen Jobs By Turn", slug: `gen-jobs-by-turn-${spaceId}`, rootPath });
  try {
    const db = dbForSpace(spaceId);
    const canvas = new CanvasCore(db, spaceId).create({ title: "Gen", document: { deltaSetLike: { ROOT: { children: [] } }, frames: [] } });
    createGenerationJob(db, {
      canvasId: canvas.id,
      jobType: "video",
      genPrompt: "camera slowly pans right across neon cityscape",
      placement: { x: 0, y: 0, width: 640, height: 360 },
      provider: "seedream",
      turnId: "turn-1",
      idempotencyKey: "idem-1",
      expectedRevision: 0,
    });
    createGenerationJob(db, {
      canvasId: canvas.id,
      jobType: "image",
      genPrompt: "deep space nebula",
      placement: { x: 1, y: 1, width: 512, height: 512 },
      provider: "doubao",
      turnId: "turn-2",
      idempotencyKey: "idem-2",
      expectedRevision: 0,
    });

    let status = 0;
    const responseChunks: Buffer[] = [];
    const res = {
      writeHead(code: number) { status = code; return this; },
      end(chunk?: string | Buffer) { if (chunk) responseChunks.push(Buffer.from(chunk)); return this; },
    };
    const handled = handleCanvasGenerationJobs({
      req: { headers: {} } as never,
      res: res as never,
      url: new URL("http://localhost/api/canvas-generation-jobs/by-turn/turn-1"),
      method: "GET",
      p: "/api/canvas-generation-jobs/by-turn/turn-1",
      humanId: "human",
      spaceId,
    });
    assert.equal(await handled, true);
    assert.equal(status, 200);
    const body = JSON.parse(Buffer.concat(responseChunks).toString("utf8")) as {
      jobs: Array<{ id: string; canvasId: string; jobType: string; status: string; resultSrc: string | null }>;
    };
    assert.equal(body.jobs.length, 1);
    assert.equal(body.jobs[0]!.jobType, "video");
    assert.equal(body.jobs[0]!.status, "pending");
    assert.equal(body.jobs[0]!.canvasId, canvas.id);
    assert.equal(body.jobs[0]!.resultSrc, null);
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});

test("canvas-generation-jobs by-turn route returns an empty list for unknown turns", async () => {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "canvas-genjobs-by-turn-empty", spaceId);
  registerSpace({ id: spaceId, name: "Gen Jobs By Turn Empty", slug: `gen-jobs-by-turn-empty-${spaceId}`, rootPath });
  try {
    let status = 0;
    const responseChunks: Buffer[] = [];
    const res = {
      writeHead(code: number) { status = code; return this; },
      end(chunk?: string | Buffer) { if (chunk) responseChunks.push(Buffer.from(chunk)); return this; },
    };
    const handled = handleCanvasGenerationJobs({
      req: { headers: {} } as never,
      res: res as never,
      url: new URL("http://localhost/api/canvas-generation-jobs/by-turn/nope"),
      method: "GET",
      p: "/api/canvas-generation-jobs/by-turn/nope",
      humanId: "human",
      spaceId,
    });
    assert.equal(await handled, true);
    assert.equal(status, 200);
    const body = JSON.parse(Buffer.concat(responseChunks).toString("utf8")) as { jobs: unknown[] };
    assert.deepEqual(body.jobs, []);
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});
