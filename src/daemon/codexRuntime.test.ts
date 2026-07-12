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
