import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createInMemoryWorkerAdapter } from "../src/local-runtime/testing/inMemoryWorkerAdapter.ts";
import { runtimeWorkerPort } from "../src/runtime/control/runtimeWorkerAdapter.ts";

test("Core transport resolves only after the Worker admission ack", async () => {
  const worker = createInMemoryWorkerAdapter();
  try {
    const result = await runtimeWorkerPort.deliver({
      type: "agent:deliver",
      source: "wake",
      deliveryId: "reservation-1",
      spaceId: "space-1",
      agentId: "agent-1",
      seq: 1,
      from: "human",
      target: "channel-1",
      targetName: "#general",
      msgShort: "message-1",
      isTask: false,
      mentioned: true,
      responseDirective: "required",
      responseReason: "test",
    });
    assert.equal(result.status, "admitted");
    assert.equal(worker.messages().length, 1);
  } finally {
    worker.disconnect();
  }
});

test("Worker and Core share the generation-aware admission ack contract", () => {
  const workerSource = readFileSync(new URL("../src/daemon/index.ts", import.meta.url), "utf8");
  const coreSource = readFileSync(new URL("../src/server/ws.ts", import.meta.url), "utf8");

  assert.match(workerSource, /type:\s*"worker:admission"/);
  assert.match(coreSource, /resolveWorkerAdmission\(lease, msg\)/);
  assert.match(workerSource, /rejected Worker command without admission identity/);
  assert.doesNotMatch(workerSource, /agent:deliver:ack/);
});
