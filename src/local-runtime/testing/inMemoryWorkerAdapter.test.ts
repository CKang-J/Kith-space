import assert from "node:assert/strict";
import test from "node:test";
import { sendToWorker } from "../workerHub.js";
import { createInMemoryWorkerAdapter } from "./inMemoryWorkerAdapter.js";

test("in-memory Worker adapter records socket-send acceptance without claiming admission", () => {
  const worker = createInMemoryWorkerAdapter({ runtimes: ["fake"] });
  try {
    assert.equal(sendToWorker({ type: "agent:deliver", agentId: "agent-1", seq: 42 }), true);
    assert.deepEqual(worker.messages(), [{ type: "agent:deliver", agentId: "agent-1", seq: 42 }]);
    assert.equal(worker.socketSendDurationsMs().length, 1);
    assert.equal(worker.socketSendDurationsMs()[0]! >= 0, true);
  } finally {
    worker.disconnect();
  }

  assert.equal(sendToWorker({ type: "agent:deliver", agentId: "agent-1", seq: 43 }), false);
});
