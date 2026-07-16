import test from "node:test";
import assert from "node:assert/strict";
import { insertAgentMention } from "./composerMention.ts";

test("inserts an Agent mention at the current caret with readable spacing", () => {
  assert.deepEqual(insertAgentMention("请处理", 3, 3, "Claude"), {
    text: "请处理 @Claude ",
    caret: 12,
  });
});

test("replaces a selection and preserves surrounding whitespace", () => {
  assert.deepEqual(insertAgentMention("请 old 处理", 2, 5, "Claude"), {
    text: "请 @Claude 处理",
    caret: 9,
  });
});
