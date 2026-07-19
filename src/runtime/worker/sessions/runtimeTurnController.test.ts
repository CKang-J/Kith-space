import test from "node:test";
import assert from "node:assert/strict";
import type { RuntimeEventEnvelope } from "../../contract/v2/runtimeContract.js";
import type { WorkerAdmissionCommand } from "../../contract/runtimeWorkerPort.js";
import { RuntimeTurnController } from "./runtimeTurnController.js";

function command(): Extract<WorkerAdmissionCommand, { type: "agent:turn:admit" }> {
  return {
    type: "agent:turn:admit",
    source: "turn",
    generation: 7,
    commandId: "attempt-1",
    spaceId: "space-1",
    agentId: "agent-1",
    config: { agentId: "agent-1", spaceId: "space-1", workspaceRoot: "/tmp", name: "agent", displayName: "Agent", serverUrl: "http://127.0.0.1" },
    session: {
      id: "session-1",
      spaceId: "space-1",
      agentId: "agent-1",
      surfaceKind: "channel",
      surfaceId: "channel-1",
      sessionGeneration: 1,
      runtime: "claude",
      engineSessionId: null,
    },
    broker: { sessionHandle: "handle-1", endpoint: "http://127.0.0.1" },
    turn: {
      turnId: "turn-1",
      attemptId: "attempt-1",
      context: "context",
      capabilityActivationId: "activation-1",
      deadlineAt: Date.now() + 10_000,
    },
  };
}

test("turn controller separates admission from activation and waits for Core event/terminal acknowledgements", async () => {
  const sent: any[] = [];
  let controller!: RuntimeTurnController;
  let closeCount = 0;
  const host = {
    async runTurn(request: any) {
      const event: RuntimeEventEnvelope = {
        schemaVersion: 2,
        workerGeneration: 7,
        sessionId: "session-1",
        sessionGeneration: 1,
        turnId: "turn-1",
        attemptId: "attempt-1",
        eventId: "event-1",
        ordinal: 0,
        kind: "turn_started",
        payload: {},
        createdAt: Date.now(),
      };
      await request.sink.emit(event);
      return { outcome: "completed" as const, engineSessionId: "engine-1" };
    },
    async cancelAttempt() { return true; },
    async closeAll() { closeCount += 1; },
  };
  controller = new RuntimeTurnController(host as any, {
    ackTimeoutMs: 1_000,
    prepare: async () => ({
      workerGeneration: 7,
      address: { spaceId: "space-1", agentId: "agent-1", surfaceKind: "channel", surfaceId: "channel-1" },
      cwd: "/tmp",
      runtimeStateDir: "/tmp",
      systemPrompt: { text: "system", version: "1", digest: "digest" },
      mcpBootstrap: { mode: "none", serverName: "kith-core", descriptor: {} },
      env: {},
    }),
    send(message) {
      sent.push(message);
      queueMicrotask(() => {
        if ((message as any).type === "agent:turn:event") controller.acknowledgeEvent({ eventId: (message as any).event.eventId, ok: true });
        if ((message as any).type === "agent:turn:terminal") controller.acknowledgeTerminal({ attemptId: (message as any).attemptId, ok: true });
      });
      return true;
    },
  });

  const admitted = command();
  assert.equal(controller.admit(admitted).status, "admitted");
  assert.equal(controller.admit(admitted).status, "admitted");
  assert.equal(controller.activate({ type: "agent:turn:activate", generation: 7, attemptId: "attempt-1", activationId: "wrong" }), false);
  assert.equal(controller.activate({ type: "agent:turn:activate", generation: 7, attemptId: "attempt-1", activationId: "activation-1" }), true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(sent.map((message) => message.type), ["agent:turn:event", "agent:turn:terminal"]);
  await controller.shutdown();
  assert.equal(closeCount, 1);
});

test("turn controller rejects stable identity reuse and can cancel before activation", async () => {
  const controller = new RuntimeTurnController({
    async runTurn() { throw new Error("must not run"); },
    async cancelAttempt() { return false; },
    async closeAll() {},
  } as any, { send: () => true });
  const original = command();
  assert.equal(controller.admit(original).status, "admitted");
  assert.equal(controller.admit({ ...original, turn: { ...original.turn, context: "different" } }).status, "rejected");
  assert.equal(await controller.cancel({ type: "agent:turn:cancel", generation: 7, attemptId: "attempt-1" }), true);
  assert.equal(controller.activate({ type: "agent:turn:activate", generation: 7, attemptId: "attempt-1", activationId: "activation-1" }), false);
  await controller.shutdown();
});

test("turn controller expires uncertain admissions and bounds activated plus admitted work", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const host = {
    async runTurn() { await blocked; return { outcome: "completed" as const, engineSessionId: null }; },
    async cancelAttempt() { return false; },
    async closeAll() {},
  };
  const controller = new RuntimeTurnController(host as any, {
    maxAdmitted: 2,
    admissionTtlMs: 5,
    ackTimeoutMs: 20,
    terminalRetryMs: 1,
    prepare: async () => ({
      workerGeneration: 7,
      address: { spaceId: "space-1", agentId: "agent-1", surfaceKind: "channel", surfaceId: "channel-1" },
      cwd: "/tmp", runtimeStateDir: "/tmp", systemPrompt: { text: "", version: "1", digest: "d" },
      mcpBootstrap: { mode: "none", serverName: "kith-core", descriptor: {} }, env: {},
    }),
    send: () => true,
  });
  const first = command();
  assert.equal(controller.admit(first).status, "admitted");
  assert.equal(controller.activate({ type: "agent:turn:activate", generation: 7, attemptId: "attempt-1", activationId: "activation-1" }), true);
  const second = { ...command(), commandId: "attempt-2", turn: { ...command().turn, turnId: "turn-2", attemptId: "attempt-2", capabilityActivationId: "activation-2" } };
  const third = { ...command(), commandId: "attempt-3", turn: { ...command().turn, turnId: "turn-3", attemptId: "attempt-3", capabilityActivationId: "activation-3" } };
  assert.equal(controller.admit(second).status, "admitted");
  assert.equal(controller.admit(third).status, "rejected");
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(controller.activate({ type: "agent:turn:activate", generation: 7, attemptId: "attempt-2", activationId: "activation-2" }), false);
  assert.equal(controller.admit(second).status, "rejected");
  await controller.cancel({ type: "agent:turn:cancel", generation: 7, attemptId: "attempt-1" });
  release();
  await controller.shutdown();
});

