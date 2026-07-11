import { spawn } from "node:child_process";
import type {
  DesktopChildProcess,
  DesktopChildSpawner,
  DesktopChildTerminator,
} from "./processSupervisorContract.js";

/** Production spawn adapter. Managed services may receive a private lifecycle IPC channel. */
export const spawnNodeChild: DesktopChildSpawner = (request) => spawn(
  request.command,
  [...request.args],
  {
    ...(request.cwd ? { cwd: request.cwd } : {}),
    env: request.env,
    stdio: request.ipc
      ? ["ignore", "inherit", "inherit", "ipc"]
      : ["ignore", "inherit", "inherit"],
    detached: process.platform !== "win32",
    windowsHide: true,
  },
);

function signalProcessTree(child: DesktopChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== "win32" && child.pid) {
    try { process.kill(-child.pid, signal); return; } catch { /* fall back to the direct child */ }
  }
  child.kill(signal);
}

function forceProcessTree(child: DesktopChildProcess, role: string): Promise<void> {
  if (process.platform !== "win32" || !child.pid) {
    signalProcessTree(child, "SIGKILL");
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", reject);
    killer.once("exit", (code) => {
      if (code === 0 || child.exitCode !== null) resolve();
      else reject(new Error(`${role} process tree could not be terminated (taskkill exit ${code ?? "null"})`));
    });
  });
}

export type NodeChildTerminatorOptions = Readonly<{
  gracefulTimeoutMs?: number;
  forcedTimeoutMs?: number;
}>;

/**
 * Cross-platform default: managed services get a graceful IPC request, then Unix process groups or the
 * Windows task tree are force-cleaned on timeout. Packaging may replace the seam without changing policy.
 */
export function createNodeChildTerminator(
  options: NodeChildTerminatorOptions = {},
): DesktopChildTerminator {
  const gracefulTimeoutMs = options.gracefulTimeoutMs ?? 5_000;
  const forcedTimeoutMs = options.forcedTimeoutMs ?? 1_000;
  if (gracefulTimeoutMs < 0 || forcedTimeoutMs < 0) throw new Error("termination timeouts cannot be negative");

  return async (child, role) => {
    if (child.exitCode !== null) return;
    await new Promise<void>((resolve, reject) => {
      let gracefulTimer: NodeJS.Timeout | undefined;
      let forcedTimer: NodeJS.Timeout | undefined;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (gracefulTimer) clearTimeout(gracefulTimer);
        if (forcedTimer) clearTimeout(forcedTimer);
        child.removeListener("exit", onExit);
        if (error) reject(error);
        else resolve();
      };
      const onExit = () => finish();
      child.once("exit", onExit);

      try {
        if (child.exitCode !== null) {
          finish();
          return;
        }
        if ((role === "core" || role === "worker") && child.send) {
          try {
            child.send({ type: "kith:shutdown" }, () => { /* timeout owns IPC delivery failures */ });
          } catch { /* timeout force-cleans the process tree */ }
        } else if (process.platform === "win32") {
          void forceProcessTree(child, role).catch((error) => finish(error));
        } else {
          signalProcessTree(child, "SIGTERM");
        }
        if (settled) return;
        gracefulTimer = setTimeout(() => {
          if (child.exitCode !== null) {
            finish();
            return;
          }
          try {
            void forceProcessTree(child, role).catch((error) => finish(error));
            if (settled) return;
            forcedTimer = setTimeout(
              () => finish(new Error(`${role} did not exit after SIGKILL`)),
              forcedTimeoutMs,
            );
          } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)));
          }
        }, gracefulTimeoutMs);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };
}

export const terminateNodeChild = createNodeChildTerminator();

export type { DesktopChildProcess };
