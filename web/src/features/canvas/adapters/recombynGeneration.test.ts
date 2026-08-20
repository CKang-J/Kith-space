import assert from "node:assert/strict";
import test from "node:test";
import {
  asGenerationAspectRatio,
  canvasAssetIdFromUrl,
  canvasNodePlacement,
  firstReferenceAssetId,
  formatGenerationWaitError,
} from "./recombynGeneration.ts";

test("asGenerationAspectRatio keeps Doubao ratios including smart", () => {
  assert.equal(asGenerationAspectRatio("16:9"), "16:9");
  assert.equal(asGenerationAspectRatio("smart"), "smart");
  assert.equal(asGenerationAspectRatio("3:2"), "3:2");
  assert.equal(asGenerationAspectRatio(""), undefined);
});

test("firstReferenceAssetId prefers uploadKey then durable canvas asset URLs", () => {
  assert.equal(firstReferenceAssetId([{ uploadKey: "asset-a", payload: "ignored" }]), "asset-a");
  assert.equal(
    firstReferenceAssetId([{ payload: "/api/canvas-assets/space-1/canvas-1/asset-b" }]),
    "asset-b",
  );
  assert.equal(canvasAssetIdFromUrl("/api/canvas-assets/s/c/id%2F1"), "id/1");
  assert.equal(firstReferenceAssetId([], "/api/canvas-assets/s/c/fallback"), "fallback");
});

test("canvasNodePlacement reads live node geometry and falls back to the plate box", () => {
  assert.deepEqual(
    canvasNodePlacement({ x: 8, y: 9, width: 100, height: 50, frameId: "frame-1", attrs: { name: "sky" } }),
    { x: 8, y: 9, width: 100, height: 50, frameId: "frame-1", name: "sky" },
  );
  assert.deepEqual(
    canvasNodePlacement(undefined, { x: 1, y: 2, width: 3, height: 4 }),
    { x: 1, y: 2, width: 3, height: 4 },
  );
});

test("formatGenerationWaitError turns silent timeouts into an actionable Chinese error", () => {
  assert.match(formatGenerationWaitError("Generation timed out"), /生成超时/);
  assert.match(formatGenerationWaitError("Ark request timed out after 90000ms"), /图生图/);
  assert.equal(formatGenerationWaitError("Doubao image API error: 401"), "Doubao image API error: 401");
});
