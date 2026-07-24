import assert from "node:assert/strict";
import test from "node:test";
import { selectUnifiedMemoryRecall } from "./memoryRecallSelection.js";

test("cross-store recall uses one score order and one continuity/query quota", () => {
  const continuity = Array.from({ length: 15 }, (_, index) => ({
    id: `continuity-${index}`, score: index === 14 ? 100 : 20 - index,
    reasons: ["continuity"], content: "short",
  }));
  const query = Array.from({ length: 10 }, (_, index) => ({
    id: `query-${index}`, score: 50 - index, reasons: ["query"], content: "short",
  }));
  const selected = selectUnifiedMemoryRecall([...continuity, ...query]);
  assert.equal(selected.filter((item) => item.reasons.includes("continuity")).length, 12);
  assert.equal(selected.filter((item) => item.reasons.includes("query")).length, 8);
  assert.equal(selected[0]?.id, "continuity-14", "store append order cannot outrank a higher normalized score");
});
