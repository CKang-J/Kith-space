// Temporary A2.4 Machine routes plus the /api/servers Space compatibility alias.
import type { UserCtx, ServerCtx } from "./ctx.js";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { dbFor, schema } from "../../db/index.js";
import { hashToken, newKey } from "../auth.js";
import { publish } from "../realtime.js";
import { DYNAMIC_RUNTIMES, getDynamicModels } from "../runtimeModels.js";
import { readJson, sendErr, sendJson } from "../util.js";
import { createRequire } from "node:module";
import { handleSpacesUserScope } from "./spaces.js";

// Single source of truth for the newest published daemon version (packages/daemon/package.json). The web client
// compares each machine's reported daemonVersion against this to raise an "outdated daemon" system alert. Falls
// Fall back to "" - a safe no-op that raises no outdated alert - if the file is not reachable in the current layout.
const LATEST_DAEMON_VERSION: string = (() => { try { return String(createRequire(import.meta.url)("../../../packages/daemon/package.json").version ?? ""); } catch { return ""; } })();

const SIDEBAR_DEFAULTS = {
  channelOrder: [] as string[], agentOrder: [] as string[], dmOrder: [] as string[],
  channelSortMode: "manual", jointChannelSortMode: "manual", dmSortMode: "manual", pinnedSortMode: "manual",
  pinnedChannelIds: [] as string[], pinnedAgentIds: [] as string[], pinnedOrder: [] as string[],
  hiddenDmIds: [] as string[], channelPanelTabOrder: [] as string[], agentPanelTabOrder: [] as string[],
};

export async function handleServersUserScope(ctx: UserCtx): Promise<boolean> {
  const canonicalPath = ctx.p.replace(/^\/api\/servers(?=\/|$)/, "/api/spaces");
  return handleSpacesUserScope({ ...ctx, p: canonicalPath });
}

