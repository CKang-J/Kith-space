import test from "node:test";
import assert from "node:assert/strict";
import { messageSearchTextSegments } from "./messageSearchPresentation.ts";

test("message search highlighting keeps original text and finds every case-insensitive match", () => {
  assert.deepEqual(messageSearchTextSegments("Claude claude", "CLAUDE"), [
    { text: "Claude", matched: true },
    { text: " ", matched: false },
    { text: "claude", matched: true },
  ]);
});

test("message search highlighting leaves text untouched for an empty query", () => {
  assert.deepEqual(messageSearchTextSegments("原始内容", "  "), [{ text: "原始内容", matched: false }]);
});
