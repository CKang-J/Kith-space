import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { codexRuntime } from "./codexRuntime.js";
import { opencodeRuntime } from "./opencodeRuntime.js";

const logger = { debug() {}, info() {}, warn() {}, error() {} } as any;

function writeNodeShim(root: string, command: string, source: string): void {
  const script = path.join(root, `${command}-fixture.mjs`);
  writeFileSync(script, source);
  if (process.platform === "win32") {
    writeFileSync(path.join(root, `${command}.cmd`), `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    return;
  }
  const shim = path.join(root, command);
  writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
  chmodSync(shim, 0o755);
}

function fixtureEnv(root: string, logFile: string): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${root}${path.delimiter}${process.env.PATH ?? ""}`, KITH_FIXTURE_LOG: logFile };
}

test("Codex v1 fixture freezes the persistent two-turn process shape", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-codex-contract-"));
  const logFile = path.join(root, "invocations.jsonl");
  writeNodeShim(root, "codex", String.raw`
import { appendFileSync } from "node:fs";
appendFileSync(process.env.KITH_FIXTURE_LOG, JSON.stringify({ pid: process.pid, args: process.argv.slice(2) }) + "\n");
let input = "";
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  const lines = input.split("\n");
  input = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    if (request.method === "initialize") send({ jsonrpc: "2.0", id: request.id, result: {} });
    else if (request.method === "thread/start") send({ jsonrpc: "2.0", id: request.id, result: { thread: { id: "thread-contract" } } });
    else if (request.method === "turn/start") {
      send({ jsonrpc: "2.0", id: request.id, result: {} });
      send({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: "thread-contract", turn: { status: "completed" } } });
    }
  }
});
`);

  try {
    let onlineCount = 0;
    let sessionId = "";
    let session: ReturnType<typeof codexRuntime.start>;
    const completed = new Promise<void>((resolve) => {
      session = codexRuntime.start({
        cwd: root,
        env: fixtureEnv(root, logFile),
        systemPrompt: "system",
        initialPrompt: "first",
      }, {
        onSession(value) { sessionId = value ?? ""; },
        onActivity(activity) {
          if (activity !== "online") return;
          onlineCount += 1;
          if (onlineCount === 1) session.deliver("second");
          if (onlineCount === 2) resolve();
        },
        onTrajectory() {},
        onExit() {},
        log: logger,
      });
    });
    await Promise.race([
      completed,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("Codex contract fixture timed out")), 2_000)),
    ]);
    session!.stop();

    const invocations = readFileSync(logFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(invocations.length, 1, "both turns must use the same app-server process");
    assert.equal(sessionId, "thread-contract");
    assert.equal(onlineCount, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenCode v1 fixture freezes one process per turn with session resume argv", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-opencode-contract-"));
  const logFile = path.join(root, "invocations.jsonl");
  writeNodeShim(root, "opencode", String.raw`
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.KITH_FIXTURE_LOG, JSON.stringify({ pid: process.pid, args }) + "\n");
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
send({ type: "step_start", sessionID: "ses_contract", part: { type: "step-start" } });
send({ type: "text", sessionID: "ses_contract", part: { type: "text", text: "done" } });
send({ type: "step_finish", sessionID: "ses_contract", part: { type: "step-finish", tokens: { input: 1, output: 1 } } });
`);

  try {
    let onlineCount = 0;
    let session: ReturnType<typeof opencodeRuntime.start>;
    const completed = new Promise<void>((resolve) => {
      session = opencodeRuntime.start({
        cwd: root,
        env: fixtureEnv(root, logFile),
        model: "test/model",
        systemPrompt: "system",
        initialPrompt: "first",
      }, {
        onSession() {},
        onActivity(activity) {
          if (activity !== "online") return;
          onlineCount += 1;
          if (onlineCount === 1) session.deliver("second");
          if (onlineCount === 2) resolve();
        },
        onTrajectory() {},
        onExit() {},
        log: logger,
      });
    });
    await Promise.race([
      completed,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("OpenCode contract fixture timed out")), 2_000)),
    ]);
    session!.stop();

    const invocations = readFileSync(logFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(invocations.length, 2, "each turn must spawn a new opencode process");
    assert.ok(invocations[1].args.includes("--session"));
    assert.ok(invocations[1].args.includes("ses_contract"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
