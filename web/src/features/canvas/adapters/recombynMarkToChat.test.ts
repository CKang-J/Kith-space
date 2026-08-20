import assert from "node:assert/strict";
import test from "node:test";
import { CANVAS_SELECTION_TO_CHAT_EVENT } from "./recombynSelectionToChat.ts";
import {
  KITH_COMPOSER_ATTACH_FILE_EVENT,
  dataUrlToFile,
  kithChatFlyLandId,
  resolveKithChatFlyTarget,
  sendMarkedImageRegionToChat,
} from "./recombynMarkToChat.ts";
import {
  pushCanvasChatSurface,
  resetCanvasChatBridgeForTests,
} from "../host/canvasChatBridge.ts";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==";

test("kithChatFlyLandId prefers the active Chat surface", () => {
  resetCanvasChatBridgeForTests();
  assert.equal(kithChatFlyLandId(), null);
  const release = pushCanvasChatSurface("channel-left");
  try {
    assert.equal(kithChatFlyLandId(), "kith-chat:channel-left");
    assert.equal(kithChatFlyLandId("thread-1"), "kith-chat:thread-1");
  } finally {
    release();
    resetCanvasChatBridgeForTests();
  }
});

test("resolveKithChatFlyTarget falls back to the left composer, not the right dock", () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { innerWidth: 1400, innerHeight: 900 },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { querySelector: () => null },
  });
  try {
    const point = resolveKithChatFlyTarget();
    assert.ok(point.x < 400, `expected left-side x, got ${point.x}`);
    assert.ok(point.x < 1400 - 220, "must not use Recombyn's right-dock fallback");
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  }
});

test("dataUrlToFile round-trips a PNG data URL", () => {
  const file = dataUrlToFile(TINY_PNG, "region.png");
  assert.equal(file.name, "region.png");
  assert.equal(file.type, "image/png");
  assert.ok(file.size > 0);
});

test("sendMarkedImageRegionToChat grants the image node and attaches the crop", () => {
  const events: Array<{ type: string; detail: unknown }> = [];
  const originalWindow = globalThis.window;
  const originalCustomEvent = globalThis.CustomEvent;
  class TestCustomEvent<T> {
    constructor(public type: string, public init: { detail: T }) {
      Object.assign(this, { detail: init.detail });
    }
  }
  Object.defineProperty(globalThis, "CustomEvent", { configurable: true, value: TestCustomEvent });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { dispatchEvent: (event: { type: string; detail?: unknown }) => (events.push({ type: event.type, detail: event.detail }), true) },
  });
  resetCanvasChatBridgeForTests();
  const release = pushCanvasChatSurface("channel-left");
  try {
    sendMarkedImageRegionToChat({
      canvasId: "canvas-a",
      nodeId: "image-1",
      label: "1 区域",
      region: { x: 100, y: 80, w: 200, h: 160, kind: "manual" },
      nodeWidth: 1000,
      nodeHeight: 800,
      dataUrl: TINY_PNG,
    });
    assert.equal(events.length, 2);
    assert.equal(events[0]?.type, CANVAS_SELECTION_TO_CHAT_EVENT);
    const selection = events[0]?.detail as {
      target: string;
      canvasId: string;
      markedRegions?: Array<{ nodeId: string; nx: number; ny: number; nw: number; nh: number }>;
    };
    assert.equal(selection.target, "image-1");
    assert.equal(selection.canvasId, "canvas-a");
    assert.deepEqual(selection.markedRegions, [{
      nodeId: "image-1",
      label: "1 区域",
      kind: "manual",
      nx: 0.1,
      ny: 0.1,
      nw: 0.2,
      nh: 0.2,
    }]);
    assert.equal(events[1]?.type, KITH_COMPOSER_ATTACH_FILE_EVENT);
    const attach = events[1]?.detail as { file?: File; caption?: string; surfaceId?: string };
    assert.equal(attach.caption, undefined);
    assert.equal(attach.surfaceId, "channel-left");
    assert.ok(attach.file instanceof File);
    assert.equal(attach.file?.type, "image/png");
  } finally {
    release();
    resetCanvasChatBridgeForTests();
    Object.defineProperty(globalThis, "CustomEvent", { configurable: true, value: originalCustomEvent });
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});
