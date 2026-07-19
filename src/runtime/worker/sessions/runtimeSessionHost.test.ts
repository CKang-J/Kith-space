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
    checklistRevision: 0,
    compactionRevision: 0,
    contextCompactionRevision: 0,
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

test("session host restores the validated adapter snapshot and returns monotonic immediate/fallback snapshots", async () => {
  const restored = {
    schemaVersion: 1 as const,
    sessionGeneration: 1,
    engineSessionId: "engine-restored",
    checklistRevision: 2,
    adapterSnapshot: { schemaVersion: 1, payload: { runtime: "claude", resumable: true } },
    savedAt: 900,
  };
  let openedWith: unknown;
  const runtime: RuntimeV2 = {
    name: "claude",
    capabilities: {
      resumableSession: true, persistentProcess: true, mcp: "none",
      hooks: { beforeTool: false, afterTool: false, beforeCompact: false, afterCompact: false, stopFinalize: false },
      usage: "none", cancellation: "process",
      context: { modelWindow: "unknown", tokenEstimator: "approximate" },
      cwdRelocatableResume: false, toolIsolation: "none",
    },
    async openSession(options) {
      openedWith = options.restoredSnapshot;
      return {
        async runTurn() { return { outcome: "completed", engineSessionId: "engine-next" }; },
        async cancel() {},
        async snapshot() { return { schemaVersion: 1, payload: { runtime: "claude", resumable: true } }; },
        async close() {},
      };
    },
  };
  const session = record("session-snapshot") as RuntimeSessionRecord & { restoredSnapshot?: typeof restored };
  session.snapshotVersion = 5;
  session.restoredSnapshot = restored;
  const host = new RuntimeSessionHost(() => runtime, { now: () => 1_000 });
  const result = await host.runTurn(request(session, "snapshot"));
  assert.deepEqual(openedWith, restored);
  assert.equal(result.sessionSnapshot?.snapshotVersion, 6);
  assert.equal(result.sessionSnapshot?.spaceId, session.spaceId);
  const fallback = await host.snapshotAll();
  assert.equal(fallback[0]?.snapshotVersion, 7);
  await host.closeAll();
});

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
  const host = new RuntimeSessionHost(() => runtime, { previewCoalesceMs: 0 });
  await host.runTurn(request(record("session-truncation"), "truncation", (event) => { forwarded.push(event); }));
  assert.equal(forwarded.filter((event) => event.kind === "events_truncated").length, 1);
  assert.equal(forwarded.at(-2)?.kind, "events_truncated");
  assert.equal(forwarded.at(-2)?.ordinal, 1_984);
  assert.equal(forwarded.at(-1)?.kind, "turn_completed");
  assert.equal(forwarded.at(-1)?.ordinal, 1_985);
  await host.closeAll();
});

