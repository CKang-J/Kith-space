import test from "node:test";
import assert from "node:assert/strict";
import type { TurnCapabilityClaims } from "../../../capabilities/contracts.js";
import { SessionCapabilityBroker } from "../../../capabilities/sessionCapabilityBroker.js";
import type { RuntimeSessionRecord } from "../../../sessions/sessionModule.js";
import type { RuntimeEventEnvelope, RuntimeV2 } from "../../contract/v2/runtimeContract.js";
import { RuntimeSessionHost } from "./runtimeSessionHost.js";

function record(id: string, agentId = "agent-1", surfaceId = id): RuntimeSessionRecord {
  const date = new Date(1_000);
  return {
    id,
    spaceId: "space-1",
    agentId,
    surfaceKind: "channel",
    surfaceId,
    sessionGeneration: 1,
    runtime: "claude",
    model: null,
    runtimeConfigFingerprint: "fingerprint",
    adapterVersion: "test",
    engineSessionId: null,
    engineHostFingerprint: null,
    workspaceRootFingerprint: "root",
    status: "cold",
    lastTurnId: null,
    lastActiveAt: date,
    lastCompactedAt: null,
    retiredAt: null,
    snapshotVersion: 0,
    snapshot: null,
    snapshotChecksum: null,
    snapshotSavedAt: null,
    createdAt: date,
    updatedAt: date,
  };
}

function claims(session: RuntimeSessionRecord, suffix: string, workerGeneration = 3): TurnCapabilityClaims {
  return {
    schemaVersion: 1,
    activationId: `activation-${suffix}`,
    turnId: `turn-${suffix}`,
    attemptId: `attempt-${suffix}`,
    sessionId: session.id,
    sessionGeneration: session.sessionGeneration,
    workerGeneration,
    spaceId: session.spaceId,
    agentId: session.agentId,
    allowedOutputSurfaceIds: [session.surfaceId],
    allowedInputIds: [],
    seenWatermarks: [],
    scopes: [],
    disclosureGrantIds: [],
    expiresAt: Date.now() + 10_000,
  };
}

function request(session: RuntimeSessionRecord, suffix: string, sink: (event: RuntimeEventEnvelope) => Promise<void> | void = () => {}) {
  return {
    record: session,
    open: {
      workerGeneration: 3,
      address: { spaceId: session.spaceId, agentId: session.agentId, surfaceKind: session.surfaceKind, surfaceId: session.surfaceId },
      cwd: "/tmp/workspace",
      runtimeStateDir: "/tmp/runtime",
      model: undefined,
      runtimeConfig: {},
      engineSessionId: null,
      systemPrompt: { text: "system", version: "1", digest: "digest" },
      mcpBootstrap: { mode: "none" as const, serverName: "kith-core", descriptor: {} },
      env: {},
    },
    turn: {
      turnId: `turn-${suffix}`,
      attemptId: `attempt-${suffix}`,
      context: suffix,
      capabilityActivationId: `activation-${suffix}`,
      deadlineAt: Date.now() + 10_000,
    },
    claims: claims(session, suffix),
    sink: { async emit(event: RuntimeEventEnvelope) { await sink(event); } },
  };
}

test("session host activates broker per turn, serializes one Agent, and LRU-evicts resident processes", async () => {
  const broker = new SessionCapabilityBroker();
  let active = 0;
  let peak = 0;
  const closed: string[] = [];
  const runtime: RuntimeV2 = {
    name: "claude",
    capabilities: {
      resumableSession: true,
      persistentProcess: true,
      mcp: "none",
      hooks: { beforeTool: false, afterTool: false, beforeCompact: false, afterCompact: false, stopFinalize: false },
      usage: "none",
      cancellation: "process",
      context: { modelWindow: "unknown", tokenEstimator: "approximate" },
      cwdRelocatableResume: false,
      toolIsolation: "none",
    },
    async openSession(options) {
      return {
        async runTurn(input, sink) {
          broker.resolve({
            sessionHandle: options.broker.sessionHandle,
            activationId: input.capabilityActivationId,
            workerGeneration: options.workerGeneration,
            sessionId: options.runtimeSessionId,
            turnId: input.turnId,
            attemptId: input.attemptId,
          });
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          await sink.emit({
            schemaVersion: 2,
            workerGeneration: options.workerGeneration,
            sessionId: options.runtimeSessionId,
            sessionGeneration: options.sessionGeneration,
            turnId: input.turnId,
            attemptId: input.attemptId,
            eventId: `event-${input.attemptId}`,
            ordinal: 0,
            kind: "turn_completed",
            payload: {},
            createdAt: Date.now(),
          });
          active -= 1;
          return { outcome: "completed", engineSessionId: `engine-${options.runtimeSessionId}` };
        },
        async cancel() {},
        async snapshot() { return { schemaVersion: 1, payload: {} }; },
        async close() { closed.push(options.runtimeSessionId); },
      };
    },
  };
  const host = new RuntimeSessionHost(() => runtime, broker, { activeTurnLimit: 4, residentProcessLimit: 1 });
  const first = record("session-1", "agent-1", "channel-1");
  const second = record("session-2", "agent-1", "channel-2");

  await Promise.all([host.runTurn(request(first, "one")), host.runTurn(request(first, "two"))]);
  assert.equal(peak, 1);
  assert.equal(host.snapshot().residentProcesses, 1);
  await host.runTurn(request(second, "three"));
  assert.deepEqual(closed, ["session-1"]);
  assert.equal(host.snapshot().residentProcesses, 1);
  await host.closeAll();
  assert.deepEqual(closed, ["session-1", "session-2"]);
});

test("session host rejects a late event from an older Worker generation", async () => {
  const broker = new SessionCapabilityBroker();
  const runtime: RuntimeV2 = {
    name: "claude",
    capabilities: {
      resumableSession: true,
      persistentProcess: false,
      mcp: "none",
      hooks: { beforeTool: false, afterTool: false, beforeCompact: false, afterCompact: false, stopFinalize: false },
      usage: "none",
      cancellation: "process",
      context: { modelWindow: "unknown", tokenEstimator: "approximate" },
      cwdRelocatableResume: false,
      toolIsolation: "none",
    },
    async openSession(options) {
      return {
        async runTurn(input, sink) {
          await sink.emit({
            schemaVersion: 2,
            workerGeneration: options.workerGeneration - 1,
            sessionId: options.runtimeSessionId,
            sessionGeneration: options.sessionGeneration,
            turnId: input.turnId,
            attemptId: input.attemptId,
            eventId: "late-event",
            ordinal: 0,
            kind: "turn_completed",
            payload: {},
            createdAt: Date.now(),
          });
          return { outcome: "completed", engineSessionId: null };
        },
        async cancel() {},
        async snapshot() { return { schemaVersion: 1, payload: {} }; },
        async close() {},
      };
    },
  };
  const host = new RuntimeSessionHost(() => runtime, broker);
  await assert.rejects(() => host.runTurn(request(record("session-stale"), "stale")), /stale Worker generation/);
  await host.closeAll();
});
