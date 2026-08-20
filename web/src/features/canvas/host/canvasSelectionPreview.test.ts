import assert from "node:assert/strict";
import test from "node:test";
import {
  extractSelectionPreviewDocument,
  previewDocumentFromCanvasSelection,
} from "./canvasSelectionPreview.ts";

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

test("selection preview document crops to selected nodes and shifts them into a mini board", () => {
  const source = {
    deltaSetLike: {
      ROOT: { children: ["a", "b"] },
      a: { id: "a", key: "text", x: 10, y: 20, width: 80, height: 40, attrs: { text: "A" } },
      b: { id: "b", key: "shape", x: 400, y: 300, width: 120, height: 90, attrs: { "fill-color": "#ff0000" } },
    },
    frames: [],
  };
  const slice = extractSelectionPreviewDocument(source, ["a"]) as {
    width: number;
    height: number;
    deltaSetLike: Record<string, { x: number; y: number }>;
  };
  assert.ok(slice);
  assert.equal(slice.deltaSetLike.a?.x, 12);
  assert.equal(slice.deltaSetLike.a?.y, 12);
  assert.ok(slice.width >= 32);
  assert.ok(slice.height >= 32);
});

test("selection preview document crops to a selected Frame and its overlapping nodes", () => {
  const source = {
    deltaSetLike: {
      ROOT: { children: ["in", "out"] },
      in: { id: "in", key: "shape", x: 10, y: 10, width: 40, height: 40 },
      out: { id: "out", key: "shape", x: 400, y: 10, width: 40, height: 40 },
    },
    frames: [{ id: "board", x: 0, y: 0, width: 200, height: 200 }],
  };
  const slice = extractSelectionPreviewDocument(source, ["frame:board"]) as {
    frames: Array<{ id: string }>;
    deltaSetLike: Record<string, unknown>;
  };
  assert.ok(slice);
  assert.equal(slice.frames[0]?.id, "board");
  assert.ok(slice.deltaSetLike.in);
  assert.equal(slice.deltaSetLike.out, undefined);
});
