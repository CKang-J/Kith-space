import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseCanvasSelectionTarget,
  pendingCanvasSummary,
} from "./canvasChatBridge";

test("selection-to-chat parses element and Frame targets and summarizes pending context", () => {
  assert.deepEqual(parseCanvasSelectionTarget(["shape-1", "frame:board", "shape-1", ""]), ["shape-1", "frame:board"]);
  assert.match(pendingCanvasSummary("Moodboard", []), /整张画布/);
  assert.match(pendingCanvasSummary("Moodboard", ["a", "frame:b"]), /1 个 Frame/);
  assert.match(pendingCanvasSummary("Moodboard", ["a", "b"]), /2 个元素/);
});
