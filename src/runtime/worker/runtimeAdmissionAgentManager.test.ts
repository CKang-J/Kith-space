import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentManager, type AgentConfig } from "../../daemon/agentManager.js";
import { createFakeRuntimeHarness } from "../../daemon/testing/fakeRuntimeHarness.js";
import type { WorkerAdmissionCommand } from "../contract/runtimeWorkerPort.js";
import { RuntimeAdmissionController } from "./runtimeAdmissionController.js";

test("fake Runtime sessions obey install capacity and release on exit/stop/shutdown", { timeout: 5_000 }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-admission-manager-"));
  const harness = createFakeRuntimeHarness();
  let controller: RuntimeAdmissionController;
  const manager = new AgentManager(() => {}, {
    runtimeStateRoot: path.join(root, "runtime"),
    binDir: root,
    deliverDebounceMs: 0,
    runtimeResolver: () => harness.runtime,
    onSessionEnded(agentId) { controller.sessionEnded(agentId); },
  });
  controller = new RuntimeAdmissionController({
    isRunning(agentId) { return manager.running().includes(agentId); },
    async start(command) { await manager.start(command.agentId, command.config as AgentConfig, command.reason); return manager.running().includes(command.agentId); },
    deliver(command) { manager.deliver(command.agentId, command.from, command.target, command.mentioned, command); },
    stop(agentId) { return manager.stop(agentId); },
    sleep(agentId) { return manager.sleep(agentId); },
    reset(agentId, command) { return manager.reset({ agentId, spaceId: command.spaceId, workspaceRoot: command.workspaceRoot }, { clearAgentMemory: command.clearAgentMemory }); },
    stopAllAndWait() { return manager.stopAllAndWait(); },
  }, { capacity: 2, maxQueue: 8 });

  const command = (index: number): WorkerAdmissionCommand => {
    const agentId = `agent-${index}`;
    return {
      type: "agent:start",
      source: "wake",
      generation: 1,
      deliveryId: `delivery-${index}`,
      spaceId: "space-1",
      agentId,
      config: {
        agentId,
        spaceId: "space-1",
        workspaceRoot: path.join(root, "workspace"),
        name: agentId,
        displayName: `Agent ${index}`,
        runtime: "fake",
        serverUrl: "http://127.0.0.1:7777",
        introduced: true,
      },
      reason: "wake",
      delivery: {
        seq: index,
        from: "human",
        target: "channel-1",
        targetName: "#general",
        msgShort: `message-${index}`,
        isTask: false,
        mentioned: true,
        responseDirective: "required",
        responseReason: "test",
      },
    };
  };

  try {
    assert.equal((await controller.admit(command(1))).status, "admitted");
    assert.equal((await controller.admit(command(2))).status, "admitted");
    assert.equal((await controller.admit(command(3))).status, "queued");
    await controller.settled();
    assert.equal(harness.snapshot().activeSessions, 2);
    assert.equal(harness.snapshot().peakActiveSessions, 2);

    harness.exit("fake-session-1", 1);
    await controller.settled();
    assert.equal(harness.snapshot().activeSessions, 2);
    assert.equal(harness.snapshot().peakActiveSessions, 2);
    assert.equal(controller.snapshot().activeOrStarting, 2);

    const agentToStop = manager.running().find((agentId) => agentId !== "agent-3")!;
    const stopped = await controller.admit({
      type: "agent:stop",
      source: "lifecycle",
      generation: 1,
      commandId: `stop-${agentToStop}`,
      spaceId: "space-1",
      agentId: agentToStop,
    });
    assert.equal(stopped.status, "admitted");
    assert.equal(controller.snapshot().activeOrStarting, 1);
    await controller.shutdown();
    assert.equal(harness.snapshot().activeSessions, 0);
  } finally {
    await manager.stopAll();
    rmSync(root, { recursive: true, force: true });
  }
});

