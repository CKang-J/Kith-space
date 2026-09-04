import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { spawnRuntimeProcess } from "../../daemon/runtimeProcess.js";
import { resolvePiAgentHelper } from "../worker/pi-agent/piAgentHelperResolver.js";
import {
  createPiRpcRuntimeV2WithSpawn,
  type PiRpcSpawnOptions,
} from "./piRpcRuntimeV2.js";
import type { RuntimeV2 } from "../contract/v2/runtimeContract.js";

type SpawnBuiltin = (command: string, args: string[], options: PiRpcSpawnOptions) => ChildProcess;

/**
 * Built-in Pi Agent runtime: the same JSONL RPC session as the external
 * `pi --mode rpc` CLI, but served by the bundled pi-agent-helper (the locked
 * @earendil-works/pi-coding-agent CLI entry) started through process.execPath.
 * No locally installed Pi CLI is required.
 *
 * The bundled helper still loads Pi's built-in theme JSONs from disk at
 * startup; PI_PACKAGE_DIR points them at the assets shipped next to the
 * helper bundle (desktop/dist/runtime/pi-agent-assets).
 */
export function piAgentAssetsDir(helperPath: string): string {
  return path.join(path.dirname(helperPath), "pi-agent-assets");
}

export function piBuiltinHelperEnvironment(helperPath: string, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...base,
    PI_PACKAGE_DIR: piAgentAssetsDir(helperPath),
    // In packaged Desktop the Worker runs under the Electron executable; the
    // agent env deliberately strips ELECTRON_RUN_AS_NODE, but without it the
    // helper would boot the full GUI instead of running the script.
    ELECTRON_RUN_AS_NODE: process.versions.electron ? "1" : undefined,
  };
}

export function createPiBuiltinRpcRuntimeV2(
  helperPath: string = resolvePiAgentHelper(),
  spawnBuiltin: SpawnBuiltin = (command, args, options) => spawnRuntimeProcess(
    command,
    args,
    options,
    { rawBytes: true },
  ),
  now: () => number = Date.now,
): RuntimeV2 {
  return createPiRpcRuntimeV2WithSpawn({
    fingerprintRuntime: "pi-builtin",
    eventRuntime: "pi-builtin",
    spawn: (args, options) => spawnBuiltin(
      process.execPath,
      [helperPath, ...args],
      { ...options, env: piBuiltinHelperEnvironment(helperPath, options.env) },
    ),
  }, now);
}

export const piBuiltinRpcRuntimeV2 = createPiBuiltinRpcRuntimeV2();
