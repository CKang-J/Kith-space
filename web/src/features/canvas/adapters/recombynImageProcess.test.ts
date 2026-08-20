import assert from "node:assert/strict";
import test from "node:test";
import {
  configureRecombynGenerationBridge,
} from "./recombynGeneration.ts";
import {
  imageProcessPrompt,
  processImageTool,
  unsupportedImageProcessKindMessage,
} from "./recombynImageProcess.ts";

test("imageProcessPrompt covers Seedream i2i toolbar kinds", () => {
  assert.match(imageProcessPrompt("upscale", {}, "4K"), /4K/);
  assert.match(imageProcessPrompt("removeBg"), /background/i);
  assert.match(imageProcessPrompt("multiAngle", { rotate: 45, tilt: -10, zoom: 5, mode: "camera" }), /zoom 5/);
  assert.match(imageProcessPrompt("replaceText", { originalText: "Hello", newText: "Hi" }), /Hi/);
});

test("editElements and detectRegions stay honestly unsupported", () => {
  assert.match(unsupportedImageProcessKindMessage("editElements"), /视觉分解/);
  assert.match(unsupportedImageProcessKindMessage("detectRegions"), /视觉分解/);
});

test("processImageTool submits a skipNodeCreate job and returns the durable result URL", async () => {
  const created: unknown[] = [];
  const completed = {
    id: "job-1",
    canvasId: "canvas-1",
    jobType: "image" as const,
    status: "completed" as const,
    genPrompt: "upscale",
    resultAssetId: "asset-out",
    resultNodeId: null,
    resultSrc: "/api/canvas-assets/space-1/canvas-1/asset-out",
    errorMessage: null,
    createdAt: 1,
    completedAt: 2,
  };
  const restore = configureRecombynGenerationBridge({
    createJob: async (body) => {
      created.push(body);
      return { ...completed, genPrompt: body.genPrompt, status: "pending" };
    },
    getJob: async () => completed,
  });
  try {
    const result = await processImageTool({
      kind: "upscale",
      image: "/api/canvas-assets/space-1/canvas-1/asset-in",
      resolution: "2K",
    });
    assert.equal(result.image, "/api/canvas-assets/space-1/canvas-1/asset-out");
    assert.equal(result.kind, "upscale");
    const body = created[0] as {
      placement: { skipNodeCreate?: boolean };
      config?: { referenceAssetId?: string; resolution?: string };
    };
    assert.equal(body.placement.skipNodeCreate, true);
    assert.equal(body.config?.referenceAssetId, "asset-in");
    assert.equal(body.config?.resolution, "2K");
  } finally {
    restore();
  }
});

test("processImageTool coalesces in-flight jobs for the same image", async () => {
  let creates = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const completed = {
    id: "job-share",
    canvasId: "canvas-1",
    jobType: "image" as const,
    status: "completed" as const,
    genPrompt: "upscale",
    resultAssetId: "asset-out",
    resultNodeId: null,
    resultSrc: "/api/canvas-assets/space-1/canvas-1/asset-out",
    errorMessage: null,
    createdAt: 1,
    completedAt: 2,
  };
  const restore = configureRecombynGenerationBridge({
    createJob: async (body) => {
      creates += 1;
      await gate;
      return { ...completed, genPrompt: body.genPrompt, status: "pending" };
    },
    getJob: async () => completed,
  });
  try {
    const first = processImageTool({
      kind: "upscale",
      image: "/api/canvas-assets/space-1/canvas-1/asset-in",
      resolution: "2K",
    });
    const second = processImageTool({
      kind: "upscale",
      image: "/api/canvas-assets/space-1/canvas-1/asset-in",
      resolution: "2K",
    });
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(creates, 1);
    assert.equal(a.image, b.image);
  } finally {
    restore();
  }
});

test("processImageTool rejects image layering instead of calling Recombyn cloud", async () => {
  await assert.rejects(
    () => processImageTool({ kind: "editElements", image: "/api/canvas-assets/s/c/a" }),
    /视觉分解/,
  );
});
