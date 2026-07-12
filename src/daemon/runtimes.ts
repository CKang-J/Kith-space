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
import type { Runtime } from "./runtime.js";

export type { Runtime, RuntimeSession, RuntimeCallbacks, StartOpts, TrajectoryEntry } from "./runtime.js";

export function detectRuntimes(env: NodeJS.ProcessEnv = process.env): string[] {
  return RUNTIME_CATALOG
    .filter((runtime) => runtimeCommandAvailable(runtime.command, env))
    .map((runtime) => runtime.id);
}

const REG: Record<string, Runtime> = { claude: claudeRuntime, codex: codexRuntime, copilot: copilotRuntime, opencode: opencodeRuntime, kimi: kimiRuntime, pi: piRuntime, cursor: cursorRuntime, hermes: hermesRuntime };
export function getRuntime(name: string): Runtime | null { return REG[name] ?? null; }
