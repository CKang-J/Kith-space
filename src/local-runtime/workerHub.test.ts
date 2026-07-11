import assert from "node:assert/strict";
import { test } from "node:test";
import type { WebSocket } from "ws";
import { WORKER_REPLACED_CODE } from "../daemonProtocol.js";
import {
  isWorkerConnected,
  isWorkerLeaseCurrent,
  isWorkerLeaseLatest,
  registerWorker,
  requestWorker,
  resolveWorkerRequest,
  sendToWorker,
  sendToWorkerForLease,
  unregisterWorker,
  updateWorkerSnapshot,
  workerRunningAgents,
  workerRuntimes,
} from "./workerHub.js";

function fakeWorker() {
  const sent: string[] = [];
  let closed = false;
  let closeCode: number | undefined;
  const worker = {
    readyState: 1,
    send(data: string) { sent.push(data); },
    close(code?: number) { closed = true; closeCode = code; },
  } as unknown as WebSocket;
  return { worker, sent, isClosed: () => closed, closeCode: () => closeCode };
}

test("new worker replaces the old connection and stale close cannot remove it", () => {
  const first = fakeWorker();
  const second = fakeWorker();
  const firstLease = registerWorker(first.worker);
  updateWorkerSnapshot(firstLease, { runtimes: ["codex"], runningAgents: ["a1"] });

  const secondLease = registerWorker(second.worker);
  assert.equal(first.isClosed(), true);
  assert.equal(first.closeCode(), WORKER_REPLACED_CODE);
  assert.equal(isWorkerLeaseCurrent(firstLease), false);
  assert.equal(isWorkerLeaseLatest(firstLease), false);
  assert.equal(isWorkerLeaseCurrent(secondLease), true);
  assert.equal(unregisterWorker(firstLease), false);
  assert.equal(isWorkerConnected(), true);
  assert.deepEqual(workerRuntimes(), []);
  assert.deepEqual(workerRunningAgents(), []);
  assert.equal(sendToWorkerForLease(firstLease, { type: "stale" }), false);

  assert.equal(unregisterWorker(secondLease), true);
  assert.equal(isWorkerLeaseLatest(secondLease), true);
  assert.equal(isWorkerConnected(), false);
});

test("send, request correlation, and ready snapshot share the current worker", async () => {
  const { worker, sent } = fakeWorker();
  const lease = registerWorker(worker);
  updateWorkerSnapshot(lease, { runtimes: ["claude", "codex"], runningAgents: ["a1", "a2"] });
  assert.deepEqual(workerRuntimes(), ["claude", "codex"]);
  assert.deepEqual(workerRunningAgents(), ["a1", "a2"]);

  assert.equal(sendToWorker({ type: "agent:stop", agentId: "a1" }), true);
  assert.deepEqual(JSON.parse(sent[0]!), { type: "agent:stop", agentId: "a1" });

  const response = requestWorker({ type: "probe-models", runtime: "codex" });
  const request = JSON.parse(sent[1]!);
  assert.equal(typeof request.requestId, "string");
  resolveWorkerRequest(request.requestId, { type: "models", models: ["gpt"] });
  assert.deepEqual(await response, { type: "models", models: ["gpt"] });

  unregisterWorker(lease);
  assert.equal(sendToWorker({ type: "ping" }), false);
});
