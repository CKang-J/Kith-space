// Regression for #163: a missing Codex binary must not crash the daemon process.
// Run: npx tsx --test src/daemon/codexRuntime.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { codexRuntime } from "./codexRuntime.js";

test("missing codex binary reports offline instead of crashing daemon", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-space-codex-missing-"));
  const events: { activity: string; detail?: string }[] = [];
  let exitCode: number | null | undefined;

  try {
    const session = codexRuntime.start({
      cwd: root,
      env: { PATH: root },
      systemPrompt: "system",
      initialPrompt: "start",
    }, {
      onSession: () => {},
      onActivity: (activity, detail) => events.push({ activity, detail }),
      onTrajectory: () => {},
      onExit: (code) => { exitCode = code; },
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    session.stop();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  assert.equal(exitCode, 1);
  assert.ok(
    events.some((e) => e.activity === "offline" && /codex not found/.test(e.detail ?? "")),
    "expected a visible offline activity for missing codex",
  );
});

test("Codex launches an npm cmd shim on Windows", { skip: process.platform !== "win32" }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-space-codex-shim-"));
  writeFileSync(path.join(root, "codex.cmd"), "@echo off\r\nexit /b 0\r\n");
  let resolveExit!: (code: number | null) => void;
  const exited = new Promise<number | null>((resolve) => { resolveExit = resolve; });

  try {
    assert.doesNotThrow(() => codexRuntime.start({
      cwd: root,
      env: { ...process.env, PATH: root },
      systemPrompt: "system",
      initialPrompt: "start",
    }, {
      onSession: () => {},
      onActivity: () => {},
      onTrajectory: () => {},
      onExit: resolveExit,
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any,
    }));

    const exitCode = await Promise.race([
      exited,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("codex shim did not exit")), 1_000)),
    ]);
    assert.equal(exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Codex preserves UTF-8 text split across stdout chunks", { skip: process.platform !== "win32" }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-space-codex-utf8-"));
  const fixture = path.join(root, "codex-fixture.mjs");
  writeFileSync(fixture, String.raw`
let input = "";
process.stdin.setEncoding("utf8");
function send(value, splitUtf8 = false) {
  const bytes = Buffer.from(JSON.stringify(value) + "\n", "utf8");
  if (!splitUtf8) return void process.stdout.write(bytes);
  const start = bytes.indexOf(Buffer.from("中", "utf8"));
  process.stdout.write(bytes.subarray(0, start + 1), () => {
    setTimeout(() => process.stdout.write(bytes.subarray(start + 1)), 20);
  });
}
process.stdin.on("data", (chunk) => {
  input += chunk;
  const lines = input.split("\n");
  input = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    if (request.method === "initialize") send({ jsonrpc: "2.0", id: request.id, result: {} });
    else if (request.method === "thread/start") send({ jsonrpc: "2.0", id: request.id, result: { thread: { id: "thread-utf8" } } });
    else if (request.method === "turn/start") {
      send({ jsonrpc: "2.0", id: request.id, result: {} });
      send({ jsonrpc: "2.0", method: "item/completed", params: { threadId: "thread-utf8", item: { type: "agentMessage", text: "中文测试" } } }, true);
      setTimeout(() => {
        send({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: "thread-utf8", turn: { status: "completed" } } });
        setTimeout(() => process.exit(0), 20);
      }, 40);
    }
  }
});
`);
  writeFileSync(path.join(root, "codex.cmd"), `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`);
  let resolveText!: (text: string) => void;
  const received = new Promise<string>((resolve) => { resolveText = resolve; });
  let resolveExit!: () => void;
  const exited = new Promise<void>((resolve) => { resolveExit = resolve; });

  try {
    const session = codexRuntime.start({
      cwd: root,
      env: { ...process.env, PATH: root },
      systemPrompt: "system",
      initialPrompt: "start",
    }, {
      onSession: () => {},
      onActivity: () => {},
      onTrajectory: (entries) => {
        const text = entries.find((entry) => entry.kind === "text")?.text;
        if (text) resolveText(text);
      },
      onExit: resolveExit,
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any,
    });

    const text = await Promise.race([
      received,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("Codex UTF-8 fixture timed out")), 1_000)),
    ]);
    await Promise.race([
      exited,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("Codex UTF-8 fixture did not exit")), 1_000)),
    ]);
    session.stop();
    assert.equal(text, "中文测试");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
