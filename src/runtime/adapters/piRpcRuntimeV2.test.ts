import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import type { ChildProcess } from "node:child_process";
import { createPiRpcRuntimeV2 } from "./piRpcRuntimeV2.js";

class FakePi extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
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
          data: { sessionId: "pi-session-1", sessionFile: "/must/not/persist" },
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

  line(value: unknown, splitAt?: number) {
    const data = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
    if (splitAt) {
      this.stdout.write(data.subarray(0, splitAt));
      this.stdout.write(data.subarray(splitAt));
    } else this.stdout.write(data);
  }

  kill() { this.killed = true; return true; }
}

function options(root: string) {
  return {
    runtimeSessionId: "runtime-session-1", sessionGeneration: 2, workerGeneration: 3,
    address: { spaceId: "space", agentId: "agent", surfaceKind: "channel" as const, surfaceId: "channel" },
    cwd: root, runtimeStateDir: root, model: "google/gemini-test", runtimeConfig: { fingerprint: "config" },
    engineSessionId: null, restoredSnapshot: null,
    systemPrompt: { text: "System", version: "1", digest: "prompt" },
    mcpBootstrap: { mode: "none" as const, serverName: "kith", descriptor: { capabilityMode: "cli_gateway" } },
    env: {}, broker: { sessionHandle: "handle", endpoint: "http://127.0.0.1" },
  };
}

async function waitForCommand(fake: FakePi, type: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (fake.writes.some((command) => command.type === type)) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`missing Pi RPC command ${type}`);
}

test("Pi RPC uses strict LF framing, correlated admission, and agent_settled as the only terminal", async () => {
  const fake = new FakePi();
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-pi-rpc-"));
  const runtime = createPiRpcRuntimeV2((_command, args) => {
    assert.ok(args.includes("--no-context-files"));
    assert.ok(args.includes("--no-extensions"));
    assert.ok(args.includes("--no-skills"));
    return fake as unknown as ChildProcess;
  });
  const session = await runtime.openSession(options(root));
  const events: any[] = [];
  const result = session.runTurn({
    turnId: "turn", attemptId: "attempt", context: "Hello", capabilityActivationId: "activation",
    deadlineAt: Date.now() + 30_000,
  }, { emit: async (event) => { events.push(event); } });
  await waitForCommand(fake, "prompt");
  fake.line({ type: "agent_start" });
  const unicode = { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "中\u2028文" } };
  const bytes = Buffer.from(`${JSON.stringify(unicode)}\n`);
  fake.stdout.write(bytes.subarray(0, bytes.indexOf(Buffer.from("文"))));
  fake.stdout.write(bytes.subarray(bytes.indexOf(Buffer.from("文"))));
  fake.line({ type: "agent_end", messages: [], willRetry: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.some((event) => event.kind === "turn_completed"), false);
  fake.line({ type: "message_end", message: { role: "assistant", model: "gemini-test",
    usage: { input: 4, output: 2, cacheRead: 1, cost: { total: 0.001 } } } });
  fake.line({ type: "agent_settled" });
  const completed = await result;
  assert.equal(completed.outcome, "completed");
  assert.equal(completed.engineSessionId, "pi-session-1");
  assert.equal(completed.usage?.inputTokens, 4);
  assert.ok(events.some((event) => event.kind === "text_preview" && event.payload.text === "中\u2028文"));
  const snapshot = await session.snapshot();
  assert.equal(snapshot.payload.engineSessionId, "pi-session-1");
  assert.doesNotMatch(JSON.stringify(snapshot), /must\/not\/persist|kith-pi-rpc/);
  await session.close("shutdown");
});

