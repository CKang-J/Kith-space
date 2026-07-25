import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { managedRuntimeExecutable, withManagedRuntimePath } from "./runtimeSetupCatalog.js";
import { runRuntimeSetupCommand, RuntimeSetupService } from "./runtimeSetupService.js";

function withTemporaryHome(run: (root: string) => Promise<void> | void) {
  const previous = process.env.KITH_SPACE_HOME;
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-runtime-setup-"));
  process.env.KITH_SPACE_HOME = root;
  return Promise.resolve(run(root)).finally(() => {
    if (previous === undefined) delete process.env.KITH_SPACE_HOME;
    else process.env.KITH_SPACE_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  });
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function forceKillFixture(pid: number): void {
  if (!processExists(pid)) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try { process.kill(pid, "SIGKILL"); } catch { /* fixture already exited */ }
}

test("runtime command timeout waits until the command and its descendants exit", { timeout: 5_000 }, () => withTemporaryHome(async (root) => {
  const pidFile = path.join(root, "runtime-command-pids.json");
  const childScript = path.join(root, "runtime-command-child.mjs");
  const parentScript = path.join(root, "runtime-command-parent.mjs");
  writeFileSync(childScript, "setInterval(() => {}, 1000);\n");
  writeFileSync(parentScript, [
    "import { spawn } from 'node:child_process';",
    "import { writeFileSync } from 'node:fs';",
    "const child = spawn(process.execPath, [process.argv[3]], { stdio: 'ignore' });",
    "writeFileSync(process.argv[2], JSON.stringify({ parent: process.pid, child: child.pid }));",
    "process.on('SIGTERM', () => {});",
    "setInterval(() => {}, 1000);",
  ].join("\n"));

  const resultPromise = runRuntimeSetupCommand(
    process.execPath,
    [parentScript, pidFile, childScript],
    { timeoutMs: 100 },
  );
  const readyDeadline = Date.now() + 2_000;
  while (!existsSync(pidFile) && Date.now() < readyDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(existsSync(pidFile), true);
  const fixture = JSON.parse(readFileSync(pidFile, "utf8")) as { parent: number; child: number };
  try {
    const result = await resultPromise;
    assert.match(result.error?.message ?? "", /timed out/);
    assert.equal(processExists(fixture.parent), false);
    assert.equal(processExists(fixture.child), false);
  } finally {
    forceKillFixture(fixture.parent);
    forceKillFixture(fixture.child);
  }
}));

test("managed runtime path entries take precedence without deleting the user's PATH", () => withTemporaryHome(() => {
  const source = ["/usr/local/bin", "/usr/bin"].join(path.delimiter);
  const result = withManagedRuntimePath(source).split(path.delimiter);
  assert.equal(result.at(-2), "/usr/local/bin");
  assert.equal(result.at(-1), "/usr/bin");
  assert.ok(result[0]?.includes("managed-runtimes"));
}));

test("runtime setup separates installation, version and account readiness", () => withTemporaryHome(async () => {
  const executable = managedRuntimeExecutable("claude");
  mkdirSync(path.dirname(executable), { recursive: true });
  writeFileSync(executable, "#!/bin/sh\nexit 0\n");
  chmodSync(executable, 0o755);
  const service = new RuntimeSetupService(async (command, args) => {
    assert.equal(command, executable);
    if (args[0] === "--version") return { status: 0, stdout: "2.1.214 (Claude Code)\n", stderr: "" };
    return { status: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: "oauth_token" }), stderr: "" };
  }, {} as any);
  const snapshot = await service.inspect("claude");
  assert.equal(snapshot.installation.state, "installed");
  assert.equal(snapshot.installation.source, "kith_managed");
  assert.equal(snapshot.installation.version, "2.1.214 (Claude Code)");
  assert.deepEqual(snapshot.account, {
    state: "ready",
    label: "已登录 Anthropic 账号",
    help: "使用 Anthropic 账号登录，或通过 Kith 模型配置提供连接。",
    loginCommand: "claude login",
  });
}));

