import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentManager, type AgentConfig } from "./agentManager.js";
import type { Runtime, RuntimeCallbacks } from "./runtime.js";

function config(root: string): AgentConfig {
  return {
    agentId: "agent-1",
    spaceId: "space-1",
    workspaceRoot: path.join(root, "workspace"),
    name: "agent",
    displayName: "Agent",
    runtime: "fake",
    serverUrl: "http://localhost:7777",
  };
}

test("manager sends trajectory and terminal activity with the same delivery scope", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-trajectory-manager-"));
  const sent: any[] = [];
  let callbacks!: RuntimeCallbacks;
  const runtime: Runtime = {
    name: "fake",
    start(_opts, cb) {
      callbacks = cb;
      return { deliver: () => cb.onActivity("working", "turn"), stop: () => {} };
    },
  };

  try {
    const manager = new AgentManager((message) => sent.push(message), {
      runtimeStateRoot: path.join(root, "runtime"),
      binDir: root,
      deliverDebounceMs: 0,
      runtimeResolver: () => runtime,
    });
    await manager.start("agent-1", config(root));
    callbacks.onActivity("online", "");
    manager.deliver("agent-1", "Human", "channel-a", true, { streamId: "stream-a" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    callbacks.onTrajectory([{ kind: "text", text: "working" }]);
    callbacks.onActivity("online", "");

    const trajectory = [...sent].reverse().find((message) => message.type === "agent:trajectory");
    const terminal = [...sent].reverse().find((message) => message.type === "agent:activity" && message.activity === "online");
    assert.deepEqual({ scope: trajectory.scope, channelId: trajectory.channelId, streamId: trajectory.streamId }, {
      scope: "scoped", channelId: "channel-a", streamId: "stream-a",
    });
    assert.deepEqual({ scope: terminal.scope, channelId: terminal.channelId, streamId: terminal.streamId }, {
      scope: "scoped", channelId: "channel-a", streamId: "stream-a",
    });
    await manager.stopAll();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("manager marks one debounced turn across different targets as ambiguous", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-trajectory-manager-"));
  const sent: any[] = [];
  let callbacks!: RuntimeCallbacks;
  const runtime: Runtime = {
    name: "fake",
    start(_opts, cb) {
      callbacks = cb;
      return { deliver: () => cb.onActivity("working", "turn"), stop: () => {} };
    },
  };

  try {
    const manager = new AgentManager((message) => sent.push(message), {
      runtimeStateRoot: path.join(root, "runtime"),
      binDir: root,
      deliverDebounceMs: 0,
      runtimeResolver: () => runtime,
    });
    await manager.start("agent-1", config(root));
    callbacks.onActivity("online", "");
    manager.deliver("agent-1", "Human", "channel-a", true, { streamId: "stream-a" });
    manager.deliver("agent-1", "Human", "channel-b", true, { streamId: "stream-b" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    callbacks.onTrajectory([{ kind: "text", text: "working" }]);

    const trajectory = [...sent].reverse().find((message) => message.type === "agent:trajectory");
    assert.equal(trajectory.scope, "ambiguous");
    assert.equal(trajectory.channelId, undefined);
    await manager.stopAll();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a synchronous delivery failure does not leak its scope into the next turn", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-trajectory-manager-"));
  const sent: any[] = [];
  let callbacks!: RuntimeCallbacks;
  let failDelivery = true;
  const runtime: Runtime = {
    name: "fake",
    start(_opts, cb) {
      callbacks = cb;
      return {
        deliver: () => {
          if (failDelivery) throw new Error("delivery failed");
          cb.onActivity("working", "turn");
        },
        stop: () => {},
      };
    },
  };

  try {
    const manager = new AgentManager((message) => sent.push(message), {
      runtimeStateRoot: path.join(root, "runtime"),
      binDir: root,
      deliverDebounceMs: 0,
      runtimeResolver: () => runtime,
    });
    await manager.start("agent-1", config(root));
    callbacks.onActivity("online", "");

    manager.deliver("agent-1", "Human", "channel-a", true, { streamId: "stream-a" });
    await new Promise((resolve) => setTimeout(resolve, 10));

    failDelivery = false;
    manager.deliver("agent-1", "Human", "channel-b", true, { streamId: "stream-b" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    callbacks.onTrajectory([{ kind: "text", text: "working" }]);

    const trajectory = [...sent].reverse().find((message) => message.type === "agent:trajectory");
    assert.deepEqual({ scope: trajectory.scope, channelId: trajectory.channelId, streamId: trajectory.streamId }, {
      scope: "scoped", channelId: "channel-b", streamId: "stream-b",
    });
    await manager.stopAll();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