test("session host coalesces each preview kind without delaying adapter emit and flushes before critical events", async () => {
  const forwarded: RuntimeEventEnvelope[] = [];
  const runtime: RuntimeV2 = {
    name: "claude",
    capabilities: {
      resumableSession: true, persistentProcess: false, mcp: "none",
      hooks: { beforeTool: false, afterTool: false, beforeCompact: false, afterCompact: false, stopFinalize: false },
      usage: "none", cancellation: "process", context: { modelWindow: "unknown", tokenEstimator: "approximate" },
      cwdRelocatableResume: false, toolIsolation: "none",
    },
    async openSession(options) {
      return {
        async runTurn(input, sink) {
          let ordinal = 0;
          for (let index = 0; index < 10; index += 1) {
            for (const kind of ["text_preview", "thinking_summary", "activity"] as const) {
              await sink.emit({
                schemaVersion: 2, workerGeneration: options.workerGeneration, sessionId: options.runtimeSessionId,
                sessionGeneration: options.sessionGeneration, turnId: input.turnId, attemptId: input.attemptId,
                eventId: `${kind}-${index}`, ordinal: ordinal++, kind, payload: { text: `${kind}-${index}` }, createdAt: Date.now(),
              });
            }
          }
          assert.equal(forwarded.length, 0, "preview emit must not await the open 250ms window or its downstream sink");
          await sink.emit({
            schemaVersion: 2, workerGeneration: options.workerGeneration, sessionId: options.runtimeSessionId,
            sessionGeneration: options.sessionGeneration, turnId: input.turnId, attemptId: input.attemptId,
            eventId: "critical-tool", ordinal: ordinal++, kind: "tool_started", payload: { toolName: "check" }, createdAt: Date.now(),
          });
          await sink.emit({
            schemaVersion: 2, workerGeneration: options.workerGeneration, sessionId: options.runtimeSessionId,
            sessionGeneration: options.sessionGeneration, turnId: input.turnId, attemptId: input.attemptId,
            eventId: "terminal", ordinal, kind: "turn_completed", payload: {}, createdAt: Date.now(),
          });
          return { outcome: "completed", engineSessionId: null };
        },
        async cancel() {}, async snapshot() { return { schemaVersion: 1, payload: {} }; }, async close() {},
      };
    },
  };
  const host = new RuntimeSessionHost(() => runtime, { previewCoalesceMs: 250 });
  await host.runTurn(request(record("session-coalesced"), "coalesced", (event) => { forwarded.push(event); }));
  assert.deepEqual(forwarded.map((event) => event.kind), ["text_preview", "thinking_summary", "activity", "tool_started", "turn_completed"]);
  assert.deepEqual(forwarded.slice(0, 3).map((event) => event.payload.text), ["text_preview-9", "thinking_summary-9", "activity-9"]);
  assert.deepEqual(forwarded.map((event) => event.ordinal), [0, 1, 2, 3, 4]);
  assert.equal(forwarded.at(-1)?.eventId, "terminal");
  await host.closeAll();
});

test("session host emits at most one preview per kind in each short window and flushes return/failure boundaries", async () => {
  const forwarded: RuntimeEventEnvelope[] = [];
  const makeRuntime = (fail: boolean): RuntimeV2 => ({
    name: "claude",
    capabilities: {
      resumableSession: true, persistentProcess: false, mcp: "none",
      hooks: { beforeTool: false, afterTool: false, beforeCompact: false, afterCompact: false, stopFinalize: false },
      usage: "none", cancellation: "process", context: { modelWindow: "unknown", tokenEstimator: "approximate" },
      cwdRelocatableResume: false, toolIsolation: "none",
    },
    async openSession(options) {
      return {
        async runTurn(input, sink) {
          const emit = (ordinal: number, text: string) => sink.emit({
            schemaVersion: 2, workerGeneration: options.workerGeneration, sessionId: options.runtimeSessionId,
            sessionGeneration: options.sessionGeneration, turnId: input.turnId, attemptId: input.attemptId,
            eventId: text, ordinal, kind: "text_preview", payload: { text }, createdAt: Date.now(),
          });
          await emit(0, "window-one-a");
          await emit(1, "window-one-b");
          await new Promise((resolve) => setTimeout(resolve, 35));
          await emit(2, fail ? "failure-boundary" : "window-two-a");
          if (fail) throw new Error("adapter failed");
          return { outcome: "completed", engineSessionId: null };
        },
        async cancel() {}, async snapshot() { return { schemaVersion: 1, payload: {} }; }, async close() {},
      };
    },
  });
  const successHost = new RuntimeSessionHost(() => makeRuntime(false), { previewCoalesceMs: 20 });
  await successHost.runTurn(request(record("session-windows"), "windows", (event) => { forwarded.push(event); }));
  assert.deepEqual(forwarded.map((event) => event.payload.text), ["window-one-b", "window-two-a"]);
  assert.deepEqual(forwarded.map((event) => event.ordinal), [0, 1]);
  await successHost.closeAll();

  const failureForwarded: RuntimeEventEnvelope[] = [];
  const failureHost = new RuntimeSessionHost(() => makeRuntime(true), { previewCoalesceMs: 20 });
  await assert.rejects(() => failureHost.runTurn(request(record("session-failure-flush"), "failure-flush", (event) => { failureForwarded.push(event); })), /adapter failed/);
  assert.equal(failureForwarded.at(-1)?.payload.text, "failure-boundary");
  await failureHost.closeAll();
});

