import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const prepareChatScript = path.join(repositoryRoot, "scripts/p-a9/prepare-chat-baseline.ts");
const runtimeSmokeScript = path.join(repositoryRoot, "scripts/p-a9/runtime-cli-smoke.ps1");
const powershell = path.join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32/WindowsPowerShell/v1.0/powershell.exe",
);
const windowsPowerShellOnly = process.platform === "win32" ? false : "requires Windows PowerShell";

test("P-A9 Chat fixture rejects an existing profile before writing anything", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-space-p-a9-profile-guard-"));
  const profile = path.join(root, "existing-profile");
  mkdirSync(profile);
  writeFileSync(path.join(profile, "sentinel.txt"), "keep");

  try {
    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      prepareChatScript,
      "--profile",
      profile,
    ], {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 20_000,
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /profile.*must not already exist/i);
    assert.deepEqual(readdirSync(profile), ["sentinel.txt"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("P-A9 Chat fixture creates paired first-visible channels and accepts an explicit token", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-space-p-a9-paired-fixture-"));
  const profile = path.join(root, "new-profile");
  const accessToken = "explicit-p-a9-browser-token";

  try {
    const result = runPrepareChat(profile, accessToken);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout) as ChatFixtureReport;
    assert.equal(report.accessToken, accessToken);
    assert.deepEqual(report.channels, report.channelPairs.map(({ a }) => a));
    assert.deepEqual(report.channelPairs.map(({ messageCount }) => messageCount), [100, 500, 1000]);
    for (const pair of report.channelPairs) {
      assert.equal(pair.a.messageCount, pair.messageCount);
      assert.equal(pair.b.messageCount, pair.messageCount);
      assert.notEqual(pair.a.id, pair.b.id);
      assert.notEqual(pair.a.targetText, pair.b.targetText);
      assert.match(pair.a.targetText, new RegExp(`message ${pair.messageCount}:`));
      assert.match(pair.b.targetText, new RegExp(`message ${pair.messageCount}:`));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("P-A9 Chat fixture default token is generated from cryptographic randomness", () => {
  const source = readFileSync(prepareChatScript, "utf8");
  assert.match(source, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.doesNotMatch(source, /p-a9-browser-baseline-token/);
});

test("P-A9 CLI smoke discovers PATH script wrappers", { skip: windowsPowerShellOnly }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-space-p-a9-cli-discovery-"));
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  writeVersionWrapper(bin, "claude", "fake-claude");
  writeVersionWrapper(bin, "codex", "fake-codex");
  writeVersionWrapper(bin, "opencode", "fake-opencode");

  try {
    const result = runRuntimeSmoke(bin, root, 5);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout) as RuntimeSmokeReport;
    assert.deepEqual(report.results.map(({ name }) => name), ["claude", "codex", "opencode"]);
    assert.deepEqual(
      report.results.map(({ samples }) => samples[0]?.version),
      ["fake-claude", "fake-codex", "fake-opencode"],
    );
    assert.ok(report.results.every(({ samples }) => samples[0]?.timedOut === false));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("P-A9 CLI smoke records a total timeout and exits unsuccessfully", { skip: windowsPowerShellOnly }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-space-p-a9-cli-timeout-"));
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "claude.cmd"), "@echo off\r\nping 127.0.0.1 -n 6 >nul\r\necho too-late\r\n");
  writeVersionWrapper(bin, "codex", "fake-codex");
  writeVersionWrapper(bin, "opencode", "fake-opencode");

  try {
    const startedAt = performance.now();
    const result = runRuntimeSmoke(bin, root, 1);
    const elapsedMs = performance.now() - startedAt;
    assert.equal(result.status, 1, result.stderr);
    assert.ok(elapsedMs < 4_000, `timeout took ${elapsedMs.toFixed(0)}ms`);
    const report = JSON.parse(result.stdout) as RuntimeSmokeReport;
    const claude = report.results.find(({ name }) => name === "claude");
    assert.equal(claude?.samples[0]?.timedOut, true);
    assert.match(claude?.samples[0]?.failure ?? "", /timed out after 1 second/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function writeVersionWrapper(bin: string, name: string, version: string): void {
  writeFileSync(path.join(bin, `${name}.cmd`), `@echo off\r\necho ${version}\r\n`);
}

function runPrepareChat(profile: string, accessToken?: string) {
  const args = ["--import", "tsx", prepareChatScript, "--profile", profile];
  if (accessToken) args.push("--access-token", accessToken);
  return spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 20_000,
  });
}

function runRuntimeSmoke(bin: string, appData: string, timeoutSeconds: number) {
  return spawnSync(powershell, [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    runtimeSmokeScript,
    "-Rounds",
    "1",
    "-TimeoutSeconds",
    String(timeoutSeconds),
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      APPDATA: appData,
      PATH: `${bin};${process.env.PATH ?? ""}`,
    },
    timeout: 20_000,
  });
}

interface RuntimeSmokeReport {
  results: Array<{
    name: string;
    samples: Array<{
      version: string;
      timedOut: boolean;
      failure: string | null;
    }>;
  }>;
}

interface ChatFixtureReport {
  accessToken: string;
  channels: ChatFixtureChannel[];
  channelPairs: Array<{
    messageCount: number;
    a: ChatFixtureChannel;
    b: ChatFixtureChannel;
  }>;
}

interface ChatFixtureChannel {
  id: string;
  name: string;
  messageCount: number;
  targetText: string;
}
