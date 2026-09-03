// Runtime registry and local detection. Concrete implementations live in claudeRuntime.ts / codexRuntime.ts / copilotRuntime.ts / opencodeRuntime.ts / kimiRuntime.ts / piRuntime.ts / cursorRuntime.ts / hermesRuntime.ts.
import { claudeRuntime } from "./claudeRuntime.js";
import { codexRuntime } from "./codexRuntime.js";
import { copilotRuntime } from "./copilotRuntime.js";
import { opencodeRuntime } from "./opencodeRuntime.js";
import { kimiRuntime } from "./kimiRuntime.js";
import { piRuntime } from "./piRuntime.js";
import { cursorRuntime } from "./cursorRuntime.js";
import { hermesRuntime } from "./hermesRuntime.js";
import { runtimeCommandAvailable } from "./runtimeProcess.js";
import { RUNTIME_CATALOG } from "../local-runtime/runtimeCatalog.js";
import { existsSync } from "node:fs";
import { resolvePiAgentHelper } from "../runtime/worker/pi-agent/piAgentHelperResolver.js";
import type { Runtime } from "./runtime.js";

export type { Runtime, RuntimeSession, RuntimeCallbacks, StartOpts, TrajectoryEntry } from "./runtime.js";

export function detectRuntimes(env: NodeJS.ProcessEnv = process.env): string[] {
  const detected = RUNTIME_CATALOG
    .filter((runtime) => runtime.command && runtimeCommandAvailable(runtime.command, env))
    .map((runtime) => runtime.id);
  // The built-in Pi Agent ships with the app: report it whenever the bundled
  // helper is resolvable, so no locally installed Agent CLI is required.
  if (!existsSync(resolvePiAgentHelper())) return detected;
  return [...detected, "pi-builtin"];
}

const REG: Record<string, Runtime> = { claude: claudeRuntime, codex: codexRuntime, copilot: copilotRuntime, opencode: opencodeRuntime, kimi: kimiRuntime, pi: piRuntime, cursor: cursorRuntime, hermes: hermesRuntime };
export function getRuntime(name: string): Runtime | null { return REG[name] ?? null; }
