import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { describe, it } from "node:test";
import { closeSpaceDb, dbForSpace, registerSpace, unregisterSpace } from "../../db/index.js";
import { kithSpaceHome } from "../../paths.js";
import { CanvasCore } from "../canvasCore.js";
import type { IGenerationProvider } from "./contracts.js";
import { createGenerationJob, getGenerationJob } from "./generationJobQueue.js";
import { clearGenerationProviders, registerGenerationProvider } from "./generationProviders.js";
import { GenerationWorker } from "./generationWorker.js";

const PNG_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

describe("GenerationWorker", () => {
  it("imports a completed image and creates a canvas node", async () => {
    const spaceId = randomUUID();
    const rootPath = path.join(kithSpaceHome(), "generation-worker-test", spaceId);
    registerSpace({ id: spaceId, name: "Generation Worker", slug: `gen-worker-${spaceId}`, rootPath });
    const db = dbForSpace(spaceId);
    const core = new CanvasCore(db, spaceId);
    const canvas = core.create({
      title: "Jobs",
      document: { deltaSetLike: { ROOT: { children: [] } }, frames: [] },
    });
    const fake: IGenerationProvider = {
      name: "doubao",
      type: "image",
      async submit() { return "ark-url:https://example.invalid/generated.png"; },
      async getStatus() { return { status: "completed", resultUrl: "https://example.invalid/generated.png" }; },
      async downloadResult() { return PNG_BYTES; },
    };
    registerGenerationProvider(fake);
    try {
      const job = createGenerationJob(db, {
        canvasId: canvas.id,
        jobType: "image",
        genPrompt: "a starry night poster background",
        placement: { x: 10, y: 20, width: 120, height: 80, name: "sky" },
        provider: "doubao",
        idempotencyKey: "worker-image-1",
        expectedRevision: canvas.revisions.revision,
      });
      const worker = new GenerationWorker(db, spaceId, rootPath);
      await worker.pollOnce();
      const completed = getGenerationJob(db, job.id);
      assert.equal(completed?.status, "completed");
      assert.ok(completed?.resultAssetId);
      assert.ok(completed?.resultNodeId);
      const live = core.read(canvas.id);
      const nodes = (live.document as { deltaSetLike?: Record<string, { key?: string; assetId?: string; attrs?: { src?: string } }> }).deltaSetLike ?? {};
      assert.equal(nodes[completed!.resultNodeId!]?.key, "image");
      assert.equal(nodes[completed!.resultNodeId!]?.assetId, completed?.resultAssetId);
      assert.equal(
        nodes[completed!.resultNodeId!]?.attrs?.src,
        `/api/canvas-assets/${encodeURIComponent(spaceId)}/${encodeURIComponent(canvas.id)}/${encodeURIComponent(completed!.resultAssetId!)}`,
      );
    } finally {
      clearGenerationProviders();
      closeSpaceDb(spaceId);
      unregisterSpace(spaceId);
    }
  });

  it("promotes an existing generator plate in place instead of creating a second node", async () => {
    const spaceId = randomUUID();
    const rootPath = path.join(kithSpaceHome(), "generation-worker-test", spaceId);
    registerSpace({ id: spaceId, name: "Generation Worker Promote", slug: `gen-worker-promote-${spaceId}`, rootPath });
    const db = dbForSpace(spaceId);
    const core = new CanvasCore(db, spaceId);
    const canvas = core.create({
      title: "Jobs",
      document: {
        deltaSetLike: {
          ROOT: { id: "ROOT", children: ["plate"] },
          plate: {
            id: "plate",
            key: "image",
            x: 40,
            y: 50,
            width: 320,
            height: 180,
            attrs: { imageGenerator: true, name: "poster", processStatus: "running" },
          },
        },
        frames: [],
      },
    });
    const fake: IGenerationProvider = {
      name: "doubao",
      type: "image",
      async submit() { return "ark-url:https://example.invalid/generated.png"; },
      async getStatus() { return { status: "completed", resultUrl: "https://example.invalid/generated.png" }; },
      async downloadResult() { return PNG_BYTES; },
    };
    registerGenerationProvider(fake);
    try {
      const job = createGenerationJob(db, {
        canvasId: canvas.id,
        jobType: "image",
        genPrompt: "a starry night poster background",
        placement: {
          x: 40,
          y: 50,
          width: 320,
          height: 180,
          name: "poster",
          targetNodeId: "plate",
        },
        provider: "doubao",
        idempotencyKey: "worker-image-promote-1",
        expectedRevision: canvas.revisions.revision,
      });
      const worker = new GenerationWorker(db, spaceId, rootPath);
      await worker.pollOnce();
      const completed = getGenerationJob(db, job.id);
      assert.equal(completed?.status, "completed");
      assert.equal(completed?.resultNodeId, "plate");
      const live = core.read(canvas.id);
      const nodes = (live.document as {
        deltaSetLike?: Record<string, {
          key?: string;
          assetId?: string;
          attrs?: { src?: string; imageGenerator?: unknown; processStatus?: unknown };
        }>;
      }).deltaSetLike ?? {};
      assert.equal(Object.keys(nodes).filter((id) => id !== "ROOT").length, 1);
      assert.equal(nodes.plate?.key, "image");
      assert.equal(nodes.plate?.assetId, completed?.resultAssetId);
      assert.equal(nodes.plate?.attrs?.imageGenerator, undefined);
      assert.equal(nodes.plate?.attrs?.processStatus, undefined);
      assert.equal(
        nodes.plate?.attrs?.src,
        `/api/canvas-assets/${encodeURIComponent(spaceId)}/${encodeURIComponent(canvas.id)}/${encodeURIComponent(completed!.resultAssetId!)}`,
      );
    } finally {
      clearGenerationProviders();
      closeSpaceDb(spaceId);
      unregisterSpace(spaceId);
    }
  });

  it("imports a process result without creating or promoting a canvas node", async () => {
    const spaceId = randomUUID();
    const rootPath = path.join(kithSpaceHome(), "generation-worker-test", spaceId);
    registerSpace({ id: spaceId, name: "Generation Worker Skip", slug: `gen-worker-skip-${spaceId}`, rootPath });
    const db = dbForSpace(spaceId);
    const core = new CanvasCore(db, spaceId);
    const canvas = core.create({
      title: "Jobs",
      document: { deltaSetLike: { ROOT: { children: [] } }, frames: [] },
    });
    const fake: IGenerationProvider = {
      name: "doubao",
      type: "image",
      async submit() { return "ark-url:https://example.invalid/processed.png"; },
      async getStatus() { return { status: "completed", resultUrl: "https://example.invalid/processed.png" }; },
      async downloadResult() { return PNG_BYTES; },
    };
    registerGenerationProvider(fake);
    try {
      const job = createGenerationJob(db, {
        canvasId: canvas.id,
        jobType: "image",
        genPrompt: "Upscale this image to 2K.",
        placement: { x: 0, y: 0, width: 1, height: 1, skipNodeCreate: true },
        provider: "doubao",
        idempotencyKey: "worker-image-skip-1",
        expectedRevision: canvas.revisions.revision,
      });
      const worker = new GenerationWorker(db, spaceId, rootPath);
      await worker.pollOnce();
      const completed = getGenerationJob(db, job.id);
      assert.equal(completed?.status, "completed");
      assert.ok(completed?.resultAssetId);
      assert.equal(completed?.resultNodeId, null);
      const live = core.read(canvas.id);
      const nodes = (live.document as { deltaSetLike?: Record<string, unknown> }).deltaSetLike ?? {};
      assert.deepEqual(Object.keys(nodes).filter((id) => id !== "ROOT"), []);
    } finally {
      clearGenerationProviders();
      closeSpaceDb(spaceId);
      unregisterSpace(spaceId);
    }
  });
});
