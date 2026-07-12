import type { ChildProcess, SpawnOptions } from "node:child_process";
import crossSpawn from "cross-spawn";

/** Cross-platform boundary for runtime CLIs, including Windows npm .cmd shims. */
export function spawnRuntimeProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcess {
  return crossSpawn(command, args, options);
}

/** Probe the same launch path used by adapters instead of shell-specific command discovery. */
export function runtimeCommandAvailable(command: string, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    const result = crossSpawn.sync(command, ["--version"], {
      env,
      stdio: "ignore",
      timeout: 5_000,
      windowsHide: true,
    });
    return result.error == null;
  } catch {
    return false;
  }
}
