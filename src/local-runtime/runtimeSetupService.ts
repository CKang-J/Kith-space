import { mkdir, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import crossSpawn from "cross-spawn";
import { resolveExecutable } from "../advisor-provider/providerArtifact.js";
import { RuntimeProfileService } from "../model-control/runtimeProfileService.js";
import { managedRuntimesDir } from "../paths.js";
import {
  managedRuntimeExecutable,
  managedRuntimePrefix,
  runtimeSetupDefinition,
  type SetupRuntimeId,
} from "./runtimeSetupCatalog.js";

type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: { env?: NodeJS.ProcessEnv; timeoutMs?: number },
) => Promise<CommandResult>;

const MAX_OUTPUT_BYTES = 1024 * 1024;

const defaultRunner: CommandRunner = (command, args, options = {}) => new Promise((resolve) => {
  const child = crossSpawn(command, [...args], {
    detached: process.platform !== "win32",
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  let error: Error | undefined;
  let settled = false;
  let killTimer: NodeJS.Timeout | undefined;
  const append = (current: string, chunk: Buffer | string) => {
    if (Buffer.byteLength(current) >= MAX_OUTPUT_BYTES) return current;
    return `${current}${String(chunk)}`.slice(0, MAX_OUTPUT_BYTES);
  };
  const finish = (status: number | null) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (killTimer) clearTimeout(killTimer);
    resolve({ status, stdout, stderr, ...(error ? { error } : {}) });
  };
  const stop = (signal: NodeJS.Signals) => {
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      // The process may have exited between the timeout and signal.
    }
  };
  child.stdout?.on("data", (chunk) => { stdout = append(stdout, chunk); });
  child.stderr?.on("data", (chunk) => { stderr = append(stderr, chunk); });
  child.once("error", (cause) => {
    error = cause;
    finish(null);
  });
  const timeout = setTimeout(() => {
    error = new Error(`command timed out after ${options.timeoutMs ?? 10_000}ms`);
    stop("SIGTERM");
    killTimer = setTimeout(() => {
      stop("SIGKILL");
      finish(null);
    }, 1_000);
    killTimer.unref?.();
  }, options.timeoutMs ?? 10_000);
  timeout.unref?.();
  child.once("close", finish);
});

const setupSnapshotCache = new Map<string, {
  promise: Promise<RuntimeSetupSnapshot>;
  createdAt: number;
  expiresAt: number;
}>();
const runtimeMutations = new Map<SetupRuntimeId, Promise<RuntimeSetupSnapshot>>();
const FORCE_PROBE_COOLDOWN_MS = 10_000;

export class RuntimeSetupError extends Error {
  constructor(readonly code: "runtime_install_failed" | "runtime_path_invalid") {
    super(code === "runtime_install_failed"
      ? "安装失败。请检查网络或 npm 配置后重试；原有运行器没有被修改。"
      : "Kith 拒绝操作不安全的运行器目录。");
    this.name = "RuntimeSetupError";
  }
}

function stripControlCharacters(value: string): string {
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[^\P{C}\n\t]/gu, "")
    .trim();
}

