import assert from "node:assert/strict";
import { test } from "node:test";
import { removeSpacesInOrder } from "./spaceBatchRemoval.ts";

test("batch Space removal is sequential and retains failed selections", async () => {
  const calls: string[] = [];
  const result = await removeSpacesInOrder(["space-1", "space-2", "space-3"], async (spaceId) => {
    calls.push(spaceId);
    return { ok: spaceId !== "space-2" };
  });

  assert.deepEqual(calls, ["space-1", "space-2", "space-3"]);
  assert.deepEqual(result, { removedIds: ["space-1", "space-3"], failedIds: ["space-2"] });
});

test("batch Space removal treats transport failures as retryable failures", async () => {
  const result = await removeSpacesInOrder(["space-1"], async () => {
    throw new Error("network unavailable");
  });

  assert.deepEqual(result, { removedIds: [], failedIds: ["space-1"] });
});
