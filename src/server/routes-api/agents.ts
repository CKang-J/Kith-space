// Auto-extracted from the former routes-api.ts monolith — bodies are verbatim.
import type { SpaceCtx } from "./ctx.js";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { ROLE_TEMPLATES, resolveRoleDescription } from "../../agents/roleTemplates.js";
import { dbForSpace, schema, spaceRecord } from "../../db/index.js";
import { DESC_TOO_LONG, INVALID_AGENT_NAME, addChannelMembers, descTooLong, invalidAgentName, resetAgent, startAgent, stopAgent, syncAgentProfile } from "../core.js";
import { isWorkerConnected, requestWorker, workerRuntimes } from "../../local-runtime/workerHub.js";
import { publish } from "../realtime.js";
import { clearAgentIntroductionTurns } from "../agentIntroduction.js";
import {
  AGENT_SCOPES as SCOPES,
  ALL_AGENT_SCOPE_KEYS as ALL_SCOPE_KEYS,
  effectiveAgentScopes as effectiveScopes,
  isAgentScopeLiteral as isScopeLiteral,
} from "../../agents/agentScopes.js";
import { readJson, sendErr, sendJson } from "../util.js";
import { validateRuntimeModel } from "../../local-runtime/runtimeCatalog.js";
import { resolveAgentMemoryDir } from "../../agents/agentWorkspacePaths.js";
import {
  AgentResponseSettingsError,
  setAgentDefaultResponseMode,
} from "../../agents/agentResponseSettings.js";
import { deleteAgentAndPrivateConversations } from "../../agents/agentDeletion.js";
import {
  canRollbackV2Agent,
  initializeNewV2Agent,
  migrateExistingAgentToV2,
} from "../../agents/agentHarnessLifecycle.js";
import { RUNTIME_V2_CAPABILITY_MATRIX } from "../../runtime/adapters/runtimeV2CapabilityMatrix.js";
import { SessionModule } from "../../sessions/sessionModule.js";
import { harnessTurnScheduler, scheduleV2Turns, turnCapabilityService } from "../harnessComposition.js";
import { serializeMessage } from "../../messages/messageSerialization.js";
import {
  beginLegacyDataPlaneDrain,
  endLegacyDataPlaneDrain,
  waitForLegacyDataPlaneDrain,
} from "../../agents/legacyDataPlaneDrain.js";
import { AdvisorProviderSettingsService } from "../../advisor-provider/advisorProviderSettingsService.js";
import { AgentModelBindingService } from "../../model-control/agentModelBindingService.js";
import { loadAgentActivitySources } from "../agentActivityPresentation.js";

