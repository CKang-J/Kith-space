import test from "node:test";
import assert from "node:assert/strict";
import {
  beginLegacyDataPlaneDrain,
  endLegacyDataPlaneDrain,
  enterLegacyDataPlane,
  waitForLegacyDataPlaneDrain,
} from "./legacyDataPlaneDrain.js";

test("legacy data-plane drain rejects new requests and waits for entered handlers", async () => {
  const agentId = "drain-agent";
  const release = enterLegacyDataPlane(agentId);
  assert.ok(release);
  beginLegacyDataPlaneDrain(agentId);
  assert.equal(enterLegacyDataPlane(agentId), null);
  let drained = false;
  const wait = waitForLegacyDataPlaneDrain(agentId, 1_000).then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(drained, false);
  release!();
  await wait;
  assert.equal(drained, true);
  endLegacyDataPlaneDrain(agentId);
  const next = enterLegacyDataPlane(agentId);
  assert.ok(next);
  next!();
});