test("AgentManager reports a completed runtime turn as an idle session", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-admission-idle-"));
  const harness = createFakeRuntimeHarness();
  const idleAgents: string[] = [];
  const manager = new AgentManager(() => {}, {
    runtimeStateRoot: path.join(root, "runtime"),
    binDir: root,
    runtimeResolver: () => harness.runtime,
    onSessionIdle(agentId) { idleAgents.push(agentId); },
  });

  try {
    await manager.start("agent-idle", {
      agentId: "agent-idle",
      spaceId: "space-1",
      workspaceRoot: path.join(root, "workspace"),
      name: "agent-idle",
      displayName: "Idle Agent",
      runtime: "fake",
      serverUrl: "http://127.0.0.1:7777",
      introduced: true,
    }, "wake");
    harness.activity("fake-session-1", "online");
    assert.deepEqual(idleAgents, ["agent-idle"]);
  } finally {
    await manager.stopAll();
    rmSync(root, { recursive: true, force: true });
  }
});

test("AgentManager counts a delivery batch as one runtime turn before reporting idle", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-admission-batch-idle-"));
  const harness = createFakeRuntimeHarness();
  const idleAgents: string[] = [];
  const manager = new AgentManager(() => {}, {
    runtimeStateRoot: path.join(root, "runtime"),
    binDir: root,
    deliverDebounceMs: 0,
    runtimeResolver: () => harness.runtime,
    onSessionIdle(agentId) { idleAgents.push(agentId); },
  });

  try {
    await manager.start("agent-batch", {
      agentId: "agent-batch",
      spaceId: "space-1",
      workspaceRoot: path.join(root, "workspace"),
      name: "agent-batch",
      displayName: "Batch Agent",
      runtime: "fake",
      serverUrl: "http://127.0.0.1:7777",
      introduced: true,
    }, "wake");
    manager.deliver("agent-batch", "Human", "channel-1", true, { msgShort: "one" });
    manager.deliver("agent-batch", "Human", "channel-1", true, { msgShort: "two" });

    harness.activity("fake-session-1", "online");
    assert.deepEqual(idleAgents, [], "the accepted delivery batch still owns one turn");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(harness.snapshot().totalDeliveries, 1);

    harness.activity("fake-session-1", "working");
    harness.activity("fake-session-1", "online");
    assert.deepEqual(idleAgents, ["agent-batch"]);
  } finally {
    await manager.stopAll();
    rmSync(root, { recursive: true, force: true });
  }
});

test("AgentManager settles one terminal signal per batch and releases a failed final turn", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-admission-error-idle-"));
  const harness = createFakeRuntimeHarness();
  const idleAgents: string[] = [];
  const manager = new AgentManager(() => {}, {
    runtimeStateRoot: path.join(root, "runtime"),
    binDir: root,
    runtimeResolver: () => harness.runtime,
    onSessionIdle(agentId) { idleAgents.push(agentId); },
  });

  try {
    await manager.start("agent-error", {
      agentId: "agent-error",
      spaceId: "space-1",
      workspaceRoot: path.join(root, "workspace"),
      name: "agent-error",
      displayName: "Error Agent",
      runtime: "fake",
      serverUrl: "http://127.0.0.1:7777",
      introduced: true,
    }, "wake");
    manager.deliver("agent-error", "Human", "channel-1", true, { msgShort: "queued follow-up" });
    await new Promise((resolve) => setTimeout(resolve, 10));

    harness.activity("fake-session-1", "error", "initial turn failed");
    harness.activity("fake-session-1", "online");
    assert.deepEqual(idleAgents, [], "a duplicate terminal signal must not consume the queued batch");

    harness.activity("fake-session-1", "working");
    harness.activity("fake-session-1", "error", "follow-up failed");
    assert.deepEqual(idleAgents, ["agent-error"]);
  } finally {
    await manager.stopAll();
    rmSync(root, { recursive: true, force: true });
  }
});
