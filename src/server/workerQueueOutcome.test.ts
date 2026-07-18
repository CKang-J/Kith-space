import assert from "node:assert/strict";
import test from "node:test";
import type { WorkerQueueOutcome } from "../runtime/contract/runtimeWorkerPort.js";
import { terminalWakeReplyEvent } from "./workerQueueOutcome.js";

const expiredWake: WorkerQueueOutcome = {
  id: "wake-1",
  source: "wake",
  generation: 1,
  spaceId: "space-1",
  agentId: "agent-1",
  status: "expired",
  queuedMs: 120_000,
  reason: "runtime admission queue expired",
  channelId: "channel-1",
  streamId: "stream-1",
};

test("a terminal queued wake closes its visible reply preview with an error", () => {
  assert.deepEqual(terminalWakeReplyEvent(expiredWake, "Helper"), {
    type: "agent:reply",
    agentId: "agent-1",
    channelId: "channel-1",
    streamId: "stream-1",
    name: "Helper",
    op: "error",
    text: "runtime admission queue expired",
  });
});

test("completed, manual, and unscoped outcomes do not synthesize reply events", () => {
  assert.equal(terminalWakeReplyEvent({ ...expiredWake, status: "completed" }, "Helper"), null);
  assert.equal(terminalWakeReplyEvent({ ...expiredWake, source: "manual" }, "Helper"), null);
  assert.equal(terminalWakeReplyEvent({ ...expiredWake, streamId: undefined }, "Helper"), null);
});
