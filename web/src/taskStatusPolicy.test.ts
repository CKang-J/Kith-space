import assert from "node:assert/strict";
import { test } from "node:test";
import { taskStatusOptions } from "./taskStatusPolicy.ts";

test("the single Human can use every task status", () => {
  assert.deepEqual(taskStatusOptions(), ["todo", "in_progress", "in_review", "done", "closed"]);
});
