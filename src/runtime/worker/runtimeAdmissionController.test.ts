import assert from "node:assert/strict";
import test from "node:test";
import {
  RuntimeAdmissionController,
  type RuntimeAdmissionBackend,
  type WorkerAdmissionCommand,
} from "./runtimeAdmissionController.js";
import type { WorkerQueueOutcome } from "../contract/runtimeWorkerPort.js";

function backendHarness(): RuntimeAdmissionBackend & {
  events: string[];
  runningAgents: Set<string>;
} {
  const runningAgents = new Set<string>();
  const events: string[] = [];
  return {
    events,
    runningAgents,
    isRunning: (agentId) => runningAgents.has(agentId),
    async start(command) { runningAgents.add(command.agentId); events.push(`start:${command.agentId}`); return true; },
    deliver(command) { events.push(`deliver:${command.agentId}:${command.msgShort}`); },
    stop(agentId) { runningAgents.delete(agentId); events.push(`stop:${agentId}`); },
    sleep(agentId) { runningAgents.delete(agentId); events.push(`sleep:${agentId}`); },
    async reset(agentId) { runningAgents.delete(agentId); events.push(`reset:${agentId}`); },
    async stopAllAndWait() { for (const id of runningAgents) events.push(`shutdown:${id}`); runningAgents.clear(); },
  };
}

const wake = (
  id: string,
  agentId: string,
  spaceId: string,
  directive: "required" | "optional" = "required",
): Extract<WorkerAdmissionCommand, { type: "agent:start"; source: "wake" }> => ({
  type: "agent:start",
  source: "wake",
  generation: 1,
  deliveryId: id,
  spaceId,
  agentId,
  config: {},
  reason: "wake",
  delivery: {
    from: "human",
    target: "channel",
    targetName: "#channel",
    msgShort: id,
    isTask: false,
    mentioned: directive === "required",
    responseDirective: directive,
    responseReason: "test",
    seq: 1,
  },
});

test("session capacity never exceeds the install limit and queued starts preserve per-agent order", async () => {
  const backend = backendHarness();
  const controller = new RuntimeAdmissionController(backend, { capacity: 2, maxQueue: 8 });
  assert.equal((await controller.admit(wake("w1", "a1", "s1"))).status, "admitted");
  assert.equal(controller.snapshot().activeOrStarting, 1);
  assert.equal((await controller.admit(wake("w2", "a2", "s2"))).status, "admitted");
  assert.equal(controller.snapshot().activeOrStarting, 2);
  assert.equal((await controller.admit(wake("w3", "a3", "s1"))).status, "queued");
  assert.equal((await controller.admit(wake("w4", "a3", "s1"))).status, "queued");
  await controller.settled();
  assert.equal(controller.snapshot().activeOrStarting, 2);
  assert.equal(controller.snapshot().peakActiveOrStarting, 2);

  assert.equal(controller.sessionEnded("a1"), true);
  assert.equal(controller.sessionEnded("a1"), false, "exit/stop releases a slot exactly once");
  await controller.settled();
  assert.deepEqual(backend.events.filter((entry) => entry.startsWith("deliver:a3")), ["deliver:a3:w3", "deliver:a3:w4"]);
  assert.equal(controller.snapshot().activeOrStarting, 2);

  controller.sessionEnded("a2");
  await controller.settled();
  assert.equal(controller.snapshot().activeOrStarting, 1);
  await controller.shutdown();
});

test("manual > required > optional while aging and Space rotation prevent starvation", async () => {
  let now = 0;
  const backend = backendHarness();
  const controller = new RuntimeAdmissionController(backend, {
    capacity: 1,
    maxQueue: 8,
    agingMs: 10,
    now: () => now,
  });
  await controller.admit(wake("holder", "busy", "space-a"));
  await controller.settled();
  await controller.admit(wake("optional", "optional-agent", "space-a", "optional"));
  now = 5;
  await controller.admit(wake("required-a", "required-a", "space-a"));
  await controller.admit(wake("required-b", "required-b", "space-b"));
  await controller.admit({
    type: "agent:start",
    source: "manual",
    generation: 1,
    commandId: "manual",
    spaceId: "space-b",
    agentId: "manual-agent",
    config: {},
    reason: "manual",
  });

  controller.sessionEnded("busy");
  await controller.settled();
  assert.equal(backend.events.filter((entry) => entry.startsWith("start:")).at(-1), "start:manual-agent");
  controller.sessionEnded("manual-agent");
  await controller.settled();
  assert.equal(backend.events.filter((entry) => entry.startsWith("start:")).at(-1), "start:required-a");
  controller.sessionEnded("required-a");
  await controller.settled();
  assert.equal(backend.events.filter((entry) => entry.startsWith("start:")).at(-1), "start:required-b", "equal priority rotates across Spaces");

  now = 100;
  controller.sessionEnded("required-b");
  await controller.settled();
  assert.equal(backend.events.filter((entry) => entry.startsWith("start:")).at(-1), "start:optional-agent", "aging eventually admits optional work");
  await controller.shutdown();
});