export async function handleServersServerScope(ctx: ServerCtx): Promise<boolean> {
  const { req, res, method, p, userId, serverId } = ctx;
  const db = dbFor(serverId);
  const rm = /^\/api\/servers\/[^/]+\/machines\/([^/]+)\/runtime-models\/([^/]+)$/.exec(p);
  if (rm && method === "GET") {
    const machineId = rm[1]!, runtime = rm[2]!;
    // The static lists below are the FALLBACK. opencode/cursor/pi are probed live on the machine (further
    // down) and only use these on miss/offline/timeout. claude/codex use their native CLI (no gateway
    // model list), so their catalog is curated here. copilot/kimi have no list command; live per-account
    // discovery would need an ACP probe (tracked in docs/tech-debt-tracker.md); "auto" is first/default
    // for copilot so it picks an accessible model (one the account lacks fails loudly at runtime).
    const MODELS: Record<string, { id: string; label: string }[]> = {
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
    // Live discovery for runtimes whose CLI lists its own models: ask THAT machine's daemon to probe,
    // cache briefly, serve the static list on any miss/offline/timeout (machineId "none" = unbound agent).
    // Tenant isolation: machineId is client-supplied, so confirm it belongs to THIS server before routing
    // a probe to it; otherwise a cross-tenant id could enumerate another server's machine model list.
    if (DYNAMIC_RUNTIMES.has(runtime) && machineId !== "none") {
      const owns = (await db.select().from(schema.machines).where(and(eq(schema.machines.id, machineId), eq(schema.machines.serverId, serverId))))[0];
      if (owns) {
        const models = await getDynamicModels(machineId, runtime);
        if (models?.length) return (sendJson(res, 200, { models }), true);
      }
    }
    return (sendJson(res, 200, { models: MODELS[runtime] ?? [{ id: "default", label: "Default" }] }), true);
  }
  const machinesRoute = /^\/api\/servers\/[^/]+\/machines$/.exec(p);
  if (machinesRoute && method === "GET") {
    const machines = await db.select().from(schema.machines).where(eq(schema.machines.serverId, serverId));
    return (sendJson(res, 200, {
      machines: machines.map((machine) => ({
        id: machine.id,
        name: machine.name,
        hostname: machine.hostname,
        os: machine.os,
        runtimes: machine.runtimes,
        status: machine.status,
        daemonVersion: machine.daemonVersion,
        isComputer: machine.isComputer,
        apiKeyPrefix: machine.apiKeyPrefix,
        lastHeartbeat: machine.lastHeartbeat,
      })),
      latestDaemonVersion: LATEST_DAEMON_VERSION,
    }), true);
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
  // Connect a machine (add computer flow): generate sk_machine_* key + pre-create offline machine record
  // Key is returned in plaintext exactly once; daemon uses it to connect via /daemon/connect?key=; onReady claims this row by apiKeyHash
  if (machinesRoute && method === "POST") {
    const b = await readJson(req).catch(() => ({}));
    const name = String(b.name ?? "").trim() || "new machine";
    const key = newKey("sk_machine_");
    const [m] = await db.insert(schema.machines).values({
      serverId, userId, name, apiKeyHash: hashToken(key), apiKeyPrefix: key.slice(0, 14), status: "offline", isComputer: false,
    }).returning();
    return (sendJson(res, 200, { id: m!.id, name: m!.name, apiKeyPrefix: m!.apiKeyPrefix, key }), true);
  }
  // Reconnect a machine: rotate the connection key on the SAME row. Lets an offline machine whose one-time
  // key was lost come back online without spawning a duplicate row (the old key stops resolving, so its daemon
  // gets a permanent-rejection close). Returns the new key in plaintext exactly once, same shape as create.
  const recon = /^\/api\/servers\/[^/]+\/machines\/([^/]+)\/reconnect$/.exec(p);
  if (recon && method === "POST") {
    const mid = recon[1]!;
    const m = (await db.select().from(schema.machines).where(and(eq(schema.machines.id, mid), eq(schema.machines.serverId, serverId))))[0];
    if (!m) return (sendErr(res, 404, "machine not found"), true);
    // Rotating the key orphans whatever daemon currently holds it; an online machine has a live daemon, so
    // refuse and tell the operator to stop it first (the UI only offers Reconnect on offline machines anyway).
    if (m.status === "online") return (sendErr(res, 409, "machine is online; stop its daemon before rotating the key"), true);
    const key = newKey("sk_machine_");
    await db.update(schema.machines).set({ apiKeyHash: hashToken(key), apiKeyPrefix: key.slice(0, 14) }).where(eq(schema.machines.id, mid));
    return (sendJson(res, 200, { id: m.id, name: m.name, apiKeyPrefix: key.slice(0, 14), key }), true);
  }
  // Rename a machine: set a human-friendly display name. Tenant-isolated (machineId must belong to
  // the path's server); it uses the same guard shape as reconnect/delete above.
  const renm = /^\/api\/servers\/[^/]+\/machines\/([^/]+)$/.exec(p);
  if (renm && method === "PATCH") {
    const mid = renm[1]!;
    const b = await readJson(req).catch(() => ({}));
    // name must be a real string; reject non-string payloads (e.g. 12345) instead of coercing them.
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name || name.length > 80) return (sendErr(res, 400, "name must be a string of 1-80 characters"), true);
    const m = (await db.select().from(schema.machines).where(and(eq(schema.machines.id, mid), eq(schema.machines.serverId, serverId))))[0];
    if (!m) return (sendErr(res, 404, "machine not found"), true);
    const [u] = await db.update(schema.machines).set({ name }).where(eq(schema.machines.id, mid)).returning();
    return (sendJson(res, 200, { id: u!.id, name: u!.name, hostname: u!.hostname, os: u!.os, runtimes: u!.runtimes, status: u!.status, daemonVersion: u!.daemonVersion, isComputer: u!.isComputer, apiKeyPrefix: u!.apiKeyPrefix, lastHeartbeat: u!.lastHeartbeat }), true);
  }
  // Delete machine: reject if live agents are present, then release soft-deleted agent FK refs
  // before deleting. Wrapped in a transaction to reduce (but not fully eliminate under READ
  // COMMITTED) the TOCTOU window between the live-agent check and the delete.
  //
  // Bug (I66): agents.machineId -> machines.id FK has no onDelete action (= RESTRICT). Soft-
  // deleted agent rows (deletedAt IS NOT NULL) still physically reference the machine. The
  // original guard only counted WHERE deletedAt IS NULL: zero live agents -> guard passed ->
  // db.delete(machines) hit FK constraint -> PG 23503 -> 500 "internal". Fix: null out machineId
  // on any remaining soft-deleted agents inside the transaction before deleting the machine.
  const dmach = /^\/api\/servers\/[^/]+\/machines\/([^/]+)$/.exec(p);
  if (dmach && method === "DELETE") {
    const mid = dmach[1]!;
    const m = (await db.select().from(schema.machines).where(and(eq(schema.machines.id, mid), eq(schema.machines.serverId, serverId))))[0];
    if (!m) return (sendErr(res, 404, "machine not found"), true);
    let liveAgentCount = 0;
    db.transaction((tx) => {
      // Re-check inside the transaction to reduce TOCTOU exposure: an agent bound between the
      // outer machine-exists check and here will be caught by this SELECT in most cases.
      const onIt = tx.select().from(schema.agents).where(and(eq(schema.agents.serverId, serverId), eq(schema.agents.machineId, mid), isNull(schema.agents.deletedAt))).all();
      if (onIt.length) { liveAgentCount = onIt.length; return; }
      // At this point only soft-deleted agent rows (if any) still reference this machine.
      // Null out their machineId to release the FK before the DELETE. The `isNotNull` predicate
      // is defensive (the SELECT above confirmed zero live agents) but makes the intent explicit.
      tx.update(schema.agents).set({ machineId: null }).where(and(eq(schema.agents.serverId, serverId), eq(schema.agents.machineId, mid), isNotNull(schema.agents.deletedAt))).run();
      tx.delete(schema.machines).where(eq(schema.machines.id, mid)).run();
    });
    if (liveAgentCount) return (sendErr(res, 409, `This machine still has ${liveAgentCount} agent(s) attached. Please remove them before deleting the machine.`, { agentCount: liveAgentCount }), true);
    await publish(serverId, { type: "machine", online: false, machineId: mid, removed: true });
    return (sendJson(res, 200, { ok: true }), true);
  }

  // Full-text search (GET /api/messages/search): searches only channels visible to the user, returns a snippet
  return false;
}
