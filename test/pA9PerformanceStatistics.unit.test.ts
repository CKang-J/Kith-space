import assert from "node:assert/strict";
import test from "node:test";
import { median, percentile, summarizeRounds } from "../scripts/p-a9/statistics.mjs";

test("P-A9 percentile and median use deterministic nearest-rank literals", () => {
  assert.equal(percentile([9, 1, 5, 3, 7], 50), 5);
  assert.equal(percentile([9, 1, 5, 3, 7], 95), 9);
  assert.equal(median([4, 2, 8, 6]), 5);
});

test("P-A9 round summary reports median p95 and coefficient of variation", () => {
  const summary = summarizeRounds([
    Array.from({ length: 100 }, (_, index) => index + 1),
    Array.from({ length: 100 }, (_, index) => index + 2),
  ]);

  assert.deepEqual(summary.roundP95, [95, 96]);
  assert.deepEqual(summary.roundP50, [50, 51]);
  assert.equal(summary.medianP50, 50.5);
  assert.equal(summary.medianP95, 95.5);
  assert.equal(summary.p95CoefficientOfVariation > 0, true);
  assert.equal(summary.sampleCount, 200);
});