function firstUsefulLine(value: string): string | null {
  return stripControlCharacters(value).split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

async function accountState(runtimeId: SetupRuntimeId, executable: string, runner: CommandRunner) {
  const probe = runtimeId === "claude"
    ? await runner(executable, ["auth", "status"])
    : runtimeId === "codex"
      ? await runner(executable, ["login", "status"])
      : runtimeId === "opencode"
        ? await runner(executable, ["auth", "list"])
        : await runner(executable, ["--list-models"]);
  const output = stripControlCharacters(`${probe.stdout}\n${probe.stderr}`);
  if (runtimeId === "claude") {
    try {
      const parsed = JSON.parse(probe.stdout) as { loggedIn?: unknown; authMethod?: unknown };
      return parsed.loggedIn === true
        ? { state: "ready" as const, label: "已登录 Anthropic 账号" }
        : { state: "signed_out" as const, label: "尚未登录" };
    } catch {
      return { state: "unknown" as const, label: "无法确认登录状态" };
    }
  }
  if (runtimeId === "codex") {
    if (/not logged in|signed out/i.test(output)) return { state: "signed_out" as const, label: "尚未登录" };
    if (/logged in/i.test(output)) return { state: "ready" as const, label: "已登录 ChatGPT 账号" };
  }
  if (runtimeId === "opencode") {
    if (/\b(?:0|no)\s+credentials?\b/i.test(output)) {
      return { state: "signed_out" as const, label: "尚未配置供应商凭据" };
    }
    if (probe.status === 0 && /\b[1-9]\d*\s+credentials?\b/i.test(output)) {
      return { state: "ready" as const, label: "已找到本机凭据" };
    }
  }
  if (runtimeId === "pi") {
    if (probe.status === 0 && output.split(/\r?\n/).length > 1) {
      return { state: "unknown" as const, label: "模型目录可读取，凭据待确认" };
    }
  }
  return probe.status === 0
    ? { state: "unknown" as const, label: "需要在首次使用时确认" }
    : { state: "signed_out" as const, label: "需要登录或配置模型" };
}

export interface RuntimeSetupSnapshot {
  runtimeId: SetupRuntimeId;
  label: string;
  summary: string;
  installation: {
    state: "installed" | "not_installed";
    source: "kith_managed" | "system" | null;
    version: string | null;
    executablePath: string | null;
    testedVersion: string;
  };
  account: {
    state: "ready" | "signed_out" | "unknown";
    label: string;
    help: string;
    loginCommand: string;
  };
  managedInstall: {
    packageName: string;
    canInstall: true;
    canRemove: boolean;
    restartRequiredAfterChange: true;
  };
}

export class RuntimeSetupService {
  constructor(
    private readonly runner: CommandRunner = defaultRunner,
    private readonly profiles = new RuntimeProfileService(),
  ) {}

  async inspect(runtimeId: SetupRuntimeId, force = false): Promise<RuntimeSetupSnapshot> {
    const cacheKey = `${runtimeId}\u0000${managedRuntimePrefix(runtimeId)}\u0000${process.env.PATH ?? ""}`;
    const cached = setupSnapshotCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now
      && (!force || now - cached.createdAt < FORCE_PROBE_COOLDOWN_MS)) {
      return cached.promise;
    }
    const promise = this.inspectUncached(runtimeId);
    setupSnapshotCache.set(cacheKey, { promise, createdAt: now, expiresAt: now + 30_000 });
    try {
      return await promise;
    } catch (error) {
      setupSnapshotCache.delete(cacheKey);
      throw error;
    }
  }

  private async inspectUncached(runtimeId: SetupRuntimeId): Promise<RuntimeSetupSnapshot> {
    const definition = runtimeSetupDefinition(runtimeId);
    const managedExecutable = managedRuntimeExecutable(runtimeId);
    const managed = existsSync(managedExecutable);
    const executable = managed ? managedExecutable : resolveExecutable(definition.command);
    if (!executable) {
      const snapshot: RuntimeSetupSnapshot = {
        runtimeId,
        label: definition.label,
        summary: definition.summary,
        installation: {
          state: "not_installed",
          source: null,
          version: null,
          executablePath: null,
          testedVersion: definition.testedVersion,
        },
        account: {
          state: "unknown",
          label: "安装后检查",
          help: definition.accountHelp,
          loginCommand: definition.loginCommand,
        },
        managedInstall: {
          packageName: definition.packageName,
          canInstall: true,
          canRemove: false,
          restartRequiredAfterChange: true,
        },
      };
      return snapshot;
    }
    const [version, account] = await Promise.all([
      this.runner(executable, ["--version"]),
      accountState(runtimeId, executable, this.runner),
    ]);
    const snapshot: RuntimeSetupSnapshot = {
      runtimeId,
      label: definition.label,
      summary: definition.summary,
      installation: {
        state: "installed",
        source: managed ? "kith_managed" : "system",
        version: firstUsefulLine(`${version.stdout}\n${version.stderr}`),
        executablePath: path.resolve(executable),
        testedVersion: definition.testedVersion,
      },
      account: {
        ...account,
        help: definition.accountHelp,
        loginCommand: definition.loginCommand,
      },
      managedInstall: {
        packageName: definition.packageName,
        canInstall: true,
        canRemove: managed,
        restartRequiredAfterChange: true,
      },
    };
    return snapshot;
  }

  async install(runtimeId: SetupRuntimeId): Promise<RuntimeSetupSnapshot> {
    return this.serializeMutation(runtimeId, () => this.installUnlocked(runtimeId));
  }

  private async installUnlocked(runtimeId: SetupRuntimeId): Promise<RuntimeSetupSnapshot> {
    const definition = runtimeSetupDefinition(runtimeId);
    const prefix = managedRuntimePrefix(runtimeId);
    const parent = path.resolve(managedRuntimesDir());
    const resolvedPrefix = path.resolve(prefix);
    if (path.dirname(resolvedPrefix) !== parent) throw new RuntimeSetupError("runtime_path_invalid");
    await mkdir(parent, { recursive: true });
    const nonce = randomUUID();
    const staging = path.join(parent, `.${runtimeId}.install-${nonce}`);
    const backup = path.join(parent, `.${runtimeId}.backup-${nonce}`);
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = await this.runner(npm, [
      "install",
      "--prefix", staging,
      "--no-audit",
      "--no-fund",
      ...(definition.installExtraArgs ?? []),
      `${definition.packageName}@${definition.testedVersion}`,
    ], { timeoutMs: 180_000 });
    const stagedExecutable = path.join(staging, path.relative(prefix, managedRuntimeExecutable(runtimeId)));
    if (result.error || result.status !== 0 || !existsSync(stagedExecutable)) {
      await rm(staging, { recursive: true, force: true });
      throw new RuntimeSetupError("runtime_install_failed");
    }
    const hadExisting = existsSync(resolvedPrefix);
    if (hadExisting) await rename(resolvedPrefix, backup);
    let promoted = false;
    try {
      await rename(staging, resolvedPrefix);
      promoted = true;
      await this.selectManagedExecutable(runtimeId);
      await rm(backup, { recursive: true, force: true });
    } catch (error) {
      if (promoted) await rm(resolvedPrefix, { recursive: true, force: true });
      if (hadExisting && existsSync(backup)) await rename(backup, resolvedPrefix);
      throw error;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
    setupSnapshotCache.clear();
    return this.inspect(runtimeId, true);
  }

  async removeManaged(runtimeId: SetupRuntimeId): Promise<RuntimeSetupSnapshot> {
    return this.serializeMutation(runtimeId, () => this.removeManagedUnlocked(runtimeId));
  }

  private async removeManagedUnlocked(runtimeId: SetupRuntimeId): Promise<RuntimeSetupSnapshot> {
    const prefix = path.resolve(managedRuntimePrefix(runtimeId));
    const parent = path.resolve(managedRuntimesDir());
    if (path.dirname(prefix) !== parent) {
      throw new RuntimeSetupError("runtime_path_invalid");
    }
    const managedExecutable = managedRuntimeExecutable(runtimeId);
    const current = this.profiles.get(runtimeId);
    if (!existsSync(prefix)) {
      if (current.executablePreference === managedExecutable) await this.saveExecutable(runtimeId, null);
      setupSnapshotCache.clear();
      return this.inspect(runtimeId, true);
    }
    const trash = path.join(parent, `.${runtimeId}.remove-${randomUUID()}`);
    await rename(prefix, trash);
    try {
      if (current.executablePreference === managedExecutable) await this.saveExecutable(runtimeId, null);
      await rm(trash, { recursive: true, force: true });
    } catch (error) {
      if (!existsSync(prefix) && existsSync(trash)) await rename(trash, prefix);
      throw error;
    }
    setupSnapshotCache.clear();
    return this.inspect(runtimeId, true);
  }

  private serializeMutation(
    runtimeId: SetupRuntimeId,
    operation: () => Promise<RuntimeSetupSnapshot>,
  ): Promise<RuntimeSetupSnapshot> {
    const previous = runtimeMutations.get(runtimeId);
    const current = (previous ? previous.catch(() => undefined) : Promise.resolve())
      .then(operation);
    runtimeMutations.set(runtimeId, current);
    void current.finally(() => {
      if (runtimeMutations.get(runtimeId) === current) runtimeMutations.delete(runtimeId);
    }).catch(() => {});
    return current;
  }

  private async saveExecutable(runtimeId: SetupRuntimeId, executablePreference: string | null): Promise<void> {
    const current = this.profiles.get(runtimeId);
    await this.profiles.update(runtimeId, {
      enabled: current.enabled,
      defaultBinding: current.defaultBinding,
      executablePreference,
      runtimeOptions: current.runtimeOptions,
    });
  }

  private async selectManagedExecutable(runtimeId: SetupRuntimeId): Promise<void> {
    const current = this.profiles.get(runtimeId);
    const managedExecutable = managedRuntimeExecutable(runtimeId);
    if (current.executablePreference && current.executablePreference !== managedExecutable) return;
    await this.saveExecutable(runtimeId, managedExecutable);
  }
}
