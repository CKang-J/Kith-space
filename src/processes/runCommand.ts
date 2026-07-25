import crossSpawn from "cross-spawn";
import { terminateProcessTree } from "./processTree.js";

export type CommandResult = Readonly<{
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}>;

export type RunCommandOptions = Readonly<{
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputBytes?: number;
}>;

/**
 * Runs a bounded CLI command through the same cross-platform launch and process-tree lifecycle.
 * Timeout completion means the command tree has exited, not merely that a kill signal was sent.
 */
export function runCommand(
  command: string,
  args: readonly string[],
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
    if (timeoutMs < 0 || maxOutputBytes < 0) throw new Error("command limits cannot be negative");
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
    let timedOut = false;
    const append = (current: string, chunk: Buffer | string) => {
      if (Buffer.byteLength(current) >= maxOutputBytes) return current;
      return `${current}${String(chunk)}`.slice(0, maxOutputBytes);
    };
    const finish = (status: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ status, stdout, stderr, ...(error ? { error } : {}) });
    };
    child.stdout?.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr?.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.once("error", (cause) => {
      error = cause;
      finish(null);
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      const timeoutError = new Error(`command timed out after ${timeoutMs}ms`);
      error = timeoutError;
      void terminateProcessTree(child, {
        gracefulTimeoutMs: 1_000,
        forcedTimeoutMs: 1_000,
        label: command,
      }).then(
        () => finish(null),
        (cause) => {
          error = new Error(`${timeoutError.message}; process cleanup failed`, { cause });
          finish(null);
        },
      );
    }, timeoutMs);
    timeout.unref?.();
    child.once("close", (status) => {
      if (!timedOut) finish(status);
    });
  });
}
