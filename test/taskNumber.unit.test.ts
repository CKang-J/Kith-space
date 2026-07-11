// Unit tests for task-number scope-key selection (pure key derivation).
// Run: npx tsx --test --test-force-exit test/taskNumber.unit.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { taskNumberKey } from "../src/counters.ts";

test("non-DM channels all share the per-Space counter", () => {
  assert.equal(taskNumberKey("srv1", { type: "channel", id: "c1" }), "tasknum:srv1");
  assert.equal(taskNumberKey("srv1", { type: "private", id: "c2" }), "tasknum:srv1");
  assert.equal(taskNumberKey("srv1", { type: "thread", id: "c3" }), "tasknum:srv1");
  assert.equal(taskNumberKey("srv1", null), "tasknum:srv1");
  assert.equal(taskNumberKey("srv1"), "tasknum:srv1");
});

test("a DM gets its own counter keyed by the DM channel id (independent of the Space)", () => {
  assert.equal(taskNumberKey("srv1", { type: "dm", id: "dmA" }), "tasknum:dm:dmA");
  assert.equal(taskNumberKey("srv1", { type: "dm", id: "dmB" }), "tasknum:dm:dmB");
});

test("two DMs never share a counter, and a DM never shares the Space counter", () => {
  const dmA = taskNumberKey("srv1", { type: "dm", id: "dmA" });
  const dmB = taskNumberKey("srv1", { type: "dm", id: "dmB" });
  const space = taskNumberKey("srv1", { type: "channel", id: "c1" });
  assert.notEqual(dmA, dmB);
  assert.notEqual(dmA, space);
  assert.notEqual(dmB, space);
});
