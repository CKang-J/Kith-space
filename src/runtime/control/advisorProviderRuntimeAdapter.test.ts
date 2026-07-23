import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { WebSocket } from "ws";
import { registerWorker, resolveWorkerRequest, unregisterWorker, type WorkerLease } from "../../local-runtime/workerHub.js";
import type { CompiledAdvisorModelConfig, ProviderExecutionSnapshot } from "../../advisor-provider/contracts.js";
import { WorkerAdvisorProviderRuntimePort } from "./advisorProviderRuntimeAdapter.js";

test("advisor prepare round-trip is request-correlated and Worker-generation bound", async () => {
  let lease!: WorkerLease;
  const socket = { readyState: 1, close() {}, send(raw: string) {
    const request = JSON.parse(raw);
    queueMicrotask(() => resolveWorkerRequest(request.requestId, {
      type: "advisor:result", requestId: request.requestId, ok: true, localHandle: randomUUID(),
      workerGeneration: lease.generation, preflight: { canonicalOrigin: "https://api.anthropic.com", proxy: "none",
        networkClass: "public_cloud", resolvedAddressDigest: "a".repeat(64), redirectPolicy: "reject",
        allEgress: ["https://api.anthropic.com"] },
    }, lease));
  } } as unknown as WebSocket;
  lease = registerWorker(socket);
  const config = { backendId: "anthropic", modelId: "claude", apiKind: "anthropic-messages", thinkingLevel: "off",
    canonicalOrigin: "https://api.anthropic.com", networkClass: "public_cloud", allowedEgress: ["https://api.anthropic.com"],
    credentialSlot: "kith_secret", providerFactoryId: "anthropic", providerSchemaVersion: 1, options: {} } as CompiledAdvisorModelConfig;
  const snapshot = { adapterId: "pi_sdk", executionSnapshotDigest: "snapshot" } as ProviderExecutionSnapshot;
  try {
    const prepared = await new WorkerAdvisorProviderRuntimePort().prepare(snapshot, config);
    assert.equal(prepared.workerGeneration, lease.generation);
    assert.equal(prepared.preflight.redirectPolicy, "reject");
  } finally { unregisterWorker(lease); }
});

test("advisor completion sends only a one-shot credential handle on the generic Core-to-Worker command", async () => {
  let lease!: WorkerLease;
  const sent: any[] = [];
  const socket = { readyState: 1, close() {}, send(raw: string) {
    const request = JSON.parse(raw);
    sent.push(request);
    queueMicrotask(() => resolveWorkerRequest(request.requestId, request.type === "advisor:prepare" ? {
      type: "advisor:result", requestId: request.requestId, ok: true, localHandle: randomUUID(),
      workerGeneration: lease.generation, preflight: { canonicalOrigin: "https://api.anthropic.com", proxy: "none",
        networkClass: "public_cloud", resolvedAddressDigest: "a".repeat(64), redirectPolicy: "reject",
        allEgress: ["https://api.anthropic.com"] },
    } : {
      type: "advisor:result", requestId: request.requestId, ok: true,
      output: { schemaVersion: 1, candidates: [] },
      postflight: { canonicalOrigin: "https://api.anthropic.com", proxy: "none", networkClass: "public_cloud",
        resolvedAddressDigest: "a".repeat(64), redirectPolicy: "reject", allEgress: ["https://api.anthropic.com"] },
    }, lease));
  } } as unknown as WebSocket;
  lease = registerWorker(socket);
  const runtime = new WorkerAdvisorProviderRuntimePort();
  const config = { backendId: "anthropic", modelId: "claude", apiKind: "anthropic-messages", thinkingLevel: "off",
    canonicalOrigin: "https://api.anthropic.com", networkClass: "public_cloud", allowedEgress: ["https://api.anthropic.com"],
    credentialSlot: "kith_secret", providerFactoryId: "anthropic", providerSchemaVersion: 1, options: {} } as CompiledAdvisorModelConfig;
  const snapshot = { adapterId: "pi_sdk", providerEpoch: 4, executionSnapshotDigest: "snapshot" } as ProviderExecutionSnapshot;
  try {
    const prepared = await runtime.prepare(snapshot, config);
    await runtime.complete(prepared, "safe prompt", "activation-handle");
    const complete = sent.find((item) => item.type === "advisor:complete");
    assert.equal(complete.credentialHandle, "activation-handle");
    assert.equal(complete.providerEpoch, 4);
    assert.equal(Object.prototype.hasOwnProperty.call(complete, "credential"), false);
    assert.doesNotMatch(JSON.stringify(complete), /api[_-]?key|secret-value/i);
  } finally { unregisterWorker(lease); }
});
