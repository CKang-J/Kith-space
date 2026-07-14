import assert from "node:assert/strict";
import test from "node:test";
import { historyTraversalDelta } from "./useChannelSettingsScene.ts";

test("history traversal guard restores and replays the same distance", () => {
  assert.equal(historyTraversalDelta(8, 7), 1);
  assert.equal(historyTraversalDelta(8, 5), 3);
  assert.equal(historyTraversalDelta(5, 7), -2);
});