export async function handleAgents(ctx: SpaceCtx): Promise<boolean> {
  const { req, res, url, method, p, humanId, spaceId } = ctx;
  const db = dbForSpace(spaceId);
  if (p === "/api/agent-role-templates" && method === "GET") {
    return (sendJson(res, 200, ROLE_TEMPLATES), true);
  }
  if (p === "/api/agents" && method === "GET") {
    const agents = await db.select().from(schema.agents).where(and(eq(schema.agents.spaceId, spaceId), isNull(schema.agents.deletedAt)));
    // creatorType lets the client exclude non-interactive system-owned identities from rosters and pickers.
    return (sendJson(res, 200, agents.map((a) => ({
      id: a.id, name: a.name, displayName: a.displayName, description: a.description,
      status: a.status, activity: a.activity, model: a.model, runtime: a.runtime,
      avatarUrl: a.avatarUrl, creatorType: a.creatorType, defaultResponseMode: a.defaultResponseMode,
      modelBindingMode: a.modelBindingMode, modelConfigurationId: a.modelConfigurationId,
      modelConfigurationRevision: a.modelConfigurationRevision, modelConfigurationLabel: a.modelBindingLabelSnapshot,
      modelBindingState: a.modelBindingState, runtimeRestartRequired: a.runtimeRestartRequired,
    }))), true);
  }
  if (p === "/api/agents" && method === "POST") {
    const b = await readJson(req);
    if (!b.name) return (sendErr(res, 400, "name required"), true);
    if (invalidAgentName(b.name)) return (sendErr(res, 400, INVALID_AGENT_NAME), true);
    let description: string | null;
    try { description = resolveRoleDescription(b.description, b.roleTemplate); }
    catch (error) { return (sendErr(res, 400, (error as Error).message), true); }
    if (descTooLong(description)) return (sendErr(res, 400, DESC_TOO_LONG), true);
    const runtimeModelError = b.modelBinding === undefined
      ? validateRuntimeModel(b.runtime || "claude", b.model)
      : null;
    if (runtimeModelError) return (sendErr(res, 400, runtimeModelError), true);
    // Machine assignment is retired. Reject the old field explicitly so stale clients do not appear to succeed.
    if (Object.prototype.hasOwnProperty.call(b, "machineId")) return (sendErr(res, 400, "machineId is no longer supported"), true);
    // A live agent name must be unique per Space — it is the @mention / dm:@<name> routing key, so a duplicate
    // becomes an unreachable routing blind spot. ON CONFLICT against the agents_name_uniq partial index is
    // race-proof (no SELECT-then-INSERT gap): a duplicate live name inserts no row → friendly 409. Soft-deleted
    // names are excluded by the index predicate, so a deleted agent's name can be reused.
    let modelBinding: ReturnType<AgentModelBindingService["resolve"]> | null = null;
    if (b.modelBinding?.mode === "runtime_default") {
      modelBinding = new AgentModelBindingService().resolve(b.runtime || "claude", { mode: "runtime_default" });
    } else if (b.modelBinding?.mode === "pinned"
      && typeof b.modelBinding.modelConfigurationId === "string"
      && Number.isSafeInteger(b.modelBinding.modelConfigurationRevision)) {
      try {
        modelBinding = new AgentModelBindingService().resolve(b.runtime || "claude", {
          mode: "pinned", modelConfigurationId: b.modelBinding.modelConfigurationId,
          modelConfigurationRevision: b.modelBinding.modelConfigurationRevision,
        });
      } catch (error: any) {
        return (sendErr(res, 409, error?.message ?? "model binding unavailable", { code: error?.code }), true);
      }
    } else if (b.modelBinding !== undefined) {
      return (sendErr(res, 400, "invalid model binding"), true);
    }
    const requestedRuntime = b.runtime || "claude";
    const useV2 = Object.prototype.hasOwnProperty.call(RUNTIME_V2_CAPABILITY_MATRIX, requestedRuntime);
    if (useV2) {
      if (modelBinding === null) {
        return (sendErr(res, 409, "Harness v2 Agent requires an explicit model binding", {
          code: "model_binding_required",
        }), true);
      }
      if (modelBinding.modelBindingState !== "ready") {
        return (sendErr(res, 409, "Harness v2 Agent requires a ready model binding before creation", {
          code: "model_binding_setup_required",
          modelBindingState: modelBinding.modelBindingState,
        }), true);
      }
    }
    const [agent] = await db.insert(schema.agents).values({
      spaceId, name: b.name, displayName: b.displayName || b.name, description,
      ...(modelBinding ?? {}),
      model: modelBinding?.model ?? (b.model || null), runtime: requestedRuntime,
      runtimeConfig: { provider: b.provider ?? "default", model: b.model ?? null, reasoningEffort: b.reasoning ?? null, mode: b.fastMode ? "fast" : "default" },
      envVars: b.envVars ?? {}, executionMode: b.fastMode ? "fast" : "auto", creatorType: "human", creatorId: humanId,
    }).onConflictDoNothing().returning();
    if (!agent) return (sendErr(res, 409, `an agent named "${b.name}" already exists`), true);
    const runtime = agent!.runtime as keyof typeof RUNTIME_V2_CAPABILITY_MATRIX;
    let started = false;
    if (useV2) {
      try {
        const introduction = await initializeNewV2Agent(spaceId, agent!.id);
        const bindingReady = modelBinding?.modelBindingState === "ready";
        const workerReady = bindingReady && isWorkerConnected() && workerRuntimes().includes(runtime);
        await db.update(schema.agents).set({ activity: workerReady ? "working" : "offline" }).where(eq(schema.agents.id, agent!.id));
        await publish(spaceId, { type: "dm:new", channelId: introduction.channel.id, participantHumanIds: [humanId] });
        await publish(spaceId, {
          type: "message",
          channelId: introduction.channel.id,
          message: { ...serializeMessage(introduction.message, [], []), channelType: "dm" },
        });
        started = workerReady;
      } catch (error) {
        await db.delete(schema.agents).where(eq(schema.agents.id, agent!.id));
        throw error;
      }
    }
    const all = (await db.select().from(schema.channels).where(and(eq(schema.channels.spaceId, spaceId), eq(schema.channels.name, "all"))))[0];
    // Join #all at the channel watermark, NOT lastReadSeq=0 — a newly created agent must not have its first
    // `message check` flooded with the channel's entire pre-existing history (it only needs messages from now on).
    if (all) await addChannelMembers(spaceId, all.id, [{ type: "agent", id: agent!.id }]);
    const created = db.select().from(schema.agents).where(eq(schema.agents.id, agent!.id)).get()!;
    await publish(spaceId, { type: "agent:created", agent: { id: created.id, name: created.name, displayName: created.displayName, description: created.description, status: created.status, activity: created.activity, model: created.model, runtime: created.runtime, defaultResponseMode: created.defaultResponseMode } });
    // Start immediately on create: the client only POSTs /agents. If the local Worker is offline,
    // startAgent returns ok:false without blocking creation.
    if (useV2 && modelBinding?.modelBindingState === "ready") await scheduleV2Turns(spaceId);
    else started = (await startAgent(spaceId, agent!.id, "create")).ok;
    return (sendJson(res, 200, { id: agent!.id, name: agent!.name, started }), true);
  }
  const am = /^\/api\/agents\/([^/]+)$/.exec(p);
  if (am && method === "GET") {
    const a = (await db.select().from(schema.agents).where(and(eq(schema.agents.id, am[1]!), eq(schema.agents.spaceId, spaceId))))[0];
    return (a ? sendJson(res, 200, {
      id: a.id, spaceId: a.spaceId, name: a.name, displayName: a.displayName,
      avatarUrl: a.avatarUrl, description: a.description, status: a.status, activity: a.activity,
      sessionId: a.sessionId, model: a.model, runtime: a.runtime, runtimeConfig: a.runtimeConfig,
      executionMode: a.executionMode, envVars: a.envVars, scopes: a.scopes,
      modelBindingMode: a.modelBindingMode, modelConfigurationId: a.modelConfigurationId,
      modelConfigurationRevision: a.modelConfigurationRevision, modelConfigurationLabel: a.modelBindingLabelSnapshot,
      modelFingerprint: a.modelBindingFingerprint,
      effectiveProviderSnapshot: a.confirmedEffectiveProviderSnapshot,
      installationIdentityDigest: a.confirmedInstallationIdentityDigest,
      modelBindingState: a.modelBindingState, runtimeRestartRequired: a.runtimeRestartRequired,
      defaultResponseMode: a.defaultResponseMode,
      creatorType: a.creatorType, creatorId: a.creatorId, createdAt: a.createdAt,
    }) : sendErr(res, 404, "agent not found"), true);
  }
  if (am && method === "PATCH") {
    const b = await readJson(req); const patch: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(b, "machineId")) return (sendErr(res, 400, "machineId is no longer supported"), true);
    if (descTooLong(b.description)) return (sendErr(res, 400, DESC_TOO_LONG), true);
    const harnessMode = new SessionModule(spaceId, db).harnessMode(am[1]!);
    if (b.runtime !== undefined && harnessMode === "v2"
      && !Object.prototype.hasOwnProperty.call(RUNTIME_V2_CAPABILITY_MATRIX, String(b.runtime))) {
      return (sendErr(res, 409, "rollback the Agent to legacy before selecting a runtime without Harness v2 support", { code: "harness_runtime_unsupported" }), true);
    }
    if ((b.runtime !== undefined || b.model !== undefined) && harnessMode === "v2") {
      if (!b.modelBinding) {
        return (sendErr(res, 400, "Harness v2 runtime/model changes require an explicit model binding", {
          code: "model_binding_required",
        }), true);
      }
      const activeTurn = db.select({ id: schema.agentTurns.id }).from(schema.agentTurns).where(and(
        eq(schema.agentTurns.agentId, am[1]!),
        inArray(schema.agentTurns.status, ["pending", "running", "retry_wait"]),
      )).get();
      if (activeTurn) return (sendErr(res, 409, "runtime or model cannot change while an Agent turn is non-terminal", { code: "agent_turn_active", turnId: activeTurn.id }), true);
    }
    for (const k of ["displayName", "description", "avatarUrl"]) if (b[k] !== undefined) patch[k] = b[k];
    if (harnessMode === "v2" && b.modelBinding) {
      const existing = db.select({ runtime: schema.agents.runtime }).from(schema.agents)
        .where(and(eq(schema.agents.id, am[1]!), eq(schema.agents.spaceId, spaceId))).get();
      const runtime = String(b.runtime ?? existing?.runtime ?? "");
      try {
        const resolved = b.modelBinding.mode === "runtime_default"
          ? new AgentModelBindingService().resolve(runtime as any, { mode: "runtime_default" })
          : new AgentModelBindingService().resolve(runtime as any, {
            mode: "pinned",
            modelConfigurationId: String(b.modelBinding.modelConfigurationId ?? ""),
            modelConfigurationRevision: Number(b.modelBinding.modelConfigurationRevision),
          });
        Object.assign(patch, resolved, { runtime, model: resolved.model });
      } catch (error: any) {
        return (sendErr(res, 409, error?.message ?? "model binding unavailable", { code: error?.code }), true);
      }
    } else {
      if (b.runtime !== undefined) patch.runtime = b.runtime;
      if (b.model !== undefined) patch.model = b.model;
    }
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
    if (harnessMode === "v2" && patch.modelBindingState === "ready") await scheduleV2Turns(spaceId);
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
    await new AdvisorProviderSettingsService().revokeAgent(spaceId, am[1]!);
    await stopAgent(spaceId, am[1]!).catch(() => {}); // stop the local process before deleting
    await deleteAgentAndPrivateConversations(spaceId, am[1]!);
    clearAgentIntroductionTurns(spaceId, am[1]!);
    await publish(spaceId, { type: "agent:deleted", id: am[1]! });
    return (sendJson(res, 200, { ok: true }), true);
  }
  // Agent lifecycle: start / stop / reset
  const alc = /^\/api\/agents\/([^/]+)\/(start|stop|reset|restart)$/.exec(p);
  if (alc && method === "POST") {
    const [, agId, action] = alc;
    if (action === "start") { const r = await startAgent(spaceId, agId!); return (r.ok ? sendJson(res, 200, { ok: true, ...(r.inboxSummary ? { inboxSummary: r.inboxSummary } : {}) }) : sendErr(res, 503, r.reason ?? "cannot start")), true; }
    if (action === "stop") { await stopAgent(spaceId, agId!); return (sendJson(res, 200, { ok: true }), true); }
    if (action === "restart") { await stopAgent(spaceId, agId!); const r = await startAgent(spaceId, agId!); return (r.ok ? sendJson(res, 200, { ok: true }) : sendErr(res, 503, r.reason ?? "cannot start")), true; } // preserves session and workspace; restarts only the process
    const b = await readJson(req).catch(() => ({}));
    const clearAgentMemory = !!(b?.clearAgentMemory || b?.clearMemory || b?.wipeWorkspace); // accept old field names without preserving their unsafe semantics
    await resetAgent(spaceId, agId!, clearAgentMemory);
    if (b?.restart) await startAgent(spaceId, agId!); // Worker serializes same-agent reset/start so cleanup completes before the new runtime begins.
    return (sendJson(res, 200, { ok: true }), true);
  }
  const harness = /^\/api\/agents\/([^/]+)\/harness$/.exec(p);
  if (harness && method === "POST") {
    const agentId = harness[1]!;
    const body = await readJson(req).catch(() => ({}));
    const action = String(body.action ?? "");
    const sessions = new SessionModule(spaceId, db);
    if (action === "migrate") {
      const currentMode = sessions.harnessMode(agentId);
      if (currentMode !== "legacy" && currentMode !== "migrating") return (sendErr(res, 409, "Agent is not in a migratable harness mode"), true);
      let backfilled: number;
      if (currentMode === "legacy") {
        beginLegacyDataPlaneDrain(agentId);
        try {
          await stopAgent(spaceId, agentId);
          await waitForLegacyDataPlaneDrain(agentId);
          backfilled = migrateExistingAgentToV2(spaceId, agentId, "human_requested_cutover");
        } catch (error) {
          return (sendErr(res, 409, error instanceof Error ? error.message : "legacy Agent data plane did not drain", { code: "harness_cutover_drain_failed" }), true);
        } finally {
          endLegacyDataPlaneDrain(agentId);
        }
      } else {
        backfilled = migrateExistingAgentToV2(spaceId, agentId, "human_requested_cutover_resume");
      }
      await db.update(schema.agents).set({ status: "active", activity: "offline" }).where(eq(schema.agents.id, agentId));
      await scheduleV2Turns(spaceId);
      return (sendJson(res, 200, { ok: true, mode: "v2", backfilled }), true);
    }
    if (action === "rollback") {
      let rollbackAcceptedAt: number;
      try {
        rollbackAcceptedAt = sessions.assertRollbackWindow(agentId);
      } catch (error) {
        return (sendErr(res, 409, error instanceof Error ? error.message : "Agent rollback window is unavailable", { code: "harness_rollback_unavailable" }), true);
      }
      if (!canRollbackV2Agent(spaceId, agentId)) return (sendErr(res, 409, "v2 turns or delivery items must be drained before rollback"), true);
      if (isWorkerConnected()) await harnessTurnScheduler.closeAgentSessions(spaceId, agentId, "stop");
      const sessionIds = db.select({ id: schema.runtimeSessions.id }).from(schema.runtimeSessions)
        .where(and(eq(schema.runtimeSessions.agentId, agentId), isNull(schema.runtimeSessions.retiredAt))).all();
      for (const session of sessionIds) turnCapabilityService(spaceId).closeSession(session.id);
      sessions.rollbackToLegacy(agentId, { v2Drained: true, reason: "human_requested_rollback", acceptedAt: rollbackAcceptedAt });
      return (sendJson(res, 200, { ok: true, mode: "legacy" }), true);
    }
    return (sendErr(res, 400, "action must be migrate or rollback"), true);
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
    const sources = await loadAgentActivitySources(db, rows);
    return (sendJson(res, 200, rows.reverse().map((r) => ({
      timestamp: r.ts,
      streamId: r.streamId ?? undefined,
      source: sources.get(r.id) ?? null,
      entry: {
        kind: r.kind === "tool" ? "tool_start" : r.kind,
        activity: r.activity,
        detail: r.detail,
        text: r.text,
        toolName: r.toolName,
        toolInput: r.toolInput,
      },
    }))), true);
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
