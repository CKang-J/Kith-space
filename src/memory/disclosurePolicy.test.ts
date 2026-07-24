import assert from "node:assert/strict";
import test from "node:test";
import { disclosureProjection } from "./disclosurePolicy.js";

test("mixed public and private evidence keeps the strict cross-surface projection", () => {
  assert.equal(disclosureProjection({
    disclosure: "shareable_summary",
    targetSurfaceId: "public-target",
    evidence: [
      { sourceSurfaceId: "public-source", visibilityAtOccurrence: "public" },
      { sourceSurfaceId: "private-source", visibilityAtOccurrence: "dm" },
    ],
    hasInternalSummary: true,
    hasShareableSummary: true,
  }), "shareable_summary");
  assert.equal(disclosureProjection({
    disclosure: "internal_use",
    targetSurfaceId: "same",
    evidence: [
      { sourceSurfaceId: "same", visibilityAtOccurrence: "dm" },
      { sourceSurfaceId: "public-source", visibilityAtOccurrence: "public" },
    ],
    hasInternalSummary: true,
    hasShareableSummary: false,
  }), "canonical");
});
