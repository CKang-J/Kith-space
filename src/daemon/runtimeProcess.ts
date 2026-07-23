import type { ChildProcess, SpawnOptions } from "node:child_process";
import crossSpawn from "cross-spawn";

/** Cross-platform boundary for runtime CLIs, including Windows npm .cmd shims. */
export function spawnRuntimeProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
  protocol?: { rawBytes?: boolean },
): ChildProcess {
  const child = crossSpawn(command, args, options);
  if (protocol?.rawBytes) return child;
  // Runtime protocols are UTF-8 text streams. Let Node keep decoder state across arbitrary pipe
  // chunks so a multibyte character split by the OS is not replaced before JSON/JSONL parsing.
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  return child;
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