test("runtime setup does not mistake negative or ambiguous auth output for ready", () => withTemporaryHome(async () => {
  for (const runtimeId of ["codex", "opencode", "pi"] as const) {
    const executable = managedRuntimeExecutable(runtimeId);
    mkdirSync(path.dirname(executable), { recursive: true });
    writeFileSync(executable, "#!/bin/sh\nexit 0\n");
    chmodSync(executable, 0o755);
    const service = new RuntimeSetupService(async (_command, args) => {
      if (args[0] === "--version") return { status: 0, stdout: "1.0.0\n", stderr: "" };
      if (runtimeId === "codex") return { status: 1, stdout: "", stderr: "Not logged in" };
      if (runtimeId === "opencode") return { status: 0, stdout: "0 credentials", stderr: "" };
      return { status: 0, stdout: "provider model\nexample model", stderr: "" };
    }, {} as any);
    const snapshot = await service.inspect(runtimeId, true);
    assert.notEqual(snapshot.account.state, "ready");
  }
}));

test("managed installation is pinned, recorded and removable without touching system CLIs", () => withTemporaryHome(async () => {
  const updates: Array<{ runtimeId: string; executablePreference: string | null }> = [];
  let executablePreference: string | null = null;
  const profiles = {
    get() {
      return {
        enabled: true,
        defaultBinding: { mode: "unset", modelConfigurationId: null, modelConfigurationRevision: null },
        executablePreference,
        runtimeOptions: {},
      };
    },
    async update(runtimeId: string, input: any) {
      executablePreference = input.executablePreference;
      updates.push({ runtimeId, executablePreference: input.executablePreference });
    },
  };
  const runner = async (command: string, args: readonly string[]) => {
    if (command.endsWith("npm") || command.endsWith("npm.cmd")) {
      assert.ok(args.includes("@openai/codex@0.144.6"));
      const prefix = String(args[args.indexOf("--prefix") + 1]);
      const executable = path.join(prefix, "node_modules", ".bin", process.platform === "win32" ? "codex.cmd" : "codex");
      mkdirSync(path.dirname(executable), { recursive: true });
      writeFileSync(executable, "#!/bin/sh\nexit 0\n");
      chmodSync(executable, 0o755);
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "--version") return { status: 0, stdout: "codex-cli 0.144.6\n", stderr: "" };
    return { status: 0, stdout: "Logged in using ChatGPT\n", stderr: "" };
  };
  const service = new RuntimeSetupService(runner, profiles as any);
  const installed = await service.install("codex");
  assert.equal(installed.installation.source, "kith_managed");
  assert.equal(updates[0]?.executablePreference, managedRuntimeExecutable("codex"));
  await service.removeManaged("codex");
  assert.equal(updates[1]?.executablePreference, null);
}));

test("managed removal preserves an unrelated custom executable preference", () => withTemporaryHome(async () => {
  const executable = managedRuntimeExecutable("pi");
  mkdirSync(path.dirname(executable), { recursive: true });
  writeFileSync(executable, "#!/bin/sh\nexit 0\n");
  chmodSync(executable, 0o755);
  let updated = false;
  const profiles = {
    get() {
      return {
        enabled: true,
        defaultBinding: { mode: "unset", modelConfigurationId: null, modelConfigurationRevision: null },
        executablePreference: "/custom/pi",
        runtimeOptions: {},
      };
    },
    async update() {
      updated = true;
    },
  };
  const service = new RuntimeSetupService(async () => ({ status: 0, stdout: "", stderr: "" }), profiles as any);
  await service.removeManaged("pi");
  assert.equal(updated, false);
}));

test("failed managed installation leaves the existing runtime and profile untouched", () => withTemporaryHome(async () => {
  const executable = managedRuntimeExecutable("opencode");
  mkdirSync(path.dirname(executable), { recursive: true });
  writeFileSync(executable, "existing-runtime");
  let updated = false;
  const profiles = {
    get() {
      return {
        enabled: true,
        defaultBinding: { mode: "unset", modelConfigurationId: null, modelConfigurationRevision: null },
        executablePreference: executable,
        runtimeOptions: {},
      };
    },
    async update() {
      updated = true;
    },
  };
  const service = new RuntimeSetupService(async () => ({
    status: 1,
    stdout: "",
    stderr: "registry unavailable",
  }), profiles as any);
  await assert.rejects(() => service.install("opencode"), /安装失败/);
  assert.equal(readFileSync(executable, "utf8"), "existing-runtime");
  assert.equal(updated, false);
}));
