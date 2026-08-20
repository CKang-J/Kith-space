import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { describe, it } from "node:test";
import { CanvasValidationError } from "../canvasCore.js";
import { CanvasCore } from "../canvasCore.js";
import { closeSpaceDb, dbForSpace, registerSpace, unregisterSpace } from "../../db/index.js";
import { kithSpaceHome } from "../../paths.js";
import { enqueueHumanCanvasGenerationJob } from "./humanGeneration.js";
import { getGenerationJob } from "./generationJobQueue.js";
import { clearGenerationProviders, registerGenerationProvider } from "./generationProviders.js";
import type { IGenerationProvider } from "./contracts.js";

function fixture() {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "human-generation-test", spaceId);
  registerSpace({ id: spaceId, name: "Human Generation", slug: `human-gen-${spaceId}`, rootPath });
  const db = dbForSpace(spaceId);
  const canvas = new CanvasCore(db, spaceId).create({
    title: "Jobs",
    document: { deltaSetLike: { ROOT: { children: [] } }, frames: [] },
  });
  return {
    spaceId,
    db,
    canvasId: canvas.id,
    cleanup() {
      clearGenerationProviders();
      closeSpaceDb(spaceId);
      unregisterSpace(spaceId);
    },
  };
}

const fakeImage: IGenerationProvider = {
  name: "doubao",
  type: "image",
  async submit() { return "job"; },
  async getStatus() { return { status: "processing" }; },
  async downloadResult() { return Buffer.alloc(0); },
};

describe("enqueueHumanCanvasGenerationJob", () => {
  it("enqueues an image job against the live canvas without a grant", () => {
    const f = fixture();
    registerGenerationProvider(fakeImage);
    try {
      const job = enqueueHumanCanvasGenerationJob(f.db, f.spaceId, f.canvasId, {
        jobType: "image",
        genPrompt: "starry night poster background",
        placement: { x: 10, y: 20, width: 400, height: 225, targetNodeId: "plate" },
        config: { aspectRatio: "16:9", model: "doubao-seedream-4-0-250828", resolution: "2K" },
        idempotencyKey: "human-1",
      });
      assert.equal(job.jobType, "image");
      assert.equal(job.status, "pending");
      assert.equal(job.provider, "doubao");
      assert.equal(JSON.parse(job.placementJson).targetNodeId, "plate");
      assert.equal(JSON.parse(job.configJson ?? "{}").model, "doubao-seedream-4-0-250828");
      assert.equal(JSON.parse(job.configJson ?? "{}").resolution, "2K");
      assert.equal(getGenerationJob(f.db, job.id)?.id, job.id);
    } finally {
      f.cleanup();
    }
  });

  it("enqueues an audio job against OpenRouter", () => {
    const f = fixture();
    const fakeAudio: IGenerationProvider = {
      name: "openrouter",
      type: "audio",
      async submit() { return "job"; },
      async getStatus() { return { status: "processing" }; },
      async downloadResult() { return Buffer.alloc(0); },
    };
    registerGenerationProvider(fakeAudio);
    try {
      const job = enqueueHumanCanvasGenerationJob(f.db, f.spaceId, f.canvasId, {
        jobType: "audio",
        genPrompt: "read this caption aloud",
        placement: { x: 10, y: 20, width: 360, height: 80, targetNodeId: "plate" },
        config: { model: "or-gemini-3-1-flash-tts", voice: "Zephyr" },
        idempotencyKey: "human-audio-1",
      });
      assert.equal(job.jobType, "audio");
      assert.equal(job.provider, "openrouter");
      assert.equal(JSON.parse(job.configJson ?? "{}").model, "or-gemini-3-1-flash-tts");
      assert.equal(JSON.parse(job.configJson ?? "{}").voice, "Zephyr");
    } finally {
      f.cleanup();
    }
  });

  it("accepts skipNodeCreate so image process jobs do not spawn a second node", () => {
    const f = fixture();
    registerGenerationProvider(fakeImage);
    try {
      const job = enqueueHumanCanvasGenerationJob(f.db, f.spaceId, f.canvasId, {
        jobType: "image",
        genPrompt: "Upscale this image to 2K.",
        placement: { x: 0, y: 0, width: 1, height: 1, skipNodeCreate: true },
        config: { resolution: "2K", removeBg: true, cutoutMode: "hair" },
        idempotencyKey: "human-process-1",
      });
      assert.equal(JSON.parse(job.placementJson).skipNodeCreate, true);
      assert.equal(JSON.parse(job.configJson ?? "{}").removeBg, true);
      assert.equal(JSON.parse(job.configJson ?? "{}").cutoutMode, "hair");
    } finally {
      f.cleanup();
    }
  });

  it("rejects enqueue when no image provider is registered", () => {
    const f = fixture();
    try {
      assert.throws(
        () => enqueueHumanCanvasGenerationJob(f.db, f.spaceId, f.canvasId, {
          jobType: "image",
          genPrompt: "starry night poster background",
          placement: { x: 0, y: 0, width: 100, height: 100 },
          idempotencyKey: "human-missing-provider",
        }),
        (error: unknown) => error instanceof CanvasValidationError && /Doubao/i.test(error.message),
      );
    } finally {
      f.cleanup();
    }
  });
});
