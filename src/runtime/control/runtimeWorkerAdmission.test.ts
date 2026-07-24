import assert from "node:assert/strict";
import test from "node:test";
import type { WebSocket } from "ws";
import {
  WorkerAdmissionUncertainError,
  registerWorker,
  requestWorkerAdmission,
  resolveWorkerAdmission,
  unregisterWorker,
} from "../../local-runtime/workerHub.js";

function workerSocket(onSend: (message: Record<string, unknown>) => void): WebSocket {
  return {
    readyState: 1,
    send(payload: string) { onSend(JSON.parse(payload) as Record<string, unknown>); },
    close() { /* controlled by the test */ },
  } as unknown as WebSocket;
}

test("Core commits only a matching current-generation admission and ignores duplicate/stale ack", async () => {
  const commands: Record<string, unknown>[] = [];
  const first = registerWorker(workerSocket((message) => commands.push(message)));
  const pending = requestWorkerAdmission({
    type: "agent:deliver",
    source: "wake",
    deliveryId: "wake-1",
    spaceId: "space-1",
    agentId: "agent-1",
    seq: 1,
    from: "human",
    target: "channel-1",
    targetName: "#general",
    msgShort: "wake-1",
    isTask: false,
    mentioned: true,
    responseDirective: "required",
    responseReason: "test",
  });
  assert.equal(commands[0]?.generation, first.generation);

  const replacement = registerWorker(workerSocket(() => {}));
  await assert.rejects(pending, WorkerAdmissionUncertainError);
  assert.equal(resolveWorkerAdmission(first, {
    type: "worker:admission",
    generation: first.generation,
    deliveryId: "wake-1",
    status: "admitted",
  }), false, "a stale generation cannot settle the reservation");

  const replay = requestWorkerAdmission({
    type: "agent:deliver",
    source: "wake",
    deliveryId: "wake-1",
    spaceId: "space-1",
    agentId: "agent-1",
    seq: 1,
    from: "human",
    target: "channel-1",
    targetName: "#general",
    msgShort: "wake-1",
    isTask: false,
    mentioned: true,
    responseDirective: "required",
    responseReason: "test",
  });
  const ack = {
    type: "worker:admission",
    generation: replacement.generation,
    deliveryId: "wake-1",
    status: "queued",
  } as const;
  assert.equal(resolveWorkerAdmission(replacement, ack), true);
  assert.equal(resolveWorkerAdmission(replacement, ack), true, "duplicate ack is idempotent");
  assert.deepEqual(await replay, {
    status: "queued",
    id: "wake-1",
    generation: replacement.generation,
  });
  unregisterWorker(replacement);
});

test("manual lifecycle commands use commandId rather than a wake deliveryId", async () => {
  let lease: ReturnType<typeof registerWorker>;
  const commands: Record<string, unknown>[] = [];
  lease = registerWorker(workerSocket((message) => {
    commands.push(message);
    queueMicrotask(() => resolveWorkerAdmission(lease, {
      type: "worker:admission",
      generation: lease.generation,
      commandId: message.commandId,
      status: "admitted",
    }));
  }));
  try {
    const result = await requestWorkerAdmission({
      type: "agent:stop",
      source: "lifecycle",
      commandId: "stop-1",
      spaceId: "space-1",
      agentId: "agent-1",
    });
    assert.equal(result.id, "stop-1");
    assert.equal(commands[0]?.deliveryId, undefined);
  } finally {
    unregisterWorker(lease);
  }
});
