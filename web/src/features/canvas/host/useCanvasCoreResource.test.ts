import assert from "node:assert/strict";
import test from "node:test";
import { isDeletedCanvasRecovery } from "../adapters/canvasRecovery.ts";

test("recovery only treats an explicit same-resource tombstone as Canvas deletion", () => {
  const expected = { canvasId: "canvas-a", spaceId: "space-a" };
  assert.equal(isDeletedCanvasRecovery({ deleted: true, canvasId: "canvas-a", spaceId: "space-a", sequence: 4 }, expected), true);
  assert.equal(isDeletedCanvasRecovery({ deleted: true, canvasId: "canvas-a", spaceId: "space-b", sequence: 4 }, expected), false);
  assert.equal(isDeletedCanvasRecovery({ deleted: true, canvasId: "canvas-b", spaceId: "space-a", sequence: 4 }, expected), false);
  assert.equal(isDeletedCanvasRecovery({ deleted: false, snapshot: {} as never, changes: [] }, expected), false);
  assert.equal(isDeletedCanvasRecovery(new Error("network unavailable"), expected), false);
});