test("turn controller retains and retries terminal state until Core acknowledges", async () => {
  let terminalSends = 0;
  let controller!: RuntimeTurnController;
  const host = {
    async runTurn() { return { outcome: "completed" as const, engineSessionId: "engine" }; },
    async cancelAttempt() { return false; },
    async closeAll() {},
  };
  controller = new RuntimeTurnController(host as any, {
    ackTimeoutMs: 10,
    terminalRetryMs: 1,
    prepare: async () => ({
      workerGeneration: 7,
      address: { spaceId: "space-1", agentId: "agent-1", surfaceKind: "channel", surfaceId: "channel-1" },
      cwd: "/tmp", runtimeStateDir: "/tmp", systemPrompt: { text: "", version: "1", digest: "d" },
      mcpBootstrap: { mode: "none", serverName: "kith-core", descriptor: {} }, env: {},
    }),
    send(message) {
      if ((message as any).type !== "agent:turn:terminal") return true;
      terminalSends += 1;
      if (terminalSends === 1) return false;
      queueMicrotask(() => controller.acknowledgeTerminal({ attemptId: "attempt-1", ok: true }));
      return true;
    },
  });
  assert.equal(controller.admit(command()).status, "admitted");
  assert.equal(controller.activate({ type: "agent:turn:activate", generation: 7, attemptId: "attempt-1", activationId: "activation-1" }), true);
  for (let index = 0; index < 50 && terminalSends < 2; index += 1) await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal(terminalSends, 2);
  await controller.shutdown();
});

