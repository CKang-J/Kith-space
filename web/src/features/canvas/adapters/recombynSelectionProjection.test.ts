import assert from "node:assert/strict";
import test from "node:test";
import { survivingNodeSelection } from "./recombynSelectionProjection.ts";

test("Core document projection keeps the native selection when the node still exists", () => {
  assert.deepEqual(
    survivingNodeSelection(["created", "removed"], {
      deltaSetLike: { ROOT: { id: "ROOT" }, created: { id: "created" } },
    }),
    ["created"],
  );
});

test("Core document projection drops stale native node ids", () => {
  assert.deepEqual(survivingNodeSelection(["removed"], { deltaSetLike: {} }), []);
  assert.deepEqual(survivingNodeSelection(["removed"], null), []);
});
