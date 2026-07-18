import assert from "node:assert/strict";
import test from "node:test";
import { sendToWorker } from "../workerHub.js";
import { createInMemoryWorkerAdapter } from "./inMemoryWorkerAdapter.js";

test("in-memory Worker adapter records non-admission transport messages", () => {
  const worker = createInMemoryWorkerAdapter({ runtimes: ["fake"] });
  try {
    assert.equal(sendToWorker({ type: "agent:profile", agentId: "agent-1" }), true);
    assert.deepEqual(worker.messages(), [{ type: "agent:profile", agentId: "agent-1" }]);
    assert.equal(worker.socketSendDurationsMs().length, 1);
    assert.equal(worker.socketSendDurationsMs()[0]! >= 0, true);
  } finally {
    worker.disconnect();
  }

  assert.equal(sendToWorker({ type: "agent:profile", agentId: "agent-1" }), false);
});
