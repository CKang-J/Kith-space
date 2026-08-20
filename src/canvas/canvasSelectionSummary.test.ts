import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasSelectionSummaryParts,
  formatCanvasSelectionSummary,
  pendingSelectionSummaryParts,
} from "./canvasSelectionSummary.js";

test("formatCanvasSelectionSummary includes the frozen revision instead of leaving it unused", () => {
  assert.equal(
    formatCanvasSelectionSummary(canvasSelectionSummaryParts({
      canvasTitle: "Moodboard",
      wholeCanvas: true,
      elementCount: 3,
      frameCount: 0,
      documentRevision: 4,
    })),
    "Moodboard · entire canvas · 3 elements · rev 4",
  );
  assert.equal(
    formatCanvasSelectionSummary(canvasSelectionSummaryParts({
      canvasTitle: "Board",
      wholeCanvas: false,
      elementCount: 1,
      frameCount: 2,
      truncated: true,
      documentRevision: 0,
    })),
    "Board · 2 Frames · 1 element · truncated · rev 0",
  );
  assert.equal(pendingSelectionSummaryParts("Board", ["shape-1"], 7).documentRevision, 7);
});
