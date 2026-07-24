import assert from "node:assert/strict";
import test from "node:test";
import { projectLexicalText } from "./lexicalProjection.js";

test("Chinese projection emits deterministic two/three-character terms and exact fallback", () => {
  const projected = projectLexicalText("用户喜欢简洁周报格式");
  assert.ok(projected.cjkBigrams.split(" ").includes("周报"));
  assert.ok(projected.cjkBigrams.split(" ").includes("简洁"));
  assert.ok(projected.cjkTrigrams.split(" ").includes("简洁周"));
  assert.ok(projected.shortExactTerms.includes("周报"));
  assert.ok(projected.shortExactTerms.includes("简"));
});

test("mixed projection normalizes width/case without losing CJK terms", () => {
  const projected = projectLexicalText("Weekly 周报 ＡＢＣ 2026");
  assert.match(projected.lexicalText, /weekly/);
  assert.match(projected.lexicalText, /abc/);
  assert.match(projected.lexicalText, /2026/);
  assert.ok(projected.cjkBigrams.split(" ").includes("周报"));
});
