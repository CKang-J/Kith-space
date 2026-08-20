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

test("Composer Canvas payload carries marked regions for Agent context, not as chat text", () => {
  const marked = pending("image-1");
  marked.markedRegions = [{
    nodeId: "image-1",
    label: "1 区域",
    kind: "manual",
    nx: 0.1,
    ny: 0.2,
    nw: 0.3,
    nh: 0.4,
  }];
  assert.deepEqual(buildCanvasComposerPayload({
    canvasContexts: [marked],
    dmAgent: { id: "peer" },
    executorAgentId: "",
  }), {
    canvasSelections: [{
      canvasId: "canvas-a",
      selectedIds: ["image-1"],
      markedRegions: marked.markedRegions,
    }],
  });
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
