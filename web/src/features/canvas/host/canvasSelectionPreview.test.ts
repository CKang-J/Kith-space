import assert from "node:assert/strict";
import test from "node:test";
import { previewDocumentFromCanvasSelection } from "./canvasSelectionPreview.ts";

test("preview helper prefers an explicit preview document and otherwise projects selected elements", () => {
  assert.equal(previewDocumentFromCanvasSelection({}), null);
  assert.deepEqual(previewDocumentFromCanvasSelection({ previewDocument: { id: "live" } }), { id: "live" });
  assert.deepEqual(previewDocumentFromCanvasSelection({
    projection: {
      elements: [{ id: "shape-1", x: 1 }],
      frames: [{ id: "frame-1" }],
    },
  }), {
    deltaSetLike: {
      ROOT: { children: ["shape-1"] },
      "shape-1": { id: "shape-1", x: 1 },
    },
    frames: [{ id: "frame-1" }],
  });
});
