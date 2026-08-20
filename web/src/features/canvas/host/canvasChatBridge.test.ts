import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appendPendingCanvasChatContext,
  bindCanvasSelectionToChat,
  canvasToolbarChatTargets,
  getActiveCanvasChatSurface,
  getPendingCanvasChatContext,
  getPendingCanvasChatContexts,
  grantWholeCanvasChatContext,
  isWholeCanvasChatContext,
  listOpenCanvasChatSources,
  parseCanvasSelectionTarget,
  pendingCanvasSelectionKey,
  pushCanvasChatSurface,
  removePendingCanvasChatContext,
  resetCanvasChatBridgeForTests,
  setPendingCanvasChatContext,
  toggleOpenCanvasChatContext,
  toggleWholeCanvasChatContext,
} from "./canvasChatBridge";
import { CANVAS_SELECTION_TO_CHAT_EVENT } from "../adapters/recombynSelectionToChat";
import { pendingSelectionSummaryParts } from "./canvasSelectionCopy";
import {
  applyCanvasSelectionFocus,
  peekCanvasSelectionFocus,
  requestCanvasSelectionFocus,
  resetCanvasSelectionFocusForTests,
} from "./canvasSelectionFocus";

test("selection-to-chat parses element and Frame targets", () => {
  assert.deepEqual(parseCanvasSelectionTarget(["shape-1", "frame:board", "shape-1", ""]), ["shape-1", "frame:board"]);
  assert.deepEqual(canvasToolbarChatTargets(["shape-1"], ["board"]), ["shape-1", "frame:board"]);
  assert.equal(canvasToolbarChatTargets(["shape-1"], []), "shape-1");
  assert.equal(canvasToolbarChatTargets([], ["board"]), "frame:board");
});

test("pending canvas selections append, dedupe, remove, and stay isolated per Chat surface", () => {
  resetCanvasChatBridgeForTests();
  const releaseA = pushCanvasChatSurface("channel-a");
  appendPendingCanvasChatContext({
    canvasId: "canvas-a",
    canvasTitle: "Board A",
    selectedIds: ["shape-1"],
    previewDocument: { id: "a" },
  });
  appendPendingCanvasChatContext({
    canvasId: "canvas-a",
    canvasTitle: "Board A",
    selectedIds: ["shape-2"],
    previewDocument: { id: "a2" },
  });
  appendPendingCanvasChatContext({
    canvasId: "canvas-a",
    canvasTitle: "Board A",
    selectedIds: ["shape-1"],
    previewDocument: { id: "dup" },
  });
  assert.deepEqual(getPendingCanvasChatContexts("channel-a").map((item) => item.selectedIds), [["shape-1"], ["shape-2"]]);
  assert.equal(getPendingCanvasChatContext("channel-a")?.selectedIds[0], "shape-1");
  const releaseB = pushCanvasChatSurface("channel-b");
  assert.equal(getActiveCanvasChatSurface(), "channel-b");
  assert.deepEqual(getPendingCanvasChatContexts("channel-b"), []);
  assert.equal(getPendingCanvasChatContexts("channel-a").length, 2);
  appendPendingCanvasChatContext({
    canvasId: "canvas-b",
    canvasTitle: "Board B",
    selectedIds: ["frame:one"],
    previewDocument: { id: "b" },
  });
  assert.equal(getPendingCanvasChatContexts("channel-b")[0]?.canvasId, "canvas-b");
  assert.equal(getPendingCanvasChatContexts("channel-a")[0]?.canvasId, "canvas-a");
  const first = getPendingCanvasChatContexts("channel-a")[0]!;
  removePendingCanvasChatContext(first.id, "channel-a");
  assert.deepEqual(getPendingCanvasChatContexts("channel-a").map((item) => item.selectedIds), [["shape-2"]]);
  releaseB();
  assert.equal(getActiveCanvasChatSurface(), "channel-a");
  assert.equal(getPendingCanvasChatContexts()[0]?.selectedIds[0], "shape-2");
  setPendingCanvasChatContext(null, "channel-a");
  assert.deepEqual(getPendingCanvasChatContexts("channel-a"), []);
  assert.equal(getPendingCanvasChatContexts("channel-b").length, 1);
  releaseA();
  resetCanvasChatBridgeForTests();
});

test("same canvas and same selected ids share one pending identity", () => {
  assert.equal(
    pendingCanvasSelectionKey("canvas-a", ["shape-2", "frame:one"]),
    pendingCanvasSelectionKey("canvas-a", ["frame:one", "shape-2"]),
  );
  assert.notEqual(
    pendingCanvasSelectionKey("canvas-a", ["shape-1"]),
    pendingCanvasSelectionKey("canvas-a", ["shape-2"]),
  );
  assert.notEqual(
    pendingCanvasSelectionKey("canvas-a", ["frame:one"]),
    pendingCanvasSelectionKey("canvas-a", ["frame:two"]),
  );
});

