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
    stop(agentId) { manager.stop(agentId); },
    sleep(agentId) { manager.sleep(agentId); },
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
    manager.stopAll();
    rmSync(root, { recursive: true, force: true });
  }
});