test("Pi RPC keeps tool-call JSON out of assistant text and preserves correlated tool details", async () => {
  const fake = new FakePi();
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-pi-tools-"));
  const session = await createPiRpcRuntimeV2(() => fake as unknown as ChildProcess).openSession(options(root));
  const events: any[] = [];
  const result = session.runTurn({
    turnId: "turn", attemptId: "attempt", context: "Use a tool", capabilityActivationId: "activation",
    deadlineAt: Date.now() + 30_000,
  }, { emit: async (event) => { events.push(event); } });
  await waitForCommand(fake, "prompt");

  fake.line({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "先检查。" } });
  fake.line({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "先检查。" }] },
  });
  fake.line({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", delta: "9}" } });
  fake.line({
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "bash",
    args: { command: "printf '完成'" },
  });
  fake.line({
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "bash",
    result: { content: [{ type: "text", text: "完成" }] },
    isError: false,
  });
  fake.line({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "结论" } });
  fake.line({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "结论完整。" }],
    },
  });
  fake.line({ type: "agent_settled" });

  assert.equal((await result).outcome, "completed");
  assert.deepEqual(
    events.filter((event) => event.kind === "text_preview").map((event) => event.payload.text),
    ["先检查。", "结论", "完整。"],
  );
  const started = events.find((event) => event.kind === "tool_started");
  assert.equal(started?.payload.toolCallId, "call-1");
  assert.equal(started?.payload.toolName, "bash");
  assert.match(started?.payload.toolInput, /printf '完成'/);
  const completed = events.find((event) => event.kind === "tool_completed");
  assert.equal(completed?.payload.toolCallId, "call-1");
  assert.match(completed?.payload.toolOutput, /完成/);
  await session.close("shutdown");
});

test("Pi RPC cancel waits for correlated abort response and settled terminal", async () => {
  const fake = new FakePi();
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-pi-abort-"));
  const session = await createPiRpcRuntimeV2(() => fake as unknown as ChildProcess).openSession(options(root));
  const result = session.runTurn({
    turnId: "turn", attemptId: "attempt", context: "Wait", capabilityActivationId: "activation",
    deadlineAt: Date.now() + 30_000,
  }, { emit: async () => {} });
  await waitForCommand(fake, "prompt");
  fake.line({ type: "agent_start" });
  const cancelling = session.cancel("attempt");
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(fake.writes.some((command) => command.type === "abort"));
  fake.line({ type: "agent_settled" });
  await cancelling;
  assert.equal((await result).outcome, "cancelled");
});

test("Pi RPC keeps model errors non-terminal while auto retry can recover before agent_settled", async () => {
  const fake = new FakePi();
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-pi-retry-"));
  const session = await createPiRpcRuntimeV2(() => fake as unknown as ChildProcess).openSession(options(root));
  const events: any[] = [];
  const result = session.runTurn({
    turnId: "turn", attemptId: "attempt", context: "Retry", capabilityActivationId: "activation",
    deadlineAt: Date.now() + 30_000,
  }, { emit: async (event) => { events.push(event); } });
  await waitForCommand(fake, "prompt");
  fake.line({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "旧答" } });
  fake.line({
    type: "message_end",
    message: { role: "assistant", stopReason: "error", content: [{ type: "text", text: "旧答" }] },
  });
  fake.line({ type: "auto_retry_start" });
  fake.line({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "新答" } });
  fake.line({
    type: "message_end",
    message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "新答完整" }] },
  });
  fake.line({ type: "agent_settled" });
  assert.equal((await result).outcome, "completed");
  assert.deepEqual(
    events.filter((event) => event.kind === "text_preview").map((event) => event.payload.text),
    ["旧答", "新答", "完整"],
  );
  await session.close("shutdown");
});

test("Pi RPC safely reopens the same generation directory during Desktop recovery", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-pi-reopen-"));
  const first = new FakePi();
  const firstSession = await createPiRpcRuntimeV2(() => first as unknown as ChildProcess).openSession(options(root));
  await firstSession.snapshot();
  await firstSession.close("shutdown");
  const second = new FakePi();
  const secondSession = await createPiRpcRuntimeV2(() => second as unknown as ChildProcess).openSession(options(root));
  const snapshot = await secondSession.snapshot();
  assert.equal(snapshot.payload.engineSessionId, "pi-session-1");
  await secondSession.close("shutdown");
});