test("switching Chat surface A to B and back to A restores pending cards", () => {
  resetCanvasChatBridgeForTests();
  const releaseA = pushCanvasChatSurface("channel-a");
  appendPendingCanvasChatContext({
    canvasId: "canvas-a",
    canvasTitle: "Board A",
    selectedIds: ["shape-1"],
    previewDocument: { id: "a" },
  });
  const releaseB = pushCanvasChatSurface("channel-b");
  assert.deepEqual(getPendingCanvasChatContexts("channel-b"), []);
  assert.equal(getPendingCanvasChatContexts("channel-a")[0]?.selectedIds[0], "shape-1");
  releaseB();
  assert.equal(getActiveCanvasChatSurface(), "channel-a");
  assert.equal(getPendingCanvasChatContexts("channel-a")[0]?.selectedIds[0], "shape-1");
  assert.equal(getPendingCanvasChatContexts()[0]?.canvasId, "canvas-a");
  releaseA();
  resetCanvasChatBridgeForTests();
});

test("selection-to-chat writes pending from the event canvasId, not whichever Canvas is mounted", () => {
  resetCanvasChatBridgeForTests();
  pushCanvasChatSurface("channel-a");
  const originalWindow = globalThis.window;
  const listeners = new Map<string, Set<EventListener>>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener(type: string, listener: EventListener) {
        const set = listeners.get(type) ?? new Set();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener(type: string, listener: EventListener) {
        listeners.get(type)?.delete(listener);
      },
      dispatchEvent(event: { type: string; detail?: unknown }) {
        for (const listener of listeners.get(event.type) ?? []) {
          listener(event as Event);
        }
        return true;
      },
    },
  });
  try {
    const releaseA = bindCanvasSelectionToChat({
      canvasId: "canvas-a",
      canvasTitle: "Board A",
      previewDocument: { id: "a" },
      documentRevision: 2,
    });
    const releaseB = bindCanvasSelectionToChat({
      canvasId: "canvas-b",
      canvasTitle: "Board B",
      previewDocument: { id: "b" },
      documentRevision: 5,
    });
    assert.deepEqual(
      getPendingCanvasChatContexts("channel-a"),
      [],
      "opening a Canvas must not auto-authorize Chat",
    );
    window.dispatchEvent(new CustomEvent(CANVAS_SELECTION_TO_CHAT_EVENT, {
      detail: { target: ["shape-from-b"], canvasId: "canvas-b" },
    }));
    assert.deepEqual(
      getPendingCanvasChatContexts("channel-a").map((item) => ({ canvasId: item.canvasId, ids: item.selectedIds })),
      [{ canvasId: "canvas-b", ids: ["shape-from-b"] }],
    );
    assert.equal(getPendingCanvasChatContexts("channel-a").find((item) => item.canvasId === "canvas-b")?.canvasTitle, "Board B");
    window.dispatchEvent(new CustomEvent(CANVAS_SELECTION_TO_CHAT_EVENT, {
      detail: { target: ["shape-missing"], canvasId: "canvas-missing" },
    }));
    window.dispatchEvent(new CustomEvent(CANVAS_SELECTION_TO_CHAT_EVENT, {
      detail: { target: ["shape-orphan"] },
    }));
    assert.deepEqual(getPendingCanvasChatContexts("channel-a").map((item) => item.canvasId), ["canvas-b"]);
    releaseA();
    releaseB();
    assert.deepEqual(
      getPendingCanvasChatContexts("channel-a").map((item) => item.selectedIds),
      [["shape-from-b"]],
      "closing Canvas tabs must not discard user-sent pending Chat context",
    );
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    resetCanvasChatBridgeForTests();
  }
});

test("opening a Canvas does not auto-authorize; plus-menu grant survives closing the tab", () => {
  resetCanvasChatBridgeForTests();
  const originalWindow = globalThis.window;
  const listeners = new Map<string, Set<EventListener>>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener(type: string, listener: EventListener) {
        const set = listeners.get(type) ?? new Set();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener(type: string, listener: EventListener) {
        listeners.get(type)?.delete(listener);
      },
      dispatchEvent() { return true; },
    },
  });
  try {
    const releaseSurface = pushCanvasChatSurface("channel-a");
    const releaseCanvas = bindCanvasSelectionToChat({
      canvasId: "canvas-open",
      canvasTitle: "Open Board",
      previewDocument: { id: "open" },
      documentRevision: 3,
    });
    assert.deepEqual(getPendingCanvasChatContexts("channel-a"), []);
    assert.deepEqual(listOpenCanvasChatSources(), [{ canvasId: "canvas-open", canvasTitle: "Open Board" }]);
    const granted = grantWholeCanvasChatContext("canvas-open", "channel-a");
    assert.equal(granted?.canvasId, "canvas-open");
    assert.deepEqual(granted?.selectedIds, []);
    assert.equal(granted?.previewDocument, null);
    assert.equal(granted?.summaryParts.wholeCanvas, true);
    assert.equal(isWholeCanvasChatContext(granted!), true);
    releaseCanvas();
    assert.equal(getPendingCanvasChatContexts("channel-a")[0]?.id, granted?.id);
    assert.deepEqual(listOpenCanvasChatSources(), []);
    releaseSurface();
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    resetCanvasChatBridgeForTests();
  }
});

