import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentManager, type AgentConfig } from "./agentManager.js";
import type { Runtime, RuntimeCallbacks, StartOpts } from "./runtime.js";

const baseConfig = (agentId: string, workspaceRoot: string): AgentConfig => ({
  agentId,
  name: "agent",
  displayName: "Agent",
  description: "test agent",
  runtime: "fake",
  model: "default",
  serverUrl: "http://localhost:7777",
  spaceId: "space-1",
  workspaceRoot,
  agentToken: "test-token",
});

test("deliver received during async start becomes the single wake turn", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-space-agent-manager-"));
  const delivered: string[] = [];
  let initialPrompt = "";
  const fakeRuntime: Runtime = {
    name: "fake",
    start(opts: StartOpts, cb: RuntimeCallbacks) {
      initialPrompt = opts.initialPrompt;
      cb.onSession("fake-session");
      return { deliver: (text) => delivered.push(text), stop: () => {} };
    },
  };

  try {
    const mgr = new AgentManager(() => {}, {
      dataDir: root,
      binDir: root,
      deliverDebounceMs: 0,
      runtimeResolver: () => fakeRuntime,
    });
    const start = mgr.start("agent-1", baseConfig("agent-1", path.join(root, "workspace")));
    mgr.deliver("agent-1", "User", "dm:agent-1", true, { targetName: "dm:Agent", msgShort: "m1" });
    await start;
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.match(initialPrompt, /new Kith-space delivery/);
    assert.doesNotMatch(initialPrompt, /one-time introduction/);
    assert.equal(delivered.length, 0);
    mgr.stopAll();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("explicit wake start handles the delivery instead of introducing the agent", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-space-agent-manager-"));
  let initialPrompt = "";
  let introductionToken: string | undefined;
  const fakeRuntime: Runtime = {
    name: "fake",
    start(opts: StartOpts) {
      initialPrompt = opts.initialPrompt;
      introductionToken = opts.env.KITH_SPACE_INTRODUCTION_TOKEN;
      return { deliver: () => {}, stop: () => {} };
    },
  };

  try {
    const mgr = new AgentManager(() => {}, {
      dataDir: root,
      binDir: root,
      runtimeResolver: () => fakeRuntime,
    });
    await mgr.start("agent-wake", { ...baseConfig("agent-wake", path.join(root, "workspace")), introductionToken: "must-not-leak" }, "wake");

    assert.match(initialPrompt, /new Kith-space delivery/);
    assert.doesNotMatch(initialPrompt, /one-time introduction/);
    assert.equal(introductionToken, undefined);
    mgr.stopAll();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("new agent stays introduction-pending until the Human DM is persisted", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-space-agent-manager-"));
  const prompts: string[] = [];
  const introductionTokens: Array<string | undefined> = [];
  let callbacks: RuntimeCallbacks | undefined;
  const fakeRuntime: Runtime = {
    name: "fake",
    start(opts: StartOpts, cb: RuntimeCallbacks) {
      prompts.push(opts.initialPrompt);
      introductionTokens.push(opts.env.KITH_SPACE_INTRODUCTION_TOKEN);
      callbacks = cb;
      return { deliver: () => {}, stop: () => {} };
    },
  };

  try {
    const mgr = new AgentManager(() => {}, {
      dataDir: root,
      binDir: root,
      runtimeResolver: () => fakeRuntime,
    });
    const config = { ...baseConfig("agent-intro", path.join(root, "workspace")), introductionToken: "intro-token" };
    await mgr.start("agent-intro", config, "create");

    assert.match(prompts[0]!, /one-time introduction/);
    assert.match(prompts[0]!, /dm:@you/);
    assert.equal(introductionTokens[0], "intro-token");
    callbacks!.onActivity("online", "");
    mgr.stop("agent-intro");

    await mgr.start("agent-intro", config, "manual");
    assert.match(prompts[1]!, /one-time introduction/);
    mgr.stop("agent-intro");

    await mgr.start("agent-intro", { ...config, introduced: true }, "manual");
    assert.match(prompts[2]!, /If the inbox is empty, remain silent/);
    assert.doesNotMatch(prompts[2]!, /one-time introduction/);
    assert.equal(introductionTokens[2], undefined);
    mgr.stopAll();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("one-shot runtime start with pending delivery uses wake nudge without a second notice", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-space-agent-manager-"));
  const delivered: string[] = [];
  let initialPrompt: string | undefined;
  const fakeRuntime: Runtime = {
    name: "one-shot-test",
    oneShotWake: true,
    start(opts: StartOpts, cb: RuntimeCallbacks) {
      initialPrompt = opts.initialPrompt;
      cb.onSession("one-shot-session");
      return { deliver: (text) => delivered.push(text), stop: () => {} };
    },
  };

  try {
    const mgr = new AgentManager(() => {}, {
      dataDir: root,
      binDir: root,
      deliverDebounceMs: 3000,
      oneShotDeliverDebounceMs: 0,
      runtimeResolver: () => fakeRuntime,
    });
    const config = { ...baseConfig("agent-2", path.join(root, "workspace")), runtime: "one-shot-test", sessionId: "existing-session" };
    const start = mgr.start("agent-2", config);
    mgr.deliver("agent-2", "User", "dm:agent-2", true, { targetName: "dm:Agent", msgShort: "m2" });
    await start;
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.match(initialPrompt ?? "", /host-native Kith-space CLI/);
    assert.match(initialPrompt ?? "", /message send command/);
    assert.equal(delivered.length, 0);
    mgr.stopAll();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("concurrent starts for the same agent are idempotent", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-space-agent-manager-"));
  let startCount = 0;
  const fakeRuntime: Runtime = {
    name: "fake",
    start(_opts: StartOpts, cb: RuntimeCallbacks) {
      startCount++;
      cb.onSession("fake-session");
      return { deliver: () => {}, stop: () => {} };
    },
  };

  try {
    const mgr = new AgentManager(() => {}, {
      dataDir: root,
      binDir: root,
      runtimeResolver: () => fakeRuntime,
    });
    await Promise.all([
      mgr.start("agent-2", baseConfig("agent-2", path.join(root, "workspace"))),
      mgr.start("agent-2", baseConfig("agent-2", path.join(root, "workspace"))),
    ]);

    assert.equal(startCount, 1);
    mgr.stopAll();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Desktop shutdown waits until every runtime reports exit", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-space-agent-manager-"));
  let stopped = false;
  const fakeRuntime: Runtime = {
    name: "fake",
    start(_opts: StartOpts, cb: RuntimeCallbacks) {
      return {
        deliver: () => {},
        stop: () => {
          setTimeout(() => { stopped = true; cb.onExit(0); }, 5);
        },
      };
    },
  };

  try {
    const mgr = new AgentManager(() => {}, {
      dataDir: root,
      binDir: root,
      runtimeResolver: () => fakeRuntime,
    });
    await mgr.start("agent-shutdown", baseConfig("agent-shutdown", path.join(root, "workspace")));
    await mgr.stopAllAndWait(100);
    assert.equal(stopped, true);
    assert.deepEqual(mgr.running(), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
