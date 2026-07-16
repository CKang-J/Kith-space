// Auto-extracted from the former routes-api.ts monolith — bodies are verbatim.
import type { SpaceCtx } from "./ctx.js";
import { and, desc, eq, isNull } from "drizzle-orm";
import { ROLE_TEMPLATES, resolveRoleDescription } from "../../agents/roleTemplates.js";
import { dbForSpace, schema, spaceRecord } from "../../db/index.js";
import { DESC_TOO_LONG, INVALID_AGENT_NAME, addChannelMembers, descTooLong, invalidAgentName, resetAgent, startAgent, stopAgent, syncAgentProfile } from "../core.js";
import { requestWorker } from "../../local-runtime/workerHub.js";
import { publish } from "../realtime.js";
import { clearAgentIntroductionTurns } from "../agentIntroduction.js";
import { ALL_SCOPE_KEYS, SCOPES, effectiveScopes, isScopeLiteral } from "../scopes.js";
import { readJson, sendErr, sendJson } from "../util.js";
import { validateRuntimeModel } from "../../local-runtime/runtimeCatalog.js";
import { resolveAgentMemoryDir } from "../../agents/agentWorkspacePaths.js";
import {
  AgentResponseSettingsError,
  setAgentDefaultResponseMode,
} from "../../agents/agentResponseSettings.js";

