import test from "node:test";
import assert from "node:assert/strict";
import type { Runtime } from "../../daemon/runtime.js";
import type { RuntimeEventEnvelope } from "../contract/v2/runtimeContract.js";
import { bridgeRuntimeV2 } from "./runtimeV2Bridge.js";

function openOptions() {
  return {
    runtimeSessionId: "runtime-session-1",
    sessionGeneration: 1,
    workerGeneration: 9,
    address: { spaceId: "space-1", agentId: "agent-1", surfaceKind: "channel" as const, surfaceId: "channel-1" },
    cwd: "/tmp/workspace",
    runtimeStateDir: "/tmp/runtime-state",
    engineSessionId: null,
    systemPrompt: { text: "system", version: "1", digest: "digest" },
    mcpBootstrap: { mode: "none" as const, serverName: "kith-core", descriptor: {} },
    env: {},
    broker: { sessionHandle: "handle", endpoint: "broker" },
  };
}

test("v2 bridge keeps a persistent process across turns and awaits critical event acknowledgement", async () => {
  let starts = 0;
  let delivers = 0;
  const runtime: Runtime = {
    name: "claude",
    start(_options, callbacks) {
      starts += 1;
      const complete = () => queueMicrotask(() => {
        callbacks.onSession("engine-session-1");
        callbacks.onActivity("thinking", "test");
        callbacks.onTrajectory([{ kind: "text", text: "preview" }]);
        callbacks.onActivity("online");
      });
      complete();
      return {
        deliver() { delivers += 1; complete(); },
        stop() {},
      };
    },
  };
  const session = await bridgeRuntimeV2(runtime).openSession(openOptions());
  const events: RuntimeEventEnvelope[] = [];
  const sink = {
    async emit(event: RuntimeEventEnvelope) {
      if (event.kind === "session_changed") await new Promise((resolve) => setTimeout(resolve, 5));
      events.push(event);
    },
  };

  const first = await session.runTurn({
    turnId: "turn-1",
    attemptId: "attempt-1",
    context: "first",
    capabilityActivationId: "activation-1",
    deadlineAt: Date.now() + 1_000,
  }, sink);
  const second = await session.runTurn({
    turnId: "turn-2",
    attemptId: "attempt-2",
    context: "second",
    capabilityActivationId: "activation-2",
    deadlineAt: Date.now() + 1_000,
  }, sink);

  assert.equal(first.outcome, "completed");
  assert.equal(second.engineSessionId, "engine-session-1");
  assert.equal(starts, 1);
  assert.equal(delivers, 1);
  assert.deepEqual(events.filter((event) => event.turnId === "turn-1").map((event) => event.ordinal), [0, 1, 2, 3, 4]);
  assert.deepEqual(events.filter((event) => event.turnId === "turn-2").map((event) => event.ordinal), [0, 1, 2, 3]);
  assert.equal(events.filter((event) => event.kind === "session_changed").length, 1);
  assert.equal(events.at(-1)?.kind, "turn_completed");
});

test("v2 bridge cancellation terminates the process-backed attempt explicitly", async () => {
  let stopped = false;
  const runtime: Runtime = {
    name: "claude",
    start() {
      return { deliver() {}, stop() { stopped = true; } };
    },
  };
  const session = await bridgeRuntimeV2(runtime).openSession(openOptions());
  const events: RuntimeEventEnvelope[] = [];
  const result = session.runTurn({
    turnId: "turn-cancel",
    attemptId: "attempt-cancel",
    context: "wait",
    capabilityActivationId: "activation-cancel",
    deadlineAt: Date.now() + 10_000,
  }, { async emit(event) { events.push(event); } });
  await session.cancel("attempt-cancel");

  assert.equal((await result).outcome, "cancelled");
  assert.equal(stopped, true);
  assert.equal(events.at(-1)?.kind, "turn_failed");
  await assert.rejects(() => session.runTurn({
    turnId: "turn-after-cancel",
    attemptId: "attempt-after-cancel",
    context: "no",
    capabilityActivationId: "activation-after-cancel",
    deadlineAt: Date.now() + 1_000,
  }, { async emit() {} }), /closed/);
});
