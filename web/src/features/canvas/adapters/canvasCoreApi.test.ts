import assert from "node:assert/strict";
import test from "node:test";
import { canvasAssetUrl, canvasCoreApi } from "./canvasCoreApi.ts";

test("Canvas API rejects Core error envelopes and builds a Space-bound media URL", async () => {
  const client = canvasCoreApi(async () => ({ error: "revision conflict", currentRevision: 7 }));
  await assert.rejects(() => client.read("canvas-1"), /revision conflict/);
  assert.equal(
    canvasAssetUrl("space/1", "canvas 1", "asset#1"),
    "/api/canvas-assets/space%2F1/canvas%201/asset%231",
  );
});

test("Canvas API exposes formal export and revisioned soft-delete lifecycle endpoints", async () => {
  const calls: Array<[string, string, unknown]> = [];
  const client = canvasCoreApi(async (method, path, body) => {
    calls.push([method, path, body]);
    if (path.endsWith("/export")) return { format: "kith-canvas-scene", version: 1, title: "Exported", scene: { deltaSetLike: { ROOT: { children: [] } }, frames: [] } };
    return { ok: true, deleted: true };
  });
  assert.equal((await client.exportScene("canvas/1")).format, "kith-canvas-scene");
  assert.deepEqual(await client.deleteCanvas("canvas/1", 4), { ok: true, deleted: true });
  assert.deepEqual(calls[0], ["GET", "/api/canvases/canvas%2F1/export", undefined]);
  assert.equal(calls[1]![0], "DELETE");
  assert.equal(calls[1]![1], "/api/canvases/canvas%2F1");
  assert.equal((calls[1]![2] as { expectedRevision: number }).expectedRevision, 4);
});
