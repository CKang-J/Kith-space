import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import type { ChildProcess } from "node:child_process";
import { createPiBuiltinRpcRuntimeV2, piAgentAssetsDir } from "./piBuiltinRpcRuntimeV2.js";

class FakeHelper extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  writes: any[] = [];

  constructor() {
    super();
    let buffer = "";
    this.stdin.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        const command = JSON.parse(line);
        this.writes.push(command);
        if (command.type === "get_state") this.line({
          id: command.id, type: "response", command: "get_state", success: true,
          data: { sessionId: "builtin-session-1", sessionFile: "/must/not/persist" },
        });
        else if (command.type === "prompt") this.line({
          id: command.id, type: "response", command: "prompt", success: true,
        });
        else if (command.type === "abort") this.line({
          id: command.id, type: "response", command: "abort", success: true,
        });
      }
    });
  }

  line(value: unknown) { this.stdout.write(`${JSON.stringify(value)}\n`); }
  kill() { return true; }
}

function options(root: string) {
  return {
    runtimeSessionId: "runtime-session-1", sessionGeneration: 2, workerGeneration: 3,
    address: { spaceId: "space", agentId: "agent", surfaceKind: "channel" as const, surfaceId: "channel" },
    cwd: root, runtimeStateDir: root, model: "deepseek/deepseek-v4-flash",
    runtimeConfig: {
      compiledRuntimeConfiguration: {
        args: ["--mode", "rpc", "--provider", "kith", "--model", "deepseek-v4-flash",
          "--no-approve", "--no-context-files", "--no-extensions", "--no-skills",
          "--no-prompt-templates", "--no-themes"],
        ephemeralFiles: [], fingerprint: "config",
      },
    },
    engineSessionId: null, restoredSnapshot: null,
    systemPrompt: { text: "System", version: "1", digest: "prompt" },
    mcpBootstrap: { mode: "none" as const, serverName: "kith", descriptor: { capabilityMode: "cli_gateway" } },
    env: { PI_CODING_AGENT_DIR: "/private/pi-builtin-home", KITH_PI_API_KEY: "activation-key" },
    broker: { sessionHandle: "handle", endpoint: "http://127.0.0.1" },
  };
}

async function waitForCommand(fake: FakeHelper, type: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (fake.writes.some((command) => command.type === type)) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`missing Pi helper RPC command ${type}`);
}

test("the built-in Pi runtime spawns the bundled helper with assets and managed config passthrough", async () => {
  const fake = new FakeHelper();
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-pi-builtin-"));
  let spawnedCommand = "";
  let spawnedArgs: string[] = [];
  let spawnedEnv: NodeJS.ProcessEnv = {};
  const runtime = createPiBuiltinRpcRuntimeV2("/bundled/pi-agent-helper.mjs", (command, args, spawnOptions) => {
    spawnedCommand = command;
    spawnedArgs = args;
    spawnedEnv = spawnOptions.env;
    return fake as unknown as ChildProcess;
  });
  const session = await runtime.openSession(options(root));
  await waitForCommand(fake, "get_state");
  assert.equal(spawnedCommand, process.execPath);
  assert.equal(spawnedArgs[0], "/bundled/pi-agent-helper.mjs");
  assert.ok(spawnedArgs.includes("--mode"));
  assert.ok(spawnedArgs.includes("rpc"));
  assert.ok(spawnedArgs.includes("--provider"));
  assert.ok(spawnedArgs.some((arg) => arg.endsWith("sessions")));
  assert.ok(spawnedArgs.some((arg) => arg.endsWith("system-prompt.md")));
  assert.equal(spawnedEnv.PI_PACKAGE_DIR, "/bundled/pi-agent-assets");
  assert.equal(spawnedEnv.PI_CODING_AGENT_DIR, "/private/pi-builtin-home");
  assert.equal(spawnedEnv.KITH_PI_API_KEY, "activation-key");
  assert.equal(spawnedEnv.PI_TELEMETRY, "0");
  const snapshot = await session.snapshot();
  assert.equal(snapshot.payload.runtime, "pi-builtin");
  assert.equal(snapshot.payload.engineSessionId, "builtin-session-1");
  assert.doesNotMatch(JSON.stringify(snapshot), /must\/not\/persist/);
  await session.close("shutdown");
});

test("the built-in Pi runtime completes turns on agent_settled like the external protocol", async () => {
  const fake = new FakeHelper();
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-pi-builtin-turn-"));
  const runtime = createPiBuiltinRpcRuntimeV2("/bundled/pi-agent-helper.mjs", () => fake as unknown as ChildProcess);
  const session = await runtime.openSession(options(root));
  const events: any[] = [];
  const result = session.runTurn({
    turnId: "turn", attemptId: "attempt", context: "Hello", capabilityActivationId: "activation",
    deadlineAt: Date.now() + 30_000,
  }, { emit: async (event) => { events.push(event); } });
  await waitForCommand(fake, "prompt");
  fake.line({ type: "agent_start" });
  fake.line({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "内置回复" } });
  fake.line({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "内置回复" }],
    usage: { input: 3, output: 2 } } });
  fake.line({ type: "agent_settled" });
  const completed = await result;
  assert.equal(completed.outcome, "completed");
  assert.equal(completed.engineSessionId, "builtin-session-1");
  assert.equal(completed.usage?.inputTokens, 3);
  assert.ok(events.some((event) => event.kind === "turn_started" && event.payload.runtime === "pi-builtin"));
  assert.ok(events.some((event) => event.kind === "text_preview" && event.payload.text === "内置回复"));
  await session.close("shutdown");
});

test("the built-in Pi runtime restores ELECTRON_RUN_AS_NODE for the packaged Desktop helper", async () => {
  const fake = new FakeHelper();
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-pi-builtin-electron-"));
  let spawnedEnv: NodeJS.ProcessEnv = {};
  const original = Object.getOwnPropertyDescriptor(process.versions, "electron");
  Object.defineProperty(process.versions, "electron", { value: "37.0.0", configurable: true });
  try {
    const runtime = createPiBuiltinRpcRuntimeV2("/bundled/pi-agent-helper.mjs", (_command, _args, spawnOptions) => {
      spawnedEnv = spawnOptions.env;
      return fake as unknown as ChildProcess;
    });
    const session = await runtime.openSession(options(root));
    await waitForCommand(fake, "get_state");
    assert.equal(spawnedEnv.ELECTRON_RUN_AS_NODE, "1");
    await session.close("shutdown");
  } finally {
    if (original) Object.defineProperty(process.versions, "electron", original);
    else delete (process.versions as Record<string, unknown>).electron;
  }
});

test("piAgentAssetsDir points next to the helper bundle", () => {
  assert.equal(piAgentAssetsDir("/a/b/pi-agent-helper.mjs"), path.join("/a/b", "pi-agent-assets"));
});
