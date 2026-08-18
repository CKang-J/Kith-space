import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getActiveCanvasChatSurface,
  getPendingCanvasChatContext,
  parseCanvasSelectionTarget,
  pushCanvasChatSurface,
  resetCanvasChatBridgeForTests,
  setPendingCanvasChatContext,
} from "./canvasChatBridge";
import { pendingSelectionSummaryParts } from "./canvasSelectionCopy";
import {
  applyCanvasSelectionFocus,
  peekCanvasSelectionFocus,
  requestCanvasSelectionFocus,
  resetCanvasSelectionFocusForTests,
} from "./canvasSelectionFocus";

test("selection-to-chat parses element and Frame targets", () => {
  assert.deepEqual(parseCanvasSelectionTarget(["shape-1", "frame:board", "shape-1", ""]), ["shape-1", "frame:board"]);
});

test("pending canvas selection is isolated per Chat surface", () => {
  resetCanvasChatBridgeForTests();
  const releaseA = pushCanvasChatSurface("channel-a");
  setPendingCanvasChatContext({
    canvasId: "canvas-a",
    canvasTitle: "Board A",
    selectedIds: ["shape-1"],
    previewDocument: { id: "a" },
  });
  assert.equal(getPendingCanvasChatContext("channel-a")?.canvasId, "canvas-a");
  const releaseB = pushCanvasChatSurface("channel-b");
  assert.equal(getActiveCanvasChatSurface(), "channel-b");
  assert.equal(getPendingCanvasChatContext("channel-b"), null);
  assert.equal(getPendingCanvasChatContext("channel-a")?.selectedIds[0], "shape-1");
  setPendingCanvasChatContext({
    canvasId: "canvas-b",
    canvasTitle: "Board B",
    selectedIds: ["frame:one"],
    previewDocument: { id: "b" },
  });
  assert.equal(getPendingCanvasChatContext("channel-b")?.canvasId, "canvas-b");
  assert.equal(getPendingCanvasChatContext("channel-a")?.canvasId, "canvas-a");
  releaseB();
  assert.equal(getActiveCanvasChatSurface(), "channel-a");
  assert.equal(getPendingCanvasChatContext()?.canvasId, "canvas-a");
  releaseA();
  resetCanvasChatBridgeForTests();
});

test("pending selection summary parts stay locale-neutral", () => {
  assert.deepEqual(pendingSelectionSummaryParts("Moodboard", []), {
    canvasTitle: "Moodboard",
    wholeCanvas: true,
    elementCount: 0,
    frameCount: 0,
    truncated: false,
    documentRevision: 0,
  });
  assert.equal(pendingSelectionSummaryParts("Moodboard", ["a", "frame:b"]).frameCount, 1);
  assert.equal(pendingSelectionSummaryParts("Moodboard", ["a", "b"]).elementCount, 2);
  assert.equal(pendingSelectionSummaryParts("  ", ["shape-1"]).canvasTitle, "");
});

test("selection focus is consumed after the matching canvas applies it", () => {
  resetCanvasSelectionFocusForTests();
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: () => undefined });
  try {
    const applied: string[][] = [];
    requestCanvasSelectionFocus({ canvasId: "canvas-a", nodeIds: ["n1"], frameIds: ["f1"] });
    const release = applyCanvasSelectionFocus("canvas-a", (request) => {
      applied.push([...request.nodeIds, ...request.frameIds]);
    });
    assert.deepEqual(applied, [["n1", "f1"]]);
    assert.equal(peekCanvasSelectionFocus(), null);
    requestCanvasSelectionFocus({ canvasId: "canvas-a", nodeIds: ["n2"], frameIds: [] });
    assert.deepEqual(applied, [["n1", "f1"], ["n2"]]);
    assert.equal(peekCanvasSelectionFocus(), null);
    release();
  } finally {
    Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: originalRaf });
    Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: originalCancel });
    resetCanvasSelectionFocusForTests();
  }
});
