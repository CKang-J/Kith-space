import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sendToWorker } from "../src/local-runtime/workerHub.ts";
import { createInMemoryWorkerAdapter } from "../src/local-runtime/testing/inMemoryWorkerAdapter.ts";

test("current Core transport treats synchronous socket send as enqueue success", () => {
  const worker = createInMemoryWorkerAdapter();
  try {
    assert.equal(sendToWorker({ type: "agent:deliver", agentId: "agent-1", seq: 1 }), true);
    assert.equal(worker.messages().length, 1);
  } finally {
    worker.disconnect();
  }
});

test("current Worker emits deliver ack but Core does not consume it", () => {
  const workerSource = readFileSync(new URL("../src/daemon/index.ts", import.meta.url), "utf8");
  const coreSource = readFileSync(new URL("../src/server/ws.ts", import.meta.url), "utf8");

  assert.match(workerSource, /type:\s*"agent:deliver:ack"/);
  assert.doesNotMatch(coreSource, /agent:deliver:ack/);
});