test("session host propagates an asynchronous preview flush failure through the turn", async () => {
  const runtime: RuntimeV2 = {
    name: "claude",
    capabilities: {
      resumableSession: true, persistentProcess: false, mcp: "none",
      hooks: { beforeTool: false, afterTool: false, beforeCompact: false, afterCompact: false, stopFinalize: false },
      usage: "none", cancellation: "process", context: { modelWindow: "unknown", tokenEstimator: "approximate" },
      cwdRelocatableResume: false, toolIsolation: "none",
    },
    async openSession(options) {
      return {
        async runTurn(input, sink) {
          await sink.emit({
            schemaVersion: 2, workerGeneration: options.workerGeneration, sessionId: options.runtimeSessionId,
            sessionGeneration: options.sessionGeneration, turnId: input.turnId, attemptId: input.attemptId,
            eventId: "preview-error", ordinal: 0, kind: "text_preview", payload: { text: "flush me" }, createdAt: Date.now(),
          });
          return { outcome: "completed", engineSessionId: null };
        },
        async cancel() {}, async snapshot() { return { schemaVersion: 1, payload: {} }; }, async close() {},
      };
    },
  };
  const host = new RuntimeSessionHost(() => runtime, { previewCoalesceMs: 10 });
  await assert.rejects(() => host.runTurn(request(record("session-preview-error"), "preview-error", () => { throw new Error("preview sink failed"); })), /preview sink failed/);
  await host.closeAll();
});

test("session host flushes buffered previews before adapter cancel and close", async () => {
  const exercise = async (boundary: "cancel" | "close") => {
    const forwarded: RuntimeEventEnvelope[] = [];
    let entered!: () => void;
    let release!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    const runtime: RuntimeV2 = {
      name: "claude",
      capabilities: {
        resumableSession: true, persistentProcess: true, mcp: "none",
        hooks: { beforeTool: false, afterTool: false, beforeCompact: false, afterCompact: false, stopFinalize: false },
        usage: "none", cancellation: "process", context: { modelWindow: "unknown", tokenEstimator: "approximate" },
        cwdRelocatableResume: false, toolIsolation: "none",
      },
      async openSession(options) {
        return {
          async runTurn(input, sink) {
            await sink.emit({
              schemaVersion: 2, workerGeneration: options.workerGeneration, sessionId: options.runtimeSessionId,
              sessionGeneration: options.sessionGeneration, turnId: input.turnId, attemptId: input.attemptId,
              eventId: `${boundary}-preview`, ordinal: 0, kind: "text_preview", payload: { text: boundary }, createdAt: Date.now(),
            });
            entered();
            await releasePromise;
            return { outcome: "cancelled", engineSessionId: null };
          },
          async cancel() {
            assert.equal(forwarded.at(-1)?.payload.text, "cancel", "cancel must observe the flushed preview");
            release();
          },
          async snapshot() { return { schemaVersion: 1, payload: {} }; },
          async close() {
            if (boundary === "close") assert.equal(forwarded.at(-1)?.payload.text, "close", "close must observe the flushed preview");
            release();
          },
        };
      },
    };
    const host = new RuntimeSessionHost(() => runtime, { previewCoalesceMs: 1_000 });
    const running = host.runTurn(request(record(`session-${boundary}-flush`), `${boundary}-flush`, (event) => { forwarded.push(event); }));
    await enteredPromise;
    if (boundary === "cancel") {
      assert.equal(await host.cancelAttempt(`attempt-${boundary}-flush`), true);
      await running;
      await host.closeAll();
    } else {
      await host.closeAll();
      await running;
    }
    assert.deepEqual(forwarded.map((event) => event.ordinal), [0]);
  };
  await exercise("cancel");
  await exercise("close");
});
