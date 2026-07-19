import test from "node:test";
import assert from "node:assert/strict";
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
    broker: { sessionHandle: `handle-${session.id}`, endpoint: "http://127.0.0.1/broker" },
    sink: { async emit(event: RuntimeEventEnvelope) { await sink(event); } },
  };
}

test("session host activates broker per turn, serializes one Agent, and LRU-evicts resident processes", async () => {
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
          assert.equal(options.broker.sessionHandle, `handle-${options.runtimeSessionId}`);
          assert.equal(input.capabilityActivationId, `activation-${input.context}`);
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
  const host = new RuntimeSessionHost(() => runtime, { activeTurnLimit: 4, residentProcessLimit: 1 });
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
  const host = new RuntimeSessionHost(() => runtime);
  await assert.rejects(() => host.runTurn(request(record("session-stale"), "stale")), /stale Worker generation/);
  await host.closeAll();
});

test("session host reopens an idle engine when Core generation or broker handle changes", async () => {
  const opened: Array<{ generation: number; handle: string }> = [];
  let closed = 0;
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
      opened.push({ generation: options.workerGeneration, handle: options.broker.sessionHandle });
      return {
        async runTurn(input) { return { outcome: "completed", engineSessionId: input.turnId }; },
        async cancel() {},
        async snapshot() { return { schemaVersion: 1, payload: {} }; },
        async close() { closed += 1; },
      };
    },
  };
  const host = new RuntimeSessionHost(() => runtime);
  const session = record("session-reconnect");
  await host.runTurn(request(session, "first"));
  const reconnected = request(session, "second");
  reconnected.open.workerGeneration = 4;
  reconnected.broker.sessionHandle = "replacement-handle";
  await host.runTurn(reconnected);
  assert.deepEqual(opened, [
    { generation: 3, handle: "handle-session-reconnect" },
    { generation: 4, handle: "replacement-handle" },
  ]);
  assert.equal(closed, 1);
  await host.closeAll();
});

test("session host cancels an activated turn waiting behind another surface of the same Agent", async () => {
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const started: string[] = [];
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
    async openSession() {
      return {
        async runTurn(input) {
          started.push(input.attemptId);
          if (input.attemptId === "attempt-first") await firstBlocked;
          return { outcome: "completed", engineSessionId: null };
        },
        async cancel() {},
        async snapshot() { return { schemaVersion: 1, payload: {} }; },
        async close() {},
      };
    },
  };
  const host = new RuntimeSessionHost(() => runtime);
  const first = host.runTurn(request(record("session-first"), "first"));
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = host.runTurn(request(record("session-second"), "second"));
  assert.equal(await host.cancelAttempt("attempt-second"), true);
  releaseFirst();
  assert.equal((await second).outcome, "cancelled");
  await first;
  assert.deepEqual(started, ["attempt-first"]);
  assert.equal(host.snapshot().activeTurns, 0);
  await host.closeAll();
});

test("session host truncates preview count once while preserving reserved critical events", async () => {
  const forwarded: RuntimeEventEnvelope[] = [];
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
          for (let ordinal = 0; ordinal < 1_990; ordinal += 1) {
            await sink.emit({
              schemaVersion: 2,
              workerGeneration: options.workerGeneration,
              sessionId: options.runtimeSessionId,
              sessionGeneration: options.sessionGeneration,
              turnId: input.turnId,
              attemptId: input.attemptId,
              eventId: `preview-${ordinal}`,
              ordinal,
              kind: "text_preview",
              payload: { text: "preview" },
              createdAt: Date.now(),
            });
          }
          await sink.emit({
            schemaVersion: 2,
            workerGeneration: options.workerGeneration,
            sessionId: options.runtimeSessionId,
            sessionGeneration: options.sessionGeneration,
            turnId: input.turnId,
            attemptId: input.attemptId,
            eventId: "critical-after-truncation",
            ordinal: 1_990,
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
  const host = new RuntimeSessionHost(() => runtime);
  await host.runTurn(request(record("session-truncation"), "truncation", (event) => { forwarded.push(event); }));
  assert.equal(forwarded.filter((event) => event.kind === "events_truncated").length, 1);
  assert.equal(forwarded.at(-2)?.kind, "events_truncated");
  assert.equal(forwarded.at(-2)?.ordinal, 1_984);
  assert.equal(forwarded.at(-1)?.kind, "turn_completed");
  assert.equal(forwarded.at(-1)?.ordinal, 1_985);
  await host.closeAll();
});
