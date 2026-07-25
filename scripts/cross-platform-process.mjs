import { closeSync, openSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import crossSpawn from "cross-spawn";

export const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

export function commandBelongsToRoot(command, root, platform = process.platform) {
  const normalizeCase = platform === "win32" ? (value) => value.toLowerCase() : (value) => value;
  const normalizedRoot = normalizeCase(String(root).replaceAll("\\", "/").replace(/\/+$/, ""));
  const normalizedCommand = normalizeCase(String(command).replaceAll("\\", "/"));
  return Boolean(normalizedRoot) && normalizedCommand.includes(`${normalizedRoot}/`);
}

export function runSync(command, args, options = {}) {
  const result = crossSpawn.sync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true,
    shell: false,
  });
  if (result.error) throw result.error;
  if (!options.allowFailure && result.status !== 0) {
    const detail = options.capture ? String(result.stderr || result.stdout || "").trim() : "";
    throw new Error(`${command} exited ${result.status ?? "without a status"}${detail ? `: ${detail}` : ""}`);
  }
  return result;
}

export function readEnvFile(filename) {
  const values = {};
  for (const line of readFileSync(filename, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    values[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1);
  }
  return values;
}

export function expandHome(value) {
  if (!value) return value;
  if (value === "~" || value === "$HOME") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(os.homedir(), value.slice(2));
  if (value.startsWith("$HOME/") || value.startsWith("$HOME\\")) return path.join(os.homedir(), value.slice(6));
  return value;
}

export function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !processExists(pid);
}

export async function terminatePidTree(pid, label = "process") {
  if (!processExists(pid)) return;
  if (process.platform === "win32") {
    const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0 && processExists(pid)) {
      throw new Error(`${label} process tree could not be terminated (taskkill exit ${result.status ?? "null"})`);
    }
    if (!await waitForExit(pid, 1_000)) throw new Error(`${label} did not exit after taskkill`);
    return;
  }
  try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch {} }
  if (await waitForExit(pid, 1_000)) return;
  try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch {} }
  if (!await waitForExit(pid, 1_000)) throw new Error(`${label} did not exit after SIGKILL`);
}

export function startDetached(command, args, options) {
  const output = openSync(options.logFile, "a");
  try {
    const child = crossSpawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ["ignore", output, output],
      windowsHide: true,
    });
    if (!child.pid) throw new Error(`${options.label} did not report a pid`);
    child.unref();
    return child.pid;
  } finally {
    closeSync(output);
  }
}

export async function findFreePort(start) {
  for (let port = start; port <= 65_535; port += 1) {
    const available = await new Promise((resolve) => {
      const server = net.createServer();
      server.unref();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error(`no free TCP port found from ${start}`);
}

export async function waitFor(check, timeoutMs, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

export function validatedWorktreeName(value) {
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error("worktree name must use letters, numbers, dot, underscore, or hyphen");
  }
  return value;
}