test("a newer Core generation releases an unacknowledged stale terminal and its queue slot", async () => {
  let terminalSends = 0;
  const controller = new RuntimeTurnController({
    async runTurn() { return { outcome: "completed" as const, engineSessionId: "engine" }; },
    async cancelAttempt() { return false; },
    async closeAll() {},
  } as any, {
    maxAdmitted: 1,
    ackTimeoutMs: 5,
    terminalRetryMs: 1,
    prepare: async () => ({
      workerGeneration: 7,
      address: { spaceId: "space-1", agentId: "agent-1", surfaceKind: "channel", surfaceId: "channel-1" },
      cwd: "/tmp", runtimeStateDir: "/tmp", systemPrompt: { text: "", version: "1", digest: "d" },
      mcpBootstrap: { mode: "none", serverName: "kith-core", descriptor: {} }, env: {},
    }),
    send(message) {
      if ((message as any).type === "agent:turn:terminal") terminalSends += 1;
      return false;
    },
  });
  assert.equal(controller.admit(command()).status, "admitted");
  assert.equal(controller.activate({ type: "agent:turn:activate", generation: 7, attemptId: "attempt-1", activationId: "activation-1" }), true);
  for (let index = 0; index < 50 && terminalSends < 1; index += 1) await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal(terminalSends >= 1, true);
  await controller.advanceGeneration(8);
  const sendsAfterAdvance = terminalSends;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(terminalSends, sendsAfterAdvance);
  const next = {
    ...command(),
    generation: 8,
    commandId: "attempt-2",
    turn: { ...command().turn, turnId: "turn-2", attemptId: "attempt-2", capabilityActivationId: "activation-2" },
  };
  assert.equal(controller.admit(next).status, "admitted");
  await controller.cancel({ type: "agent:turn:cancel", generation: 8, attemptId: "attempt-2" });
  await controller.shutdown();
});

test("turn cancellation during runtime preparation never reaches the session host", async () => {
  let releasePrepare!: () => void;
  const preparing = new Promise<void>((resolve) => { releasePrepare = resolve; });
  let runs = 0;
  const controller = new RuntimeTurnController({
    async runTurn() { runs += 1; return { outcome: "completed" as const, engineSessionId: null }; },
    async cancelAttempt() { return false; },
    async closeAll() {},
  } as any, {
    prepare: async () => {
      await preparing;
      return {
        workerGeneration: 7,
        address: { spaceId: "space-1", agentId: "agent-1", surfaceKind: "channel" as const, surfaceId: "channel-1" },
        cwd: "/tmp", runtimeStateDir: "/tmp", systemPrompt: { text: "", version: "1", digest: "d" },
        mcpBootstrap: { mode: "none" as const, serverName: "kith-core", descriptor: {} }, env: {},
      };
    },
    send: () => true,
  });
  assert.equal(controller.admit(command()).status, "admitted");
  assert.equal(controller.activate({ type: "agent:turn:activate", generation: 7, attemptId: "attempt-1", activationId: "activation-1" }), true);
  assert.equal(await controller.cancel({ type: "agent:turn:cancel", generation: 7, attemptId: "attempt-1" }), true);
  releasePrepare();
  await controller.shutdown();
  assert.equal(runs, 0);
});

test("shutdown cancels deferred preparation and has a bounded wait for an unabortable prepare", async () => {
  let releasePrepare!: () => void;
  const preparing = new Promise<void>((resolve) => { releasePrepare = resolve; });
  let runs = 0;
  const controller = new RuntimeTurnController({
    async runTurn() { runs += 1; return { outcome: "completed" as const, engineSessionId: null }; },
    async cancelAttempt() { return false; },
    async closeAll() {},
  } as any, {
    shutdownTimeoutMs: 20,
    prepare: async () => {
      await preparing;
      return {
        workerGeneration: 7,
        address: { spaceId: "space-1", agentId: "agent-1", surfaceKind: "channel" as const, surfaceId: "channel-1" },
        cwd: "/tmp", runtimeStateDir: "/tmp", systemPrompt: { text: "", version: "1", digest: "d" },
        mcpBootstrap: { mode: "none" as const, serverName: "kith-core", descriptor: {} }, env: {},
      };
    },
    send: () => true,
  });
  assert.equal(controller.admit(command()).status, "admitted");
  assert.equal(controller.activate({ type: "agent:turn:activate", generation: 7, attemptId: "attempt-1", activationId: "activation-1" }), true);
  const startedAt = Date.now();
  await controller.shutdown();
  assert.equal(Date.now() - startedAt < 200, true);
  releasePrepare();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runs, 0);
});
