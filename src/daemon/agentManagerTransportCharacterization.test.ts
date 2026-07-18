import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentManager, type AgentConfig } from "./agentManager.js";
import { createFakeRuntimeHarness } from "./testing/fakeRuntimeHarness.js";

function config(root: string): AgentConfig {
  return {
    agentId: "agent-1",
    spaceId: "space-1",
    workspaceRoot: path.join(root, "workspace"),
    name: "agent",
    displayName: "Agent",
    runtime: "fake",
    serverUrl: "http://localhost:7777",
    introduced: true,
  };
}

test("current pre-start delivery queue retains exactly the newest ten distinguishable items", async () => {
  // Each run makes one of the newest ten the only required delivery. The public reply-preview
  // and trajectory scope prove that item survived, while the two older deliveries use different
  // channel scopes so either one surviving would make the trajectory ambiguous.
  for (let trackedIndex = 0; trackedIndex < 10; trackedIndex++) {
    const root = mkdtempSync(path.join(tmpdir(), `kith-worker-queue-${trackedIndex}-`));
    const sent: any[] = [];
    const harness = createFakeRuntimeHarness();
    const manager = new AgentManager((message) => sent.push(message), {
      runtimeStateRoot: path.join(root, "runtime"),
      binDir: root,
      runtimeResolver: () => harness.runtime,
    });
    try {
      manager.deliver("agent-1", "Dropped A", "dropped-a", true, { streamId: "dropped-a" });
      manager.deliver("agent-1", "Dropped B", "dropped-b", true, { streamId: "dropped-b" });
      for (let index = 0; index < 10; index++) {
        const tracked = index === trackedIndex;
        manager.deliver("agent-1", `Sender ${index}`, "kept-channel", tracked, {
          targetName: `#kept-${index}`,
          msgShort: `0000000${index}`,
          responseDirective: tracked ? "required" : "optional",
          ...(tracked ? { streamId: `kept-${index}` } : {}),
        });
      }

      await manager.start("agent-1", config(root), "wake");
      harness.trajectory("fake-session-1", [{ kind: "text", text: "working" }]);
      const preview = sent.find((message) => message.type === "agent:reply" && message.op === "start");
      assert.deepEqual({ channelId: preview?.channelId, streamId: preview?.streamId }, {
        channelId: "kept-channel",
        streamId: `kept-${trackedIndex}`,
      });
      const trajectory = sent.find((message) => message.type === "agent:trajectory");
      assert.deepEqual({ scope: trajectory?.scope, channelId: trajectory?.channelId, streamId: trajectory?.streamId }, {
        scope: "scoped",
        channelId: "kept-channel",
        streamId: `kept-${trackedIndex}`,
      });
    } finally {
      manager.stopAll();
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("current pre-start delivery queue uses a 15 second default TTL", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const retainedRoot = mkdtempSync(path.join(tmpdir(), "kith-worker-default-ttl-retained-"));
  const expiredRoot = mkdtempSync(path.join(tmpdir(), "kith-worker-default-ttl-expired-"));
  const retainedSent: any[] = [];
  const expiredSent: any[] = [];
  const retainedHarness = createFakeRuntimeHarness();
  const expiredHarness = createFakeRuntimeHarness();
  const retained = new AgentManager((message) => retainedSent.push(message), {
    runtimeStateRoot: path.join(retainedRoot, "runtime"),
    binDir: retainedRoot,
    runtimeResolver: () => retainedHarness.runtime,
  });
  const expired = new AgentManager((message) => expiredSent.push(message), {
    runtimeStateRoot: path.join(expiredRoot, "runtime"),
    binDir: expiredRoot,
    runtimeResolver: () => expiredHarness.runtime,
  });
  try {
    retained.deliver("agent-1", "Human", "retained", true, { streamId: "retained" });
    expired.deliver("agent-1", "Human", "expired", true, { streamId: "expired" });
    t.mock.timers.tick(14_999);
    await retained.start("agent-1", config(retainedRoot), "manual");
    retainedHarness.trajectory("fake-session-1", [{ kind: "text", text: "working" }]);
    assert.ok(retainedSent.some((message) => message.type === "agent:trajectory" && message.streamId === "retained"));

    t.mock.timers.tick(1);
    await expired.start("agent-1", config(expiredRoot), "manual");
    expiredHarness.trajectory("fake-session-1", [{ kind: "text", text: "working" }]);
    assert.ok(expiredSent.some((message) => message.type === "agent:trajectory" && message.scope === "unscoped"));
    assert.equal(expiredSent.some((message) => message.type === "agent:reply" && message.op === "start"), false);
  } finally {
    retained.stopAll();
    expired.stopAll();
    rmSync(retainedRoot, { recursive: true, force: true });
    rmSync(expiredRoot, { recursive: true, force: true });
  }
});

test("current pre-start delivery queue expires after its configured TTL", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-worker-queue-current-"));
  const harness = createFakeRuntimeHarness();
  const manager = new AgentManager(() => {}, {
    runtimeStateRoot: path.join(root, "runtime"),
    binDir: root,
    pendingDeliverTtlMs: 5,
    runtimeResolver: () => harness.runtime,
  });
  try {
    manager.deliver("agent-1", "Human", "expired", true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await manager.start("agent-1", config(root), "manual");

    const prompt = harness.sessions()[0]?.start.initialPrompt ?? "";
    assert.match(prompt, /If nothing requires action, remain silent/);
    assert.doesNotMatch(prompt, /new Kith-space delivery/);
  } finally {
    manager.stopAll();
    rmSync(root, { recursive: true, force: true });
  }
});
