// Live model discovery for the user-facing local-runtime endpoint. For runtimes whose CLI can list
// their own models (opencode/cursor/pi) we ask the one local runtime worker to probe live — the server has no
// such CLI or login — cache the result briefly per runtime, and let the caller fall back to
// a static candidate list on any miss/offline/timeout. claude/codex/copilot/kimi are not probed here
// (no list command, or would need an ACP handshake) — tracked in docs/tech-debt-tracker.md.
import { requestWorker } from "../local-runtime/workerHub.js";

export interface ModelOption {
  id: string;
  label: string;
  provider?: string;
  default?: boolean;
  thinking?: { levels: { value: string; label: string; description?: string }[]; default?: string };
}

// Runtimes probed live through the local worker: opencode/cursor/pi/hermes enumerate their model/profile list; claude/codex
// keep a static catalog but probe each model's reasoning-effort levels. The rest stay fully static.
export const DYNAMIC_RUNTIMES = new Set(["opencode", "cursor", "pi", "hermes", "claude", "codex"]);

const TTL_MS = 60_000; // matches multica's 60s model cache — lists rarely change within a minute
const PROBE_TIMEOUT_MS = 8_000; // bound how long the modal waits on the first probe before fallback
const cache = new Map<string, { models: ModelOption[]; exp: number }>();

// Returns the worker's live model list for a runtime (cached ~60s), or null on miss/offline/timeout/
// empty so the caller serves its static fallback. Never throws.
export async function getDynamicModels(runtime: string): Promise<ModelOption[] | null> {
  const hit = cache.get(runtime);
  if (hit && hit.exp > Date.now()) return hit.models;
  const r = await requestWorker({ type: "probe-models", runtime }, PROBE_TIMEOUT_MS);
  const models = Array.isArray(r?.models) ? (r.models as ModelOption[]) : null;
  if (!models || !models.length) return null; // never cache empty/error — don't lock a transient failure for 60s
  models.sort((a, b) => (b.default ? 1 : 0) - (a.default ? 1 : 0)); // default first → frontend preselects ms[0]
  cache.set(runtime, { models, exp: Date.now() + TTL_MS });
  return models;
}
