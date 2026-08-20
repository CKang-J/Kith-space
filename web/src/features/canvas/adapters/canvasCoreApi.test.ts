import assert from "node:assert/strict";
import test from "node:test";
import { canvasAssetUrl, canvasCoreApi, hydrateCanvasDocumentMediaSrc } from "./canvasCoreApi.ts";

test("Canvas API rejects Core error envelopes and builds a Space-bound media URL", async () => {
  const client = canvasCoreApi(async () => ({ error: "revision conflict", currentRevision: 7 }));
  await assert.rejects(() => client.read("canvas-1"), /revision conflict/);
  assert.equal(
    canvasAssetUrl("space/1", "canvas 1", "asset#1"),
    "/api/canvas-assets/space%2F1/canvas%201/asset%231",
  );
});

test("hydrateCanvasDocumentMediaSrc binds durable src for Agent nodes that only stored assetId", () => {
  const hydrated = hydrateCanvasDocumentMediaSrc({
    deltaSetLike: {
      ROOT: { id: "ROOT", children: ["gen", "upload"] },
      gen: { id: "gen", key: "image", assetId: "asset-a", width: 80, height: 60, attrs: { name: "sky" } },
      upload: {
        id: "upload",
        key: "image",
        assetId: "asset-b",
        attrs: { src: "/api/canvas-assets/space-a/canvas-a/asset-b" },
      },
      shape: { id: "shape", key: "shape", attrs: {} },
    },
  }, "space-a", "canvas-a") as {
    deltaSetLike: Record<string, { attrs?: { src?: string; uploadKey?: string } }>;
  };
  assert.equal(hydrated.deltaSetLike.gen?.attrs?.src, "/api/canvas-assets/space-a/canvas-a/asset-a");
  assert.equal(hydrated.deltaSetLike.gen?.attrs?.uploadKey, "asset-a");
  assert.equal(hydrated.deltaSetLike.upload?.attrs?.src, "/api/canvas-assets/space-a/canvas-a/asset-b");
});

test("Canvas API exposes formal export and revisioned soft-delete lifecycle endpoints", async () => {
  const calls: Array<[string, string, unknown]> = [];
  const client = canvasCoreApi(async (method, path, body) => {
    calls.push([method, path, body]);
    if (path.endsWith("/export")) return { format: "kith-canvas-scene", version: 1, title: "Exported", scene: { deltaSetLike: { ROOT: { children: [] } }, frames: [] } };
    if (path.endsWith("/generation-jobs")) return { id: "job-1", canvasId: "canvas/1", jobType: "image", status: "pending" };
    return { ok: true, deleted: true };
  });
  assert.equal((await client.exportScene("canvas/1")).format, "kith-canvas-scene");
  assert.deepEqual(await client.deleteCanvas("canvas/1", 4), { ok: true, deleted: true });
  const created = await client.createGenerationJob("canvas/1", {
    jobType: "image",
    genPrompt: "starry night poster background",
    placement: { x: 0, y: 0, width: 100, height: 100, targetNodeId: "plate" },
    idempotencyKey: "job-1",
  });
  assert.equal(created.id, "job-1");
  assert.deepEqual(calls[0], ["GET", "/api/canvases/canvas%2F1/export", undefined]);
  assert.equal(calls[1]![0], "DELETE");
  assert.equal(calls[1]![1], "/api/canvases/canvas%2F1");
  assert.equal((calls[1]![2] as { expectedRevision: number }).expectedRevision, 4);
  assert.equal(calls[2]![0], "POST");
  assert.equal(calls[2]![1], "/api/canvases/canvas%2F1/generation-jobs");
});
