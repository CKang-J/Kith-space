import assert from "node:assert/strict";
import test from "node:test";
import {
  CANVAS_SELECTION_TO_CHAT_EVENT,
  requestCanvasSelectionToChat,
} from "./recombynSelectionToChat.ts";

test("selection-to-chat stays a local host event seam", () => {
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
    requestCanvasSelectionToChat(["node-a", "node-b"]);
    assert.equal(events.length, 1);
    assert.equal((events[0] as TestCustomEvent<unknown>).type, CANVAS_SELECTION_TO_CHAT_EVENT);
    assert.deepEqual((events[0] as TestCustomEvent<{ target: string[] }>).init.detail.target, ["node-a", "node-b"]);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    Object.defineProperty(globalThis, "CustomEvent", { configurable: true, value: originalCustomEvent });
  }
});