test("duplicate commands, queue full, expiry, stop/reset cancellation and shutdown are deterministic", async () => {
  let now = 0;
  const backend = backendHarness();
  const outcomes: Array<{ id: string; status: string }> = [];
  const controller = new RuntimeAdmissionController(backend, {
    capacity: 1,
    maxQueue: 2,
    queueTtlMs: 10,
    now: () => now,
    onOutcome: (outcome) => outcomes.push({ id: outcome.id, status: outcome.status }),
  });
  await controller.admit(wake("holder", "busy", "s1"));
  await controller.settled();
  assert.deepEqual(await controller.admit(wake("q1", "queued", "s1")), await controller.admit(wake("q1", "queued", "s1")));
  assert.equal((await controller.admit(wake("q2", "reset-me", "s2"))).status, "queued");
  assert.equal((await controller.admit(wake("overflow", "overflow", "s3"))).status, "rejected");

  const reset = await controller.admit({
    type: "agent:reset",
    source: "lifecycle",
    generation: 1,
    commandId: "reset-1",
    spaceId: "s2",
    agentId: "reset-me",
    workspaceRoot: "C:/workspace",
    clearAgentMemory: false,
  });
  assert.equal(reset.status, "admitted");
  assert.ok(outcomes.some((outcome) => outcome.id === "q2" && outcome.status === "cancelled"));

  now = 11;
  controller.sweepExpired();
  assert.ok(outcomes.some((outcome) => outcome.id === "q1" && outcome.status === "expired"));
  assert.equal(controller.snapshot().queued, 0);
  await controller.shutdown();
  assert.equal((await controller.admit(wake("late", "late", "s1"))).status, "rejected");
});

test("sleep releases a live session slot exactly once", async () => {
  const backend = backendHarness();
  const controller = new RuntimeAdmissionController(backend, { capacity: 1 });
  await controller.admit(wake("sleep-holder", "sleep-agent", "space-1"));
  await controller.settled();
  assert.equal(controller.snapshot().activeOrStarting, 1);
  const result = await controller.admit({
    type: "agent:sleep",
    source: "lifecycle",
    generation: 1,
    commandId: "sleep-1",
    spaceId: "space-1",
    agentId: "sleep-agent",
  });
  assert.equal(result.status, "admitted");
  assert.equal(controller.snapshot().activeOrStarting, 0);
  assert.equal(controller.sessionEnded("sleep-agent"), false);
  await controller.shutdown();
});

test("an idle session yields its slot when another agent is queued", async () => {
  const backend = backendHarness();
  const controller = new RuntimeAdmissionController(backend, { capacity: 1 });
  await controller.admit(wake("holder", "holder-agent", "space-1"));
  await controller.settled();
  assert.equal((await controller.admit(wake("waiting", "waiting-agent", "space-2"))).status, "queued");

  assert.equal(controller.sessionIdle("holder-agent"), true);
  await controller.settled();

  assert.deepEqual(backend.events.filter((entry) => entry.startsWith("sleep:") || entry.startsWith("start:")), [
    "start:holder-agent",
    "sleep:holder-agent",
    "start:waiting-agent",
  ]);
  assert.equal(controller.snapshot().queued, 0);
  assert.equal(controller.snapshot().activeOrStarting, 1);
  await controller.shutdown();
});

test("a duplicate manual start does not hide a warm idle session from queued work", async () => {
  const backend = backendHarness();
  const controller = new RuntimeAdmissionController(backend, { capacity: 1 });
  await controller.admit(wake("holder", "holder-agent", "space-1"));
  await controller.settled();
  assert.equal(controller.sessionIdle("holder-agent"), false);
  assert.equal((await controller.admit({
    type: "agent:start",
    source: "manual",
    generation: 1,
    commandId: "duplicate-manual",
    spaceId: "space-1",
    agentId: "holder-agent",
    config: {},
    reason: "manual",
  })).status, "admitted");
  assert.equal((await controller.admit(wake("waiting", "waiting-agent", "space-2"))).status, "queued");
  await controller.settled();

  assert.equal(backend.events.includes("sleep:holder-agent"), true);
  assert.equal(backend.events.includes("start:waiting-agent"), true);
  await controller.shutdown();
});

test("a warm idle session yields immediately when later work arrives", async () => {
  const backend = backendHarness();
  const controller = new RuntimeAdmissionController(backend, { capacity: 1 });
  await controller.admit(wake("holder", "holder-agent", "space-1"));
  await controller.settled();
  assert.equal(controller.sessionIdle("holder-agent"), false, "idle sessions stay warm without queue pressure");

  assert.equal((await controller.admit(wake("waiting", "waiting-agent", "space-2"))).status, "queued");
  await controller.settled();

  assert.deepEqual(backend.events.filter((entry) => entry.startsWith("sleep:") || entry.startsWith("start:")), [
    "start:holder-agent",
    "sleep:holder-agent",
    "start:waiting-agent",
  ]);
  assert.equal(controller.snapshot().queued, 0);
  await controller.shutdown();
});

test("a failed queued wake identifies the reply preview it must terminate", async () => {
  let now = 0;
  const backend = backendHarness();
  const outcomes: WorkerQueueOutcome[] = [];
  const controller = new RuntimeAdmissionController(backend, {
    capacity: 1,
    queueTtlMs: 10,
    now: () => now,
    onOutcome: (outcome) => outcomes.push(outcome),
  });
  await controller.admit(wake("holder", "holder-agent", "space-1"));
  const waiting = wake("waiting", "waiting-agent", "space-2");
  waiting.delivery.streamId = "stream-1";
  await controller.admit(waiting);

  now = 11;
  controller.sweepExpired();

  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]?.status, "expired");
  assert.equal(outcomes[0]?.channelId, "channel");
  assert.equal(outcomes[0]?.streamId, "stream-1");
  await controller.shutdown();
});
