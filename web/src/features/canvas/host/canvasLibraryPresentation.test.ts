import assert from "node:assert/strict";
import { test } from "node:test";
import { canvasPreviewScene, formatCanvasUpdatedAt } from "./canvasLibraryPresentation";

test("Canvas Library preview projects Frames and scene nodes from the Core snapshot", () => {
  const preview = canvasPreviewScene({
    width: 1200,
    height: 800,
    frames: [{ id: "frame-1", x: 100, y: 80, width: 400, height: 300, backgroundColor: "#fff" }],
    deltaSetLike: {
      ROOT: { id: "ROOT", children: ["shape-1"] },
      "shape-1": { id: "shape-1", key: "shape", x: 150, y: 120, width: 80, height: 60, attrs: { shapeType: "ellipse", "fill-color": "#f00" } },
    },
  });
  assert.equal(preview.items.length, 2);
  assert.equal(preview.items[0]?.kind, "frame");
  assert.equal(preview.items[1]?.kind, "ellipse");
  assert.match(preview.viewBox, /^\S+ \S+ \S+ \S+$/);
});

test("Canvas Library formats update dates in Chinese", () => {
  assert.match(formatCanvasUpdatedAt("2026-08-16T08:00:00.000Z"), /^更新于 2026年8月16日$/);
  assert.equal(formatCanvasUpdatedAt("invalid"), "更新时间未知");
});

test("Canvas Library thumbnail rejects external CSS paint resources", () => {
  const preview = canvasPreviewScene({
    frames: [{ id: "frame-1", x: 0, y: 0, width: 100, height: 100, backgroundColor: "url(https://invalid.example/a.svg)" }],
    deltaSetLike: { ROOT: { id: "ROOT", children: [] } },
  });
  assert.equal(preview.items[0]?.fill, "#ffffff");
});

test("Canvas Library thumbnail exposes only durable local image sources", () => {
  const preview = canvasPreviewScene({
    deltaSetLike: {
      ROOT: { id: "ROOT", children: ["local", "remote"] },
      local: { id: "local", key: "image", x: 0, y: 0, width: 100, height: 80, attrs: { src: "/api/canvas-assets/space-a/canvas-a/asset-a" } },
      remote: { id: "remote", key: "image", x: 120, y: 0, width: 100, height: 80, attrs: { src: "https://invalid.example/image.png" } },
    },
  });
  assert.equal(preview.items.find((item) => item.id === "local")?.src, "/api/canvas-assets/space-a/canvas-a/asset-a");
  assert.equal(preview.items.find((item) => item.id === "remote")?.src, undefined);
});
