import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanvasComposerPayload,
  canvasComposerSendDisabled,
  parseCanvasExecutors,
  validateCanvasComposerSend,
} from "./composerCanvasContext.ts";
import type { PendingCanvasChatContext } from "../../features/canvas/host/canvasChatBridge.ts";

const pending = (id: string, canvasId = "canvas-a"): PendingCanvasChatContext => ({
  id,
  canvasId,
  canvasTitle: "Board",
  selectedIds: [id],
  summaryParts: {
    canvasTitle: "Board",
    wholeCanvas: false,
    elementCount: 1,
    frameCount: 0,
    truncated: false,
    documentRevision: 0,
  },
  previewDocument: { id },
  surfaceId: "channel-a",
});

test("Composer Canvas payload submits every pending selection in order and binds a required executor", () => {
  assert.deepEqual(buildCanvasComposerPayload({
    canvasContexts: [pending("one"), pending("two")],
    executorAgentId: "agent-1",
  }), {
    canvasSelections: [
      { canvasId: "canvas-a", selectedIds: ["one"] },
      { canvasId: "canvas-a", selectedIds: ["two"] },
    ],
    executionBinding: { executorAgentId: "agent-1", mode: "required" },
  });
  assert.deepEqual(buildCanvasComposerPayload({
    canvasContexts: [pending("one")],
    dmAgent: { id: "peer" },
    executorAgentId: "",
  }), {
    canvasSelections: [{ canvasId: "canvas-a", selectedIds: ["one"] }],
  });
  assert.deepEqual(buildCanvasComposerPayload({ canvasContexts: [], executorAgentId: "agent-1" }), {});
});

test("Composer Canvas validation blocks task send and missing channel executor", () => {
  assert.equal(validateCanvasComposerSend({
    canvasContexts: [pending("one")],
    asTask: true,
    executorAgentId: "agent-1",
    executorLoadError: "",
    canvasCannotBeTask: "no-task",
    executorRequired: "need-exec",
  }), "no-task");
  assert.equal(validateCanvasComposerSend({
    canvasContexts: [pending("one")],
    asTask: false,
    executorAgentId: "",
    executorLoadError: "",
    canvasCannotBeTask: "no-task",
    executorRequired: "need-exec",
  }), "need-exec");
  assert.equal(canvasComposerSendDisabled({
    sending: false,
    hasText: false,
    hasAttachments: false,
    canvasContexts: [pending("one")],
    executorAgentId: "",
    executorLoadError: "",
  }), true);
  assert.equal(parseCanvasExecutors({ agents: [{ id: "a", name: "a", displayName: "A" }] }).agents[0]?.id, "a");
});
