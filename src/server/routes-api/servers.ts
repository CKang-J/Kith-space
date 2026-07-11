// Local-runtime models plus the temporary /api/servers Space compatibility alias.
import type { UserCtx, ServerCtx } from "./ctx.js";
import { and, eq } from "drizzle-orm";
import { dbFor, schema } from "../../db/index.js";
import { DYNAMIC_RUNTIMES, getDynamicModels } from "../runtimeModels.js";
import { readJson, sendJson } from "../util.js";
import { handleSpacesUserScope } from "./spaces.js";

const SIDEBAR_DEFAULTS = {
  channelOrder: [] as string[], agentOrder: [] as string[], dmOrder: [] as string[],
  channelSortMode: "manual", jointChannelSortMode: "manual", dmSortMode: "manual", pinnedSortMode: "manual",
  pinnedChannelIds: [] as string[], pinnedAgentIds: [] as string[], pinnedOrder: [] as string[],
  hiddenDmIds: [] as string[], channelPanelTabOrder: [] as string[], agentPanelTabOrder: [] as string[],
};

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
  opencode: [{ id: "default", label: "Default" }],
  cursor: [{ id: "default", label: "Default (Composer)" }, { id: "sonnet-4", label: "Sonnet 4" }, { id: "sonnet-4-thinking", label: "Sonnet 4 (thinking)" }, { id: "gpt-5", label: "GPT-5" }],
  hermes: [{ id: "default", label: "Default profile" }],
};

export async function handleServersUserScope(ctx: UserCtx): Promise<boolean> {
  const canonicalPath = ctx.p.replace(/^\/api\/servers(?=\/|$)/, "/api/spaces");
  return handleSpacesUserScope({ ...ctx, p: canonicalPath });
}

export async function handleServersServerScope(ctx: ServerCtx): Promise<boolean> {
  const { req, res, method, p, userId, serverId } = ctx;
  const db = dbFor(serverId);

  const runtimeModels = /^\/api\/local-runtime\/models\/([^/]+)$/.exec(p);
  if (runtimeModels && method === "GET") {
    const runtime = decodeURIComponent(runtimeModels[1]!).toLowerCase();
    if (DYNAMIC_RUNTIMES.has(runtime)) {
      const models = await getDynamicModels(runtime);
      if (models?.length) return (sendJson(res, 200, { models }), true);
    }
    return (sendJson(res, 200, { models: STATIC_MODELS[runtime] ?? [{ id: "default", label: "Default" }] }), true);
  }

  // Temporary storage for the one Human's per-Space sidebar ordering. This is UI state, not membership/RBAC.
  const sidebarOrder = /^\/api\/servers\/[^/]+\/sidebar-order$/.exec(p);
  if (sidebarOrder && (method === "GET" || method === "PUT" || method === "PATCH")) {
    const row = (await db.select().from(schema.serverSidebarPrefs).where(and(
      eq(schema.serverSidebarPrefs.serverId, serverId),
      eq(schema.serverSidebarPrefs.userId, userId),
    )))[0];
    if (method === "GET") return (sendJson(res, 200, { ...SIDEBAR_DEFAULTS, ...(row?.prefs as object ?? {}) }), true);
    const body = await readJson(req).catch(() => ({}));
    const prefs = { ...SIDEBAR_DEFAULTS, ...(row?.prefs as object ?? {}), ...(body && typeof body === "object" ? body : {}) };
    await db.insert(schema.serverSidebarPrefs).values({ serverId, userId, prefs })
      .onConflictDoUpdate({
        target: [schema.serverSidebarPrefs.serverId, schema.serverSidebarPrefs.userId],
        set: { prefs, updatedAt: new Date() },
      });
    return (sendJson(res, 200, prefs), true);
  }

  return false;
}
