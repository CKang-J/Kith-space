import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { describe, it } from "node:test";
import { kithSpaceHome } from "../../paths.js";
import { closeSpaceDb, dbForSpace, registerSpace, unregisterSpace } from "../../db/index.js";
import { CanvasCore } from "../canvasCore.js";
import {
  createGenerationJob,
  getGenerationJob,
  incrementRetryCount,
  listPendingJobs,
  listProcessingJobs,
  updateJobStatus,
} from "./generationJobQueue.js";

function fixture() {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "generation-job-queue-test", spaceId);
  registerSpace({ id: spaceId, name: "Generation Jobs", slug: `gen-jobs-${spaceId}`, rootPath });
  const db = dbForSpace(spaceId);
  const canvas = new CanvasCore(db, spaceId).create({
    title: "Jobs",
    document: { deltaSetLike: { ROOT: { children: [] } }, frames: [] },
  });
  return {
    db,
    canvasId: canvas.id,
    cleanup() {
      closeSpaceDb(spaceId);
      unregisterSpace(spaceId);
    },
  };
}

describe("generationJobQueue", () => {
  it("creates and retrieves a job", async () => {
    const f = fixture();
    try {
      const job = await createGenerationJob(f.db, {
        canvasId: f.canvasId,
        jobType: "image",
        genPrompt: "A cyberpunk city at night",
        placement: { x: 0, y: 0, width: 800, height: 600 },
        provider: "stability",
        idempotencyKey: "test-key-1",
        expectedRevision: 1,
      });

      assert.equal(job.status, "pending");
      assert.equal(job.genPrompt, "A cyberpunk city at night");
      assert.equal(job.retryCount, 0);

      const retrieved = await getGenerationJob(f.db, job.id);
      assert.equal(retrieved?.id, job.id);
      assert.equal(retrieved?.canvasId, f.canvasId);
    } finally {
      f.cleanup();
    }
  });

  it("lists pending jobs", async () => {
    const f = fixture();
    try {
      await createGenerationJob(f.db, {
        canvasId: f.canvasId,
        jobType: "image",
        genPrompt: "Test 1",
        placement: { x: 0, y: 0, width: 100, height: 100 },
        provider: "stability",
        idempotencyKey: "key-1",
        expectedRevision: 1,
      });
      await createGenerationJob(f.db, {
        canvasId: f.canvasId,
        jobType: "video",
        genPrompt: "Test 2",
        placement: { x: 0, y: 0, width: 100, height: 100 },
        provider: "runway",
        idempotencyKey: "key-2",
        expectedRevision: 1,
      });

      const pending = await listPendingJobs(f.db);
      assert.equal(pending.length, 2);
    } finally {
      f.cleanup();
    }
  });

  it("returns the existing row for the same canvas idempotency key", async () => {
    const f = fixture();
    try {
      const first = await createGenerationJob(f.db, {
        canvasId: f.canvasId,
        jobType: "image",
        genPrompt: "Original prompt",
        placement: { x: 0, y: 0, width: 100, height: 100 },
        provider: "stability",
        idempotencyKey: "same-key",
        expectedRevision: 1,
      });
      const second = await createGenerationJob(f.db, {
        canvasId: f.canvasId,
        jobType: "image",
        genPrompt: "Different prompt",
        placement: { x: 10, y: 10, width: 200, height: 200 },
        provider: "stability",
        idempotencyKey: "same-key",
        expectedRevision: 2,
      });
      assert.equal(second.id, first.id);
      assert.equal(second.genPrompt, "Original prompt");
      assert.equal((await listPendingJobs(f.db)).length, 1);
    } finally {
      f.cleanup();
    }
  });

  it("updates job status", async () => {
    const f = fixture();
    try {
      const job = await createGenerationJob(f.db, {
        canvasId: f.canvasId,
        jobType: "image",
        genPrompt: "Test",
        placement: { x: 0, y: 0, width: 100, height: 100 },
        provider: "stability",
        idempotencyKey: "key-1",
        expectedRevision: 1,
      });

      await updateJobStatus(f.db, job.id, {
        status: "processing",
        providerJobId: "provider-123",
        startedAt: Date.now(),
      });

      const updated = await getGenerationJob(f.db, job.id);
      assert.equal(updated?.status, "processing");
      assert.equal(updated?.providerJobId, "provider-123");
      assert.equal((await listPendingJobs(f.db)).length, 0);
      assert.equal((await listProcessingJobs(f.db)).length, 1);
    } finally {
      f.cleanup();
    }
  });

  it("increments retry count", async () => {
    const f = fixture();
    try {
      const job = await createGenerationJob(f.db, {
        canvasId: f.canvasId,
        jobType: "image",
        genPrompt: "Test",
        placement: { x: 0, y: 0, width: 100, height: 100 },
        provider: "stability",
        idempotencyKey: "key-1",
        expectedRevision: 1,
      });

      await updateJobStatus(f.db, job.id, { status: "failed" });
      await incrementRetryCount(f.db, job.id);

      const updated = await getGenerationJob(f.db, job.id);
      assert.equal(updated?.retryCount, 1);
      assert.equal(updated?.status, "pending");
    } finally {
      f.cleanup();
    }
  });
});
