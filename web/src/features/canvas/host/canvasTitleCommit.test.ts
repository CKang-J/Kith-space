import assert from "node:assert/strict";
import test from "node:test";
import { planCanvasTitleCommit } from "./canvasTitleCommit.ts";

test("empty draft stays empty so the chrome input is not refilled", () => {
  assert.deepEqual(planCanvasTitleCommit("draft", "", "未命名画布"), { kind: "skip" });
  assert.deepEqual(planCanvasTitleCommit("draft", "   ", "未命名画布"), { kind: "skip" });
});

test("empty commit restores the last durable title instead of sending it to Core", () => {
  assert.deepEqual(planCanvasTitleCommit("commit", "", "未命名画布"), {
    kind: "restore",
    title: "未命名画布",
  });
  assert.deepEqual(planCanvasTitleCommit("commit", "\t", "海报"), { kind: "restore", title: "海报" });
});

test("a real rename is trimmed and committed", () => {
  assert.deepEqual(planCanvasTitleCommit("draft", "  星空海报  ", "未命名画布"), {
    kind: "rename",
    title: "星空海报",
  });
  assert.deepEqual(planCanvasTitleCommit("commit", "星空海报", "未命名画布"), {
    kind: "rename",
    title: "星空海报",
  });
});

test("unchanged or empty durable titles do not emit a Core rename", () => {
  assert.deepEqual(planCanvasTitleCommit("draft", "海报", "海报"), { kind: "skip" });
  assert.deepEqual(planCanvasTitleCommit("commit", "", ""), { kind: "skip" });
});
