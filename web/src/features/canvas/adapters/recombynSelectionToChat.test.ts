import assert from "node:assert/strict";
import test from "node:test";
import {
  CANVAS_SELECTION_TO_CHAT_EVENT,
  requestCanvasSelectionToChat,
} from "./recombynSelectionToChat.ts";

test("selection-to-chat stays a local host event seam and carries source canvasId", () => {
  const events: unknown[] = [];
  const originalWindow = globalThis.window;
  const originalCustomEvent = globalThis.CustomEvent;
  class TestCustomEvent<T> {
    constructor(public type: string, public init: { detail: T }) {}
  }
  Object.defineProperty(globalThis, "CustomEvent", { configurable: true, value: TestCustomEvent });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { dispatchEvent: (event: unknown) => (events.push(event), true) },
  });
  try {
    requestCanvasSelectionToChat(["node-a", "node-b"], "Chat", {
      canvasId: "canvas-a",
      canvasTitle: "Board A",
      documentRevision: 3,
    });
    assert.equal(events.length, 1);
    assert.equal((events[0] as TestCustomEvent<unknown>).type, CANVAS_SELECTION_TO_CHAT_EVENT);
    assert.deepEqual((events[0] as TestCustomEvent<{
      target: string[];
      canvasId: string;
      canvasTitle?: string;
      documentRevision?: number;
    }>).init.detail, {
      target: ["node-a", "node-b"],
      canvasId: "canvas-a",
      canvasTitle: "Board A",
      documentRevision: 3,
      previewDocument: undefined,
    });
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    Object.defineProperty(globalThis, "CustomEvent", { configurable: true, value: originalCustomEvent });
  }
});
