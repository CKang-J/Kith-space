// Parser test for the OpenCode runtime's pure event mapping, run against REAL JSONL captured from
// opencode 1.15.5 (src/daemon/__fixtures__/opencode-*.jsonl). Run: `npx tsx --test src/daemon/opencodeRuntime.test.ts`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleOpencodeEvent, opencodeRuntime } from "./opencodeRuntime.js";

const here = path.dirname(fileURLToPath(import.meta.url));
function fixtureEvents(name: string): any[] {
  return readFileSync(path.join(here, "__fixtures__", name), "utf8")
    .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

test("happy stream: surfaces assistant text and captures the ses_ session id", () => {
  const events = fixtureEvents("opencode-happy.jsonl");
  const traj: any[] = [];
  let sessionId = "";
  let sawWorking = false;
  for (const e of events) {
    const emit = handleOpencodeEvent(e);
    traj.push(...emit.trajectory);
    if (emit.sessionId) sessionId = emit.sessionId;
    if (emit.activity?.activity === "working") sawWorking = true;
  }
  assert.ok(traj.some((t) => t.kind === "text" && t.text.includes("PONG")), "expected the PONG text entry");
  assert.match(sessionId, /^ses_/, "expected a ses_ session id captured from the event stream");
  assert.ok(sawWorking, "expected step_start to set working");
});

test("tool stream: tool_use becomes a tool entry with the bash command", () => {
  const events = fixtureEvents("opencode-tool.jsonl");
  const traj = events.flatMap((e) => handleOpencodeEvent(e).trajectory);
  const tool = traj.find((t) => t.kind === "tool");
  assert.ok(tool, "expected a tool trajectory entry");
  assert.equal(tool.toolName, "bash");
  assert.ok(tool.toolInput?.includes("ls"), "expected the summarized bash command");
  assert.ok(traj.some((t) => t.kind === "text" && t.text?.includes("done")), "expected the final text");
});

test("tool_use input is summarized from part.state.input", () => {
  const emit = handleOpencodeEvent({
    type: "tool_use",
    sessionID: "ses_x",
    part: { type: "tool", tool: "edit", state: { input: { filePath: "/srv/app.ts" } } },
  });
  assert.equal(emit.trajectory.length, 1);
  assert.equal(emit.trajectory[0]?.kind, "tool");
  assert.equal(emit.trajectory[0]?.toolName, "edit");
  assert.ok(emit.trajectory[0]?.toolInput?.includes("/srv/app.ts"));
});

test("a model error event (type=error, opencode exits 0) is surfaced, not swallowed", () => {
  const emit = handleOpencodeEvent({ type: "error", sessionID: "ses_x", error: { name: "ProviderError", data: { message: "rate limited" } } });
  assert.match(emit.error ?? "", /rate limited/);
  assert.equal(emit.trajectory.length, 0);
});

test("reasoning maps to thinking; empty text is skipped; lifecycle events are silent", () => {
  assert.deepEqual(handleOpencodeEvent({ type: "reasoning", part: { text: "pondering" } }).trajectory,
    [{ kind: "thinking", text: "pondering" }]);
  assert.equal(handleOpencodeEvent({ type: "text", part: { text: "" } }).trajectory.length, 0);
  const fin = handleOpencodeEvent({ type: "step_finish", sessionID: "ses_y", part: { type: "step-finish" } });
  assert.equal(fin.trajectory.length, 0);
  assert.equal(fin.activity, undefined);
  assert.equal(fin.sessionId, "ses_y"); // session id is still captured from any event
});

test("OpenCode launches with the official auto flag and an explicit model", { skip: process.platform !== "win32" }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-space-opencode-args-"));
  const argsFile = path.join(root, "args.txt");
  writeFileSync(path.join(root, "opencode.cmd"), `@echo off\r\necho %* > "${argsFile}"\r\nexit /b 0\r\n`);

  try {
    const session = opencodeRuntime.start({
      cwd: root,
      env: { ...process.env, PATH: root },
      model: "deepseek/deepseek-chat",
      systemPrompt: "system",
      initialPrompt: "start",
    }, {
      onSession: () => {},
      onActivity: () => {},
      onTrajectory: () => {},
      onExit: () => {},
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any,
    });

    const deadline = Date.now() + 1_000;
    while (!existsSync(argsFile) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    session.stop();

    const args = readFileSync(argsFile, "utf8");
    assert.match(args, /--auto/);
    assert.match(args, /--model/);
    assert.match(args, /deepseek\/deepseek-chat/);
    assert.doesNotMatch(args, /dangerously-skip-permissions/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenCode refuses to start without an explicit provider/model", async () => {
  const trajectories: string[] = [];
  let exitCode: number | null | undefined;
  let resolveExit!: () => void;
  const exited = new Promise<void>((resolve) => { resolveExit = resolve; });

  const session = opencodeRuntime.start({
    cwd: here,
    env: { PATH: "" },
    systemPrompt: "system",
    initialPrompt: "start",
  }, {
    onSession: () => {},
    onActivity: () => {},
    onTrajectory: (entries) => trajectories.push(...entries.map((entry) => entry.text ?? "")),
    onExit: (code) => { exitCode = code; resolveExit(); },
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any,
  });
  assert.equal(exitCode, undefined, "the adapter must not exit synchronously before AgentManager finishes start bookkeeping");
  await exited;
  session.stop();

  assert.equal(exitCode, 1);
  assert.match(trajectories.join("\n"), /explicit provider\/model/i);
});

test("OpenCode reports one model-qualified error instead of a second blank error", { skip: process.platform !== "win32" }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-space-opencode-error-"));
  writeFileSync(
    path.join(root, "opencode.cmd"),
    '@echo off\r\necho {"type":"error","error":{"data":{"message":"Invalid API Key"}}}\r\nexit /b 1\r\n',
  );
  const trajectories: string[] = [];
  let resolveExit!: (code: number | null) => void;
  const exited = new Promise<number | null>((resolve) => { resolveExit = resolve; });

  try {
    opencodeRuntime.start({
      cwd: root,
      env: { ...process.env, PATH: root },
      model: "deepseek/deepseek-chat",
      systemPrompt: "system",
      initialPrompt: "start",
    }, {
      onSession: () => {},
      onActivity: () => {},
      onTrajectory: (entries) => trajectories.push(...entries.map((entry) => entry.text ?? "")),
      onExit: resolveExit,
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any,
    });

    await Promise.race([
      exited,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("opencode error shim did not exit")), 1_000)),
    ]);

    const errors = trajectories.filter((entry) => entry.startsWith("[opencode error]"));
    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /deepseek\/deepseek-chat/);
    assert.match(errors[0]!, /Invalid API Key/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenCode keeps an error terminal when an older CLI exits zero after an error event", { skip: process.platform !== "win32" }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-space-opencode-error-zero-"));
  writeFileSync(
    path.join(root, "opencode.cmd"),
    '@echo off\r\necho {"type":"error","error":{"data":{"message":"Invalid API Key"}}}\r\nexit /b 0\r\n',
  );
  const activities: string[] = [];
  let resolveExit!: (code: number | null) => void;
  const exited = new Promise<number | null>((resolve) => { resolveExit = resolve; });

  try {
    opencodeRuntime.start({
      cwd: root,
      env: { ...process.env, PATH: root },
      model: "deepseek/deepseek-chat",
      systemPrompt: "system",
      initialPrompt: "start",
    }, {
      onSession: () => {},
      onActivity: (activity) => activities.push(activity),
      onTrajectory: () => {},
      onExit: resolveExit,
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any,
    });

    const exitCode = await Promise.race([
      exited,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 250)),
    ]);
    assert.equal(exitCode, 1);
    assert.equal(activities.at(-1), "error");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
