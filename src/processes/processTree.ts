import { spawn, type ChildProcess } from "node:child_process";

export type ProcessTreeTerminationOptions = Readonly<{
  gracefulTimeoutMs?: number;
  forcedTimeoutMs?: number;
  label?: string;
}>;

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The process may not own a process group; fall back to its direct PID.
    }
  }
  child.kill(signal);
}

function forceWindowsProcessTree(child: ChildProcess, label: string): Promise<void> {
  if (!child.pid || hasExited(child)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", reject);
    killer.once("exit", (code) => {
      if (code === 0 || hasExited(child)) resolve();
      else reject(new Error(`${label} process tree could not be terminated (taskkill exit ${code ?? "null"})`));
    });
  });
}

/**
 * Terminates a child and its descendants, resolving only after the direct child has exited.
 * Runtime launchers should use detached process groups on POSIX so descendants receive the signals.
 */
export function terminateProcessTree(
  child: ChildProcess,
  options: ProcessTreeTerminationOptions = {},
): Promise<void> {
  if (!child.pid || hasExited(child)) return Promise.resolve();
  const gracefulTimeoutMs = options.gracefulTimeoutMs ?? 2_000;
  const forcedTimeoutMs = options.forcedTimeoutMs ?? 1_000;
  const label = options.label ?? "child";
  if (gracefulTimeoutMs < 0 || forcedTimeoutMs < 0) {
    throw new Error("termination timeouts cannot be negative");
  }

  return new Promise((resolve, reject) => {
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

    const force = async () => {
      if (hasExited(child)) {
        finish();
        return;
      }
      try {
        if (process.platform === "win32") await forceWindowsProcessTree(child, label);
        else signalProcessTree(child, "SIGKILL");
      } catch (error) {
        try {
          child.kill("SIGKILL");
        } catch {
          finish(error instanceof Error ? error : new Error(String(error)));
          return;
        }
      }
      if (hasExited(child)) {
        finish();
        return;
      }
      forcedTimer = setTimeout(
        () => finish(new Error(`${label} did not exit after forced process-tree termination`)),
        forcedTimeoutMs,
      );
      forcedTimer.unref?.();
    };

    if (process.platform === "win32") {
      void force();
      return;
    }
    try {
      signalProcessTree(child, "SIGTERM");
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    gracefulTimer = setTimeout(() => void force(), gracefulTimeoutMs);
    gracefulTimer.unref?.();
  });
}