test("whole-canvas grant and circled selection coexist; toggling the menu only drops whole-canvas chips", () => {
  resetCanvasChatBridgeForTests();
  const originalWindow = globalThis.window;
  const listeners = new Map<string, Set<EventListener>>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener(type: string, listener: EventListener) {
        const set = listeners.get(type) ?? new Set();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener(type: string, listener: EventListener) {
        listeners.get(type)?.delete(listener);
      },
      dispatchEvent(event: { type: string; detail?: unknown }) {
        for (const listener of listeners.get(event.type) ?? []) {
          listener(event as Event);
        }
        return true;
      },
    },
  });
  try {
    pushCanvasChatSurface("channel-a");
    bindCanvasSelectionToChat({
      canvasId: "canvas-open",
      canvasTitle: "Open Board",
      previewDocument: { id: "open" },
      documentRevision: 3,
    });
    grantWholeCanvasChatContext("canvas-open", "channel-a");
    window.dispatchEvent(new CustomEvent(CANVAS_SELECTION_TO_CHAT_EVENT, {
      detail: { target: ["shape-1"], canvasId: "canvas-open" },
    }));
    assert.deepEqual(
      getPendingCanvasChatContexts("channel-a").map((item) => item.selectedIds),
      [[], ["shape-1"]],
    );
    toggleWholeCanvasChatContext("canvas-open", "channel-a");
    assert.deepEqual(getPendingCanvasChatContexts("channel-a").map((item) => item.selectedIds), [["shape-1"]]);
    toggleOpenCanvasChatContext("channel-a");
    assert.deepEqual(
      getPendingCanvasChatContexts("channel-a").map((item) => item.selectedIds),
      [["shape-1"], []],
    );
    toggleOpenCanvasChatContext("channel-a");
    assert.deepEqual(getPendingCanvasChatContexts("channel-a").map((item) => item.selectedIds), [["shape-1"]]);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    resetCanvasChatBridgeForTests();
  }
});

test("selection-to-chat reads the live document at send time instead of every editor tick", () => {
  resetCanvasChatBridgeForTests();
  const originalWindow = globalThis.window;
  const listeners = new Map<string, Set<EventListener>>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener(type: string, listener: EventListener) {
        const set = listeners.get(type) ?? new Set();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener(type: string, listener: EventListener) {
        listeners.get(type)?.delete(listener);
      },
      dispatchEvent(event: { type: string; detail?: unknown }) {
        for (const listener of listeners.get(event.type) ?? []) {
          listener(event as Event);
        }
        return true;
      },
    },
  });
  try {
    pushCanvasChatSurface("channel-a");
    const live = { id: "live-at-send" };
    bindCanvasSelectionToChat({
      canvasId: "canvas-open",
      canvasTitle: "Open Board",
      previewDocument: { id: "stale" },
      documentRevision: 3,
      getLivePreviewDocument: () => live,
    });
    window.dispatchEvent(new CustomEvent(CANVAS_SELECTION_TO_CHAT_EVENT, {
      detail: { target: ["shape-1"], canvasId: "canvas-open" },
    }));
    const selection = getPendingCanvasChatContexts("channel-a").find((item) => !isWholeCanvasChatContext(item));
    assert.equal(selection?.previewDocument, live);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    resetCanvasChatBridgeForTests();
  }
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

test("a second mark on the same image merges the boxed region onto the existing pending card", () => {
  resetCanvasChatBridgeForTests();
  const originalWindow = globalThis.window;
  const listeners = new Map<string, Set<EventListener>>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener(type: string, listener: EventListener) {
        const set = listeners.get(type) ?? new Set();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener(type: string, listener: EventListener) {
        listeners.get(type)?.delete(listener);
      },
      dispatchEvent(event: { type: string; detail?: unknown }) {
        for (const listener of listeners.get(event.type) ?? []) {
          listener(event as Event);
        }
        return true;
      },
    },
  });
  try {
    pushCanvasChatSurface("channel-a");
    bindCanvasSelectionToChat({
      canvasId: "canvas-open",
      canvasTitle: "Open Board",
      previewDocument: { id: "open" },
    });
    window.dispatchEvent(new CustomEvent(CANVAS_SELECTION_TO_CHAT_EVENT, {
      detail: {
        target: "image-1",
        canvasId: "canvas-open",
        markedRegions: [{ nodeId: "image-1", label: "1 区域", kind: "manual", nx: 0.1, ny: 0.1, nw: 0.2, nh: 0.2 }],
      },
    }));
    window.dispatchEvent(new CustomEvent(CANVAS_SELECTION_TO_CHAT_EVENT, {
      detail: {
        target: "image-1",
        canvasId: "canvas-open",
        markedRegions: [{ nodeId: "image-1", label: "2 区域", kind: "manual", nx: 0.5, ny: 0.5, nw: 0.2, nh: 0.2 }],
      },
    }));
    const pending = getPendingCanvasChatContexts("channel-a");
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.markedRegions?.length, 2);
    assert.equal(pending[0]?.markedRegions?.[1]?.label, "2 区域");
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    resetCanvasChatBridgeForTests();
  }
});
