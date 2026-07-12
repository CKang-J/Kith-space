import { DYNAMIC_RUNTIMES, getDynamicModels } from "../runtimeModels.js";
import { isWorkerConnected, workerRuntimes } from "../../local-runtime/workerHub.js";
import { runtimeAvailability } from "../../local-runtime/runtimeCatalog.js";
import { sendJson } from "../util.js";
import type { HumanCtx } from "./ctx.js";

const STATIC_MODELS: Record<string, { id: string; label: string }[]> = {
  claude: [{ id: "sonnet", label: "Sonnet" }, { id: "opus", label: "Opus" }, { id: "haiku", label: "Haiku" }],
  codex: [
    { id: "gpt-5.5", label: "GPT-5.5" }, { id: "gpt-5.4", label: "GPT-5.4" },
    { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" }, { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
    { id: "gpt-5.2-codex", label: "GPT-5.2 Codex" }, { id: "gpt-5.2", label: "GPT-5.2" },
    { id: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max" }, { id: "gpt-5.1-codex", label: "GPT-5.1 Codex" },
    { id: "gpt-5-codex", label: "GPT-5 Codex" },
  ],
  copilot: [
    { id: "auto", label: "Auto (recommended)" },
    { id: "gpt-5.5", label: "GPT-5.5" }, { id: "gpt-5.4", label: "GPT-5.4" }, { id: "gpt-5.2-codex", label: "GPT-5.2 Codex" },
    { id: "claude-opus-4.7", label: "Claude Opus 4.7" }, { id: "claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
    { id: "claude-sonnet-4.5", label: "Claude Sonnet 4.5" }, { id: "claude-haiku-4.5", label: "Claude Haiku 4.5" },
  ],
  kimi: [{ id: "default", label: "Default (config.toml)" }],
  cursor: [{ id: "default", label: "Default (Composer)" }, { id: "sonnet-4", label: "Sonnet 4" }, { id: "sonnet-4-thinking", label: "Sonnet 4 (thinking)" }, { id: "gpt-5", label: "GPT-5" }],
  hermes: [{ id: "default", label: "Default profile" }],
};

export async function handleLocalRuntimeHumanScope(ctx: HumanCtx): Promise<boolean> {
  if (ctx.p === "/api/local-runtime/runtimes" && ctx.method === "GET") {
    return (sendJson(ctx.res, 200, {
      runtimes: runtimeAvailability(workerRuntimes()),
      workerConnected: isWorkerConnected(),
    }), true);
  }

  const match = /^\/api\/local-runtime\/models\/([^/]+)$/.exec(ctx.p);
  if (!match || ctx.method !== "GET") return false;
  const runtime = decodeURIComponent(match[1]!).toLowerCase();
  if (DYNAMIC_RUNTIMES.has(runtime)) {
    const models = await getDynamicModels(runtime);
    if (models?.length) return (sendJson(ctx.res, 200, { models }), true);
    if (runtime === "opencode") {
      return (sendJson(ctx.res, 200, {
        models: [],
        error: "opencode model discovery failed",
        code: "OPENCODE_MODELS_UNAVAILABLE",
      }), true);
    }
  }
  return (sendJson(ctx.res, 200, { models: STATIC_MODELS[runtime] ?? [{ id: "default", label: "Default" }] }), true);
}
