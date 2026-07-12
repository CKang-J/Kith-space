import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { detectRuntimes } from "./runtimes.js";

test("Windows runtime detection recognizes launchable npm cmd shims", { skip: process.platform !== "win32" }, () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-space-runtime-detect-"));

  try {
    for (const runtime of ["claude", "codex", "opencode"]) {
      writeFileSync(path.join(root, `${runtime}.cmd`), "@echo off\r\nexit /b 0\r\n");
    }
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => name.toUpperCase() !== "PATH"),
    ) as NodeJS.ProcessEnv;
    env.PATH = root;
    assert.deepEqual(detectRuntimes(env), ["claude", "codex", "opencode"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
