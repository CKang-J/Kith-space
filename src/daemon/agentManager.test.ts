import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
      runtimeStateRoot: path.join(root, "runtime"),
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
      runtimeStateRoot: path.join(root, "runtime"),
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
      runtimeStateRoot: path.join(root, "runtime"),
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
      runtimeStateRoot: path.join(root, "runtime"),
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
      runtimeStateRoot: path.join(root, "runtime"),
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
      runtimeStateRoot: path.join(root, "runtime"),
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

test("runtime cwd, Agent Memory, runtime state, profile sync, and reset use distinct paths", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-space-agent-paths-"));
  const workspaceRoot = path.join(root, "space");
  const runtimeStateRoot = path.join(root, "app-data", "runtime");
  const agentId = "agent-paths";
  const ref = { agentId, spaceId: "space-1", workspaceRoot };
  let startOpts: StartOpts | undefined;
  const fakeRuntime: Runtime = {
    name: "fake",
    start(opts: StartOpts) {
      startOpts = opts;
      return { deliver: () => {}, stop: () => {} };
    },
  };

  try {
    mkdirSync(workspaceRoot, { recursive: true });
    const businessFile = path.join(workspaceRoot, "README.md");
    writeFileSync(businessFile, "keep me");
    const mgr = new AgentManager(() => {}, {
      runtimeStateRoot,
      binDir: root,
      runtimeResolver: () => fakeRuntime,
    });
    await mgr.start(agentId, baseConfig(agentId, workspaceRoot));

    const agentMemoryDir = path.join(workspaceRoot, ".kith", "agents", agentId);
    const runtimeStateDir = path.join(runtimeStateRoot, "space-1", agentId);
    assert.equal(startOpts?.cwd, workspaceRoot);
    assert.equal(startOpts?.runtimeStateDir, runtimeStateDir);
    assert.ok(existsSync(path.join(agentMemoryDir, "MEMORY.md")));
    assert.ok(existsSync(runtimeStateDir));

    await mgr.syncProfile(ref, "Renamed Agent", "New role");
    assert.match(readFileSync(path.join(agentMemoryDir, "MEMORY.md"), "utf8"), /^# Renamed Agent/m);

    writeFileSync(path.join(runtimeStateDir, "state.json"), "{}");
    await mgr.reset(ref);
    assert.equal(existsSync(runtimeStateDir), false, "ordinary reset clears runtime state");
    assert.equal(existsSync(agentMemoryDir), true, "ordinary reset preserves Agent Memory");
    assert.equal(readFileSync(businessFile, "utf8"), "keep me");

    await mgr.start(agentId, baseConfig(agentId, workspaceRoot));
    await mgr.reset(ref, { clearAgentMemory: true });
    assert.equal(existsSync(agentMemoryDir), false, "full reset clears only this agent's memory");
    assert.equal(existsSync(runtimeStateDir), false);
    assert.equal(readFileSync(businessFile, "utf8"), "keep me", "reset never deletes shared Space files");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a start received immediately after reset waits for runtime state removal", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-space-reset-restart-"));
  const workspaceRoot = path.join(root, "space");
  const runtimeStateRoot = path.join(root, "runtime");
  const agentId = "agent-reset-restart";
  const ref = { agentId, spaceId: "space-1", workspaceRoot };
  const events: string[] = [];
  let releaseRemoval!: () => void;
  const removalGate = new Promise<void>((resolve) => { releaseRemoval = resolve; });
  let removalStarted!: () => void;
  const sawRemoval = new Promise<void>((resolve) => { removalStarted = resolve; });
  let removals = 0;
  const fakeRuntime: Runtime = {
    name: "fake",
    start() {
      events.push("runtime-start");
      return { deliver: () => {}, stop: () => {} };
    },
  };

  try {
    mkdirSync(workspaceRoot, { recursive: true });
    const mgr = new AgentManager(() => {}, {
      runtimeStateRoot,
      binDir: root,
      runtimeResolver: () => fakeRuntime,
      removePath: async (target) => {
        removals++;
        events.push("remove-start");
        removalStarted();
        await removalGate;
        rmSync(target, { recursive: true, force: true });
        events.push("remove-done");
      },
    });
    await mgr.start(agentId, baseConfig(agentId, workspaceRoot));

    const resetting = mgr.reset(ref);
    await sawRemoval;
    const restarting = mgr.start(agentId, baseConfig(agentId, workspaceRoot));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(events.filter((event) => event === "runtime-start").length, 1, "restart must remain queued while reset deletes state");

    releaseRemoval();
    await Promise.all([resetting, restarting]);
    assert.equal(removals, 1);
    assert.deepEqual(events, ["runtime-start", "remove-start", "remove-done", "runtime-start"]);
    mgr.stopAll();
  } finally {
    releaseRemoval?.();
    rmSync(root, { recursive: true, force: true });
  }
});

test("reset rejects escaping ids before invoking recursive removal", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-space-reset-containment-"));
  let removeCalls = 0;
  try {
    const mgr = new AgentManager(() => {}, {
      runtimeStateRoot: path.join(root, "runtime"),
      binDir: root,
      removePath: async () => { removeCalls++; },
    });
    await assert.rejects(
      mgr.reset({ agentId: "../outside", spaceId: "space-1", workspaceRoot: path.join(root, "space") }, { clearAgentMemory: true }),
      /safe path segment/,
    );
    await assert.rejects(
      mgr.reset({ agentId: "agent-1", spaceId: "..\\outside", workspaceRoot: path.join(root, "space") }, { clearAgentMemory: true }),
      /safe path segment/,
    );
    assert.equal(removeCalls, 0, "invalid ids must be rejected before any recursive delete is attempted");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("experimental runtimes that write cwd-level AGENTS.md stay in runtime state", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-space-agent-instruction-cwd-"));
  try {
    for (const runtimeName of ["copilot", "kimi", "cursor"]) {
      const agentId = `agent-${runtimeName}`;
      const workspaceRoot = path.join(root, "space");
      const runtimeStateRoot = path.join(root, "runtime");
      let cwd = "";
      const runtime: Runtime = {
        name: runtimeName,
        experimental: true,
        start(opts) {
          cwd = opts.cwd;
          return { deliver: () => {}, stop: () => {} };
        },
      };
      const mgr = new AgentManager(() => {}, { runtimeStateRoot, binDir: root, runtimeResolver: () => runtime });
      await mgr.start(agentId, { ...baseConfig(agentId, workspaceRoot), runtime: runtimeName });
      assert.equal(cwd, path.join(runtimeStateRoot, "space-1", agentId));
      mgr.stopAll();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