export async function handleAgents(ctx: SpaceCtx): Promise<boolean> {
  const { req, res, url, method, p, humanId, spaceId } = ctx;
  const db = dbForSpace(spaceId);
  if (p === "/api/agent-role-templates" && method === "GET") {
    return (sendJson(res, 200, ROLE_TEMPLATES), true);
  }
  if (p === "/api/agents" && method === "GET") {
    const agents = await db.select().from(schema.agents).where(and(eq(schema.agents.spaceId, spaceId), isNull(schema.agents.deletedAt)));
    // creatorType lets the client exclude non-interactive system-owned identities from rosters and pickers.
    return (sendJson(res, 200, agents.map((a) => ({ id: a.id, name: a.name, displayName: a.displayName, description: a.description, status: a.status, activity: a.activity, model: a.model, runtime: a.runtime, avatarUrl: a.avatarUrl, creatorType: a.creatorType, defaultResponseMode: a.defaultResponseMode }))), true);
  }
  if (p === "/api/agents" && method === "POST") {
    const b = await readJson(req);
    if (!b.name) return (sendErr(res, 400, "name required"), true);
    if (invalidAgentName(b.name)) return (sendErr(res, 400, INVALID_AGENT_NAME), true);
    let description: string | null;
    try { description = resolveRoleDescription(b.description, b.roleTemplate); }
    catch (error) { return (sendErr(res, 400, (error as Error).message), true); }
    if (descTooLong(description)) return (sendErr(res, 400, DESC_TOO_LONG), true);
    const runtimeModelError = validateRuntimeModel(b.runtime || "claude", b.model);
    if (runtimeModelError) return (sendErr(res, 400, runtimeModelError), true);
    // Machine assignment is retired. Reject the old field explicitly so stale clients do not appear to succeed.
    if (Object.prototype.hasOwnProperty.call(b, "machineId")) return (sendErr(res, 400, "machineId is no longer supported"), true);
    // A live agent name must be unique per Space — it is the @mention / dm:@<name> routing key, so a duplicate
    // becomes an unreachable routing blind spot. ON CONFLICT against the agents_name_uniq partial index is
    // race-proof (no SELECT-then-INSERT gap): a duplicate live name inserts no row → friendly 409. Soft-deleted
    // names are excluded by the index predicate, so a deleted agent's name can be reused.
    const [agent] = await db.insert(schema.agents).values({
      spaceId, name: b.name, displayName: b.displayName || b.name, description,
      model: b.model || null, runtime: b.runtime || "claude",
      runtimeConfig: { provider: b.provider ?? "default", model: b.model ?? null, reasoningEffort: b.reasoning ?? null, mode: b.fastMode ? "fast" : "default" },
      envVars: b.envVars ?? {}, executionMode: b.fastMode ? "fast" : "auto", creatorType: "human", creatorId: humanId,
    }).onConflictDoNothing().returning();
    if (!agent) return (sendErr(res, 409, `an agent named "${b.name}" already exists`), true);
    const all = (await db.select().from(schema.channels).where(and(eq(schema.channels.spaceId, spaceId), eq(schema.channels.name, "all"))))[0];
    // Join #all at the channel watermark, NOT lastReadSeq=0 — a newly created agent must not have its first
    // `message check` flooded with the channel's entire pre-existing history (it only needs messages from now on).
    if (all) await addChannelMembers(spaceId, all.id, [{ type: "agent", id: agent!.id }]);
    await publish(spaceId, { type: "agent:created", agent: { id: agent!.id, name: agent!.name, displayName: agent!.displayName, description: agent!.description, status: agent!.status, activity: agent!.activity, model: agent!.model, runtime: agent!.runtime, defaultResponseMode: agent!.defaultResponseMode } });
    // Start immediately on create: the client only POSTs /agents. If the local Worker is offline,
    // startAgent returns ok:false without blocking creation.
    const started = await startAgent(spaceId, agent!.id, "create");
    return (sendJson(res, 200, { id: agent!.id, name: agent!.name, started: started.ok }), true);
  }
  const am = /^\/api\/agents\/([^/]+)$/.exec(p);
  if (am && method === "GET") {
    const a = (await db.select().from(schema.agents).where(and(eq(schema.agents.id, am[1]!), eq(schema.agents.spaceId, spaceId))))[0];
    return (a ? sendJson(res, 200, {
      id: a.id, spaceId: a.spaceId, name: a.name, displayName: a.displayName,
      avatarUrl: a.avatarUrl, description: a.description, status: a.status, activity: a.activity,
      sessionId: a.sessionId, model: a.model, runtime: a.runtime, runtimeConfig: a.runtimeConfig,
      executionMode: a.executionMode, envVars: a.envVars, scopes: a.scopes,
      defaultResponseMode: a.defaultResponseMode,
      creatorType: a.creatorType, creatorId: a.creatorId, createdAt: a.createdAt,
    }) : sendErr(res, 404, "agent not found"), true);
  }
  if (am && method === "PATCH") {
    const b = await readJson(req); const patch: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(b, "machineId")) return (sendErr(res, 400, "machineId is no longer supported"), true);
    if (descTooLong(b.description)) return (sendErr(res, 400, DESC_TOO_LONG), true);
    for (const k of ["displayName", "description", "model", "runtime", "avatarUrl"]) if (b[k] !== undefined) patch[k] = b[k];
    if (b.envVars !== undefined) patch.envVars = b.envVars;
    let defaultResponseModeChanged = false;
    if (Object.prototype.hasOwnProperty.call(b, "defaultResponseMode")) {
      try {
        const result = await setAgentDefaultResponseMode(spaceId, am[1]!, b.defaultResponseMode);
        defaultResponseModeChanged = result.changed;
      } catch (error) {
        if (error instanceof AgentResponseSettingsError) {
          return (sendErr(res, error.statusCode, error.message, { code: error.code }), true);
        }
        throw error;
      }
    }
    if (Object.keys(patch).length) {
      await db.update(schema.agents).set(patch).where(and(eq(schema.agents.id, am[1]!), eq(schema.agents.spaceId, spaceId)));
    }
    // Title/role changed → push the current profile to the daemon so it syncs the workspace MEMORY.md.
    if (patch.displayName !== undefined || patch.description !== undefined) {
      const a = (await db.select().from(schema.agents).where(and(eq(schema.agents.id, am[1]!), eq(schema.agents.spaceId, spaceId))))[0];
      if (a) await syncAgentProfile(spaceId, am[1]!, a.displayName, a.description);
    }
    if (defaultResponseModeChanged) {
      await publish(spaceId, { type: "agent:response-mode-updated", agentId: am[1]! });
    }
    const updated = (await db.select({ defaultResponseMode: schema.agents.defaultResponseMode }).from(schema.agents).where(and(
      eq(schema.agents.id, am[1]!),
      eq(schema.agents.spaceId, spaceId),
    )))[0];
    return (sendJson(res, 200, { ok: true, defaultResponseMode: updated?.defaultResponseMode }), true);
  }
  if (am && method === "DELETE") {
    await stopAgent(spaceId, am[1]!).catch(() => {}); // stop the local process before deleting
    await db.delete(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.agentId, am[1]!));
    await db.update(schema.agents).set({ deletedAt: new Date(), status: "inactive", activity: "offline", agentTokenHash: null }).where(and(eq(schema.agents.id, am[1]!), eq(schema.agents.spaceId, spaceId))); // soft delete: row is kept so historical messages/DM names remain resolvable by id, no orphans; clear the token hash so a still-running deleted agent can no longer authenticate (C4, with resolveAgent's deletedAt filter)
    clearAgentIntroductionTurns(spaceId, am[1]!);
    await publish(spaceId, { type: "agent:deleted", id: am[1]! });
    return (sendJson(res, 200, { ok: true }), true);
  }
  // Agent lifecycle: start / stop / reset
  const alc = /^\/api\/agents\/([^/]+)\/(start|stop|reset|restart)$/.exec(p);
  if (alc && method === "POST") {
    const [, agId, action] = alc;
    if (action === "start") { const r = await startAgent(spaceId, agId!); return (r.ok ? sendJson(res, 200, { ok: true }) : sendErr(res, 503, r.reason ?? "cannot start")), true; }
    if (action === "stop") { await stopAgent(spaceId, agId!); return (sendJson(res, 200, { ok: true }), true); }
    if (action === "restart") { await stopAgent(spaceId, agId!); const r = await startAgent(spaceId, agId!); return (r.ok ? sendJson(res, 200, { ok: true }) : sendErr(res, 503, r.reason ?? "cannot start")), true; } // preserves session and workspace; restarts only the process
    const b = await readJson(req).catch(() => ({}));
    const clearAgentMemory = !!(b?.clearAgentMemory || b?.clearMemory || b?.wipeWorkspace); // accept old field names without preserving their unsafe semantics
    await resetAgent(spaceId, agId!, clearAgentMemory);
    if (b?.restart) await startAgent(spaceId, agId!); // Worker serializes same-agent reset/start so cleanup completes before the new runtime begins.
    return (sendJson(res, 200, { ok: true }), true);
  }
  // Agent Memory browser. Keep the legacy workspace-files route/worker message names for deep-link and protocol compatibility.
  const awsList = /^\/api\/agents\/([^/]+)\/workspace-files$/.exec(p);
  const awsFile = /^\/api\/agents\/([^/]+)\/workspace-files\/read$/.exec(p);
  if ((awsList || awsFile) && method === "GET") {
    const agId = (awsList || awsFile)![1]!;
    const a = (await db.select().from(schema.agents).where(and(eq(schema.agents.id, agId), eq(schema.agents.spaceId, spaceId))))[0];
    if (!a) return (sendErr(res, 404, "agent not found"), true);
    const workspaceRoot = spaceRecord(spaceId)?.rootPath;
    if (!workspaceRoot) return (sendErr(res, 404, "space not found"), true);
    const agentMemoryDir = resolveAgentMemoryDir(workspaceRoot, agId);
    if (awsList) {
      const r = await requestWorker({ type: "agent:workspace:list", agentId: agId, workspaceRoot: agentMemoryDir });
      return (sendJson(res, 200, r.error ? { error: r.error } : { files: r.files ?? [], root: r.root }), true);
    }
    const r = await requestWorker({ type: "agent:workspace:read", agentId: agId, workspaceRoot: agentMemoryDir, path: url.searchParams.get("path") ?? "" });
    return (sendJson(res, 200, r.error ? { error: r.error } : { path: r.path, content: r.content }), true);
  }
  // Agent activity log: chronological [{timestamp, entry}]
  const alog = /^\/api\/agents\/([^/]+)\/activity-log$/.exec(p);
  if (alog && method === "GET") {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const rows = await db.select().from(schema.agentActivityLog).where(and(eq(schema.agentActivityLog.agentId, alog[1]!), eq(schema.agentActivityLog.spaceId, spaceId))).orderBy(desc(schema.agentActivityLog.ts)).limit(limit); // spaceId scope: never leak another Space's agent activity by raw agentId
    return (sendJson(res, 200, rows.reverse().map((r) => ({ timestamp: r.ts, entry: { kind: r.kind === "tool" ? "tool_start" : r.kind, activity: r.activity, detail: r.detail, text: r.text, toolName: r.toolName, toolInput: r.toolInput } }))), true);
  }
  // ── Agent Permissions (scopes) ── GET to read / PUT to replace entirely. Default mode = grant all.
  const ascope = /^\/api\/agents\/([^/]+)\/scopes$/.exec(p);
  if (ascope && (method === "GET" || method === "PUT")) {
    const agId = ascope[1]!;
    const a = (await db.select().from(schema.agents).where(and(eq(schema.agents.id, agId), eq(schema.agents.spaceId, spaceId))))[0];
    if (!a) return (sendErr(res, 404, "agent not found"), true);
    if (method === "GET") { const eff = effectiveScopes(a.scopes); return (sendJson(res, 200, { agentId: agId, ...eff, catalog: SCOPES }), true); }
    const b = await readJson(req);
    if (!Array.isArray(b.scopes) || !b.scopes.every(isScopeLiteral)) return (sendErr(res, 400, "scopes must be an array of scope literals"), true);
    const granted = [...new Set(b.scopes as string[])].filter((s) => ALL_SCOPE_KEYS.includes(s));
    const next = { granted, mode: "custom" as const, revision: (a.scopes?.revision ?? 0) + 1, updatedAt: new Date().toISOString() };
    await db.update(schema.agents).set({ scopes: next }).where(eq(schema.agents.id, agId));
    return (sendJson(res, 200, { agentId: agId, ...next }), true);
  }
  // Agent Skills (used by Profile tab): the local worker reads the runtime's own skills directory
  // (claude → ~/.claude/skills, codex → ~/.codex/skills, …) + the matching dir in the workspace.
  const askill = /^\/api\/agents\/([^/]+)\/skills$/.exec(p);
  if (askill && method === "GET") {
    const a = (await db.select().from(schema.agents).where(and(eq(schema.agents.id, askill[1]!), eq(schema.agents.spaceId, spaceId))))[0];
    if (!a) return (sendErr(res, 404, "agent not found"), true);
    const workspaceRoot = spaceRecord(spaceId)?.rootPath;
    if (!workspaceRoot) return (sendErr(res, 404, "space not found"), true);
    try { const r = await requestWorker({ type: "agent:skills:list", agentId: askill[1]!, workspaceRoot, runtime: a.runtime }); return (sendJson(res, 200, { global: r.global ?? [], workspace: r.workspace ?? [] }), true); }
    catch { return (sendJson(res, 200, { global: [], workspace: [] }), true); }
  }
  // Apps tab (connected third-party integrations): no integrations implemented yet, returns empty array
  const aint = /^\/api\/integrations\/agents\/([^/]+)$/.exec(p);
  if (aint && method === "GET") return (sendJson(res, 200, []), true);
  // Agent DMs tab: derived from channels (DMs where this agent participates and the peer is also an agent)
  const adms = /^\/api\/agents\/([^/]+)\/agent-dms$/.exec(p);
  if (adms && method === "GET") {
    const agId = adms[1]!;
    // spaceId scope: confirm the agent belongs to this Space before fanning out over its memberships
    // (the inner channel query already filters by spaceId, but pre-checking 404s a foreign agent id and
    // avoids a cross-Space channel_agent_members scan). Mirrors the workspace-files / scopes ownership pre-check.
    const own = (await db.select({ id: schema.agents.id }).from(schema.agents).where(and(eq(schema.agents.id, agId), eq(schema.agents.spaceId, spaceId))))[0];
    if (!own) return (sendErr(res, 404, "agent not found"), true);
    const mine = await db.select().from(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.agentId, agId));
    const out: any[] = [];
    for (const cm of mine) {
      const ch = (await db.select().from(schema.channels).where(and(eq(schema.channels.id, cm.channelId), eq(schema.channels.type, "dm"), eq(schema.channels.spaceId, spaceId))))[0]; // spaceId scope: don't surface another Space's DM channels for this agent id
      if (!ch) continue;
      const peers = (await db.select().from(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.channelId, ch.id))).filter((member) => member.agentId !== agId);
      const peer = peers[0]; // Human DMs contain only this agent, so only agent-agent DMs have a peer row.
      if (!peer) continue;
      const pa = (await db.select().from(schema.agents).where(eq(schema.agents.id, peer.agentId)))[0];
      out.push({ id: ch.id, name: pa?.name ?? "agent", peerId: peer.agentId, peerType: "agent", lastMessageAt: ch.lastMessageAt });
    }
    return (sendJson(res, 200, out), true);
  }
  return false;
}
