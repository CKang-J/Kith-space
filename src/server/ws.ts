// Installation-local runtime worker control plane: WS /daemon/connect with a private header.
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { Server } from "node:http";
import { and, desc, eq, isNull, notInArray } from "drizzle-orm";
import { allSpaceDbs, dbForSpace, schema } from "../db/index.js";
import { safeEqual } from "./auth.js";
import { publish } from "./realtime.js";
import { createLogger } from "../log.js";
import { catchUpAgentsOnWorker } from "./reconnectCatchup.js";
import { WORKER_REJECTED_CODE } from "../daemonProtocol.js";
import { locateAgent } from "../local-runtime/agentLocator.js";
import { WORKER_TOKEN_HEADER, isLoopbackAddress, workerBootstrapToken } from "../local-runtime/internalCredentials.js";
import { resolveTrajectoryScope } from "./trajectoryScope.js";
import { createWorkerMessageQueue } from "./workerMessageQueue.js";
import { terminalWakeReplyEvent } from "./workerQueueOutcome.js";
import type { WorkerQueueOutcome } from "../runtime/contract/runtimeWorkerPort.js";
import {
  isWorkerLeaseCurrent,
  isWorkerLeaseLatest,
  registerWorker,
  resolveWorkerAdmission,
  resolveWorkerRequest,
  unregisterWorker,
  updateWorkerSnapshot,
  type WorkerLease,
} from "../local-runtime/workerHub.js";
import { SessionModule } from "../sessions/sessionModule.js";
import { MAX_RUNTIME_TERMINAL_BYTES, RuntimeEventEnvelopeSchema, RuntimeTurnResultSchema, type RuntimeTurnResult } from "../runtime/contract/v2/runtimeContract.js";
import { TurnLedger } from "../turns/turnLedger.js";
import { harnessTurnScheduler, scheduleV2Turns, turnCapabilityService, turnOutputService } from "./harnessComposition.js";

const log = createLogger("server:ws");

export function attachWs(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "", "http://localhost");
    if (url.pathname !== "/daemon/connect") return; // pass through: /socket.io/ etc. are handled by socket.io's own upgrade handler
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      return socket.destroy();
    }
    const supplied = req.headers[WORKER_TOKEN_HEADER];
    const key = typeof supplied === "string" ? supplied : null;
    if (!key) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, (ws) => void onWorker(ws, key));
  });
}

async function onWorker(ws: WebSocket, key: string): Promise<void> {
  if (!safeEqual(key, workerBootstrapToken())) {
    ws.close(WORKER_REJECTED_CODE, "invalid local runtime worker token");
    return;
  }
  const lease = registerWorker(ws);
  log.info("local runtime worker connected");
  const ping = setInterval(() => {
    if (!isWorkerLeaseCurrent(lease)) return;
    try { ws.send(JSON.stringify({ type: "ping" })); } catch { /* close/error handles the connection */ }
  }, 30000);

  const enqueueMessage = createWorkerMessageQueue<RawData>(async (data) => {
    if (!isWorkerLeaseCurrent(lease)) return;
    let msg: any; try { msg = JSON.parse(data.toString()); } catch { return; }
    try {
      if (msg.type === "ready") {
        const runtimes = stringList(msg.runtimes);
        const runningAgents = stringList(msg.runningAgents);
        if (!updateWorkerSnapshot(lease, { runtimes, runningAgents })) return;
        if (!await reconcileWorkerReady(runningAgents, lease)) return;
        if (!isWorkerLeaseCurrent(lease)) return;
        try { ws.send(JSON.stringify({ type: "ready:ack", generation: lease.generation })); } catch { /* */ }
        void catchUpAgentsOnWorker(runningAgents, lease)
          .catch((e: any) => log.error("worker reconnect catch-up failed", { detail: String(e?.message ?? e) }));
        for (const { space } of allSpaceDbs()) {
          if (!isWorkerLeaseCurrent(lease)) return;
          void scheduleV2Turns(space.id).catch((e: any) => log.error("v2 turn recovery failed", { spaceId: space.id, detail: String(e?.message ?? e) }));
        }
        log.info("local runtime worker ready", { runtimes, runningAgents: runningAgents.length, daemonVersion: msg.daemonVersion });
      }
      else if (msg.type === "agent:turn:event") {
        await onTurnEvent(ws, msg, lease);
      }
      else if (msg.type === "agent:turn:terminal") {
        await onTurnTerminal(ws, msg, lease);
      }
      else if (msg.type === "agent:status" || msg.type === "agent:activity") await onAgentUpdate(msg, lease);
      else if (msg.type === "agent:session" && msg.agentId) {
        const located = await locateAgent(msg.agentId);
        if (!located || !isWorkerLeaseCurrent(lease)) return;
        if (new SessionModule(located.spaceId, located.db).harnessMode(msg.agentId) !== "legacy") return;
        await located.db.update(schema.agents).set({ sessionId: msg.sessionId }).where(eq(schema.agents.id, msg.agentId));
        if (!isWorkerLeaseCurrent(lease)) return;
        await publish(located.spaceId, { type: "agent:session", agentId: msg.agentId, sessionId: msg.sessionId });
      }
      else if (msg.type === "agent:trajectory" && msg.agentId) {
        const located = await locateAgent(msg.agentId);
        if (!located || !isWorkerLeaseCurrent(lease)) return;
        if (new SessionModule(located.spaceId, located.db).harnessMode(msg.agentId) !== "legacy") return;
        const trajectoryScope = await resolveTrajectoryScope(located.db, msg);
        if (!isWorkerLeaseCurrent(lease)) return;
        await publish(located.spaceId, { type: "trajectory", agentId: msg.agentId, name: located.agent.name, entries: msg.entries ?? [], ...trajectoryScope });
        if (!isWorkerLeaseCurrent(lease)) return;
        for (const e of msg.entries ?? []) {
          if (!isWorkerLeaseCurrent(lease)) return;
          await logActivity(located.spaceId, msg.agentId, e);
          if (!isWorkerLeaseCurrent(lease)) return;
        }
      }
      else if (msg.type === "agent:reply" && msg.agentId && msg.channelId && msg.streamId) {
        const located = await locateAgent(msg.agentId);
        if (!located || !isWorkerLeaseCurrent(lease)) return;
        if (new SessionModule(located.spaceId, located.db).harnessMode(msg.agentId) !== "legacy") return;
        await publish(located.spaceId, { type: "agent:reply", agentId: msg.agentId, channelId: msg.channelId, streamId: msg.streamId, name: msg.name ?? located.agent.displayName ?? located.agent.name, op: msg.op, text: msg.text ?? "" });
      }
      else if (msg.type === "worker:admission") {
        resolveWorkerAdmission(lease, msg);
      }
      else if (msg.type === "worker:queue:outcome") {
        const outcome = msg as WorkerQueueOutcome;
        if (msg.source === "wake" && typeof msg.id === "string" && typeof msg.spaceId === "string"
          && (msg.status === "cancelled" || msg.status === "expired" || msg.status === "failed")) {
          const { SqliteDispatchState } = await import("./dispatchGuard.js");
          await new SqliteDispatchState(msg.spaceId).markWakePending(msg.id);
          const located = typeof msg.agentId === "string" ? await locateAgent(msg.agentId) : null;
          if (located && located.spaceId === msg.spaceId && isWorkerLeaseCurrent(lease)) {
            const reply = terminalWakeReplyEvent(outcome, located.agent.displayName ?? located.agent.name);
            if (reply) await publish(located.spaceId, reply);
          }
        }
        log.debug("runtime queue outcome", {
          status: msg.status,
          source: msg.source,
          agentId: msg.agentId,
          spaceId: msg.spaceId,
          queuedMs: msg.queuedMs,
        });
      }
      else if ((msg.type === "workspace:file_tree" || msg.type === "workspace:file_content" || msg.type === "skills:list" || msg.type === "models") && msg.requestId) resolveWorkerRequest(msg.requestId, msg);
    } catch (e: any) { log.error("ws handler error", { type: msg?.type, detail: String(e?.message ?? e) }); }
  }, (error) => {
    log.error("ws message queue error", { detail: String((error as any)?.message ?? error) });
  });
  ws.on("message", (data) => { void enqueueMessage(data); });
  ws.on("close", async () => {
    clearInterval(ping);
    const wasCurrent = unregisterWorker(lease);
    if (wasCurrent) await markAllAgentsOffline(lease).catch((e: any) => log.error("agent offline reconcile failed", { detail: String(e?.message ?? e) }));
    log.info("local runtime worker disconnected", { wasCurrent });
  });
  ws.on("error", () => { /* close will follow */ });
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function reconcileWorkerReady(runningIds: string[], lease: WorkerLease): Promise<boolean> {
  if (!isWorkerLeaseCurrent(lease)) return false;
  const running = new Set(runningIds);
  for (const { space, db } of allSpaceDbs()) {
    if (!isWorkerLeaseCurrent(lease)) return false;
    const agents = await db.select().from(schema.agents).where(isNull(schema.agents.deletedAt));
    if (!isWorkerLeaseCurrent(lease)) return false;
    for (const agent of agents) {
      if (!isWorkerLeaseCurrent(lease)) return false;
      if (new SessionModule(space.id, db).harnessMode(agent.id) !== "legacy") continue;
      if (running.has(agent.id)) {
        const activity = agent.activity === "offline" || agent.activity === "sleeping" ? "online" : agent.activity;
        if (agent.status === "active" && activity === agent.activity) continue;
        await db.update(schema.agents).set({ status: "active", activity }).where(eq(schema.agents.id, agent.id));
        if (!isWorkerLeaseCurrent(lease)) return false;
        await publish(space.id, { type: "agent", id: agent.id, name: agent.name, status: "active", activity });
        if (!isWorkerLeaseCurrent(lease)) return false;
        continue;
      }
      if (agent.status === "sleeping" || agent.activity === "sleeping") continue;
      if (agent.status === "inactive" && agent.activity === "offline") continue;
      await db.update(schema.agents).set({ status: "inactive", activity: "offline" }).where(eq(schema.agents.id, agent.id));
      if (!isWorkerLeaseCurrent(lease)) return false;
      await publish(space.id, { type: "agent", id: agent.id, name: agent.name, status: "inactive", activity: "offline" });
      if (!isWorkerLeaseCurrent(lease)) return false;
    }
  }
  return isWorkerLeaseCurrent(lease);
}

export async function markAllAgentsOffline(lease: WorkerLease): Promise<boolean> {
  if (!isWorkerLeaseLatest(lease)) return false;
  for (const { space, db } of allSpaceDbs()) {
    if (!isWorkerLeaseLatest(lease)) return false;
    const agents = await db.select().from(schema.agents)
      .where(and(isNull(schema.agents.deletedAt), eq(schema.agents.status, "active")));
    if (!isWorkerLeaseLatest(lease)) return false;
    for (const agent of agents) {
      if (!isWorkerLeaseLatest(lease)) return false;
      if (new SessionModule(space.id, db).harnessMode(agent.id) !== "legacy") continue;
      await db.update(schema.agents).set({ status: "inactive", activity: "offline" }).where(eq(schema.agents.id, agent.id));
      if (!isWorkerLeaseLatest(lease)) return false;
      await publish(space.id, { type: "agent", id: agent.id, name: agent.name, status: "inactive", activity: "offline" });
      if (!isWorkerLeaseLatest(lease)) return false;
    }
  }
  return isWorkerLeaseLatest(lease);
}

async function onTurnEvent(ws: WebSocket, msg: any, lease: WorkerLease): Promise<void> {
  const eventId = typeof msg?.event?.eventId === "string" ? msg.event.eventId : "";
  try {
    if (!isWorkerLeaseCurrent(lease)) throw new Error("stale Worker lease");
    const event = RuntimeEventEnvelopeSchema.parse(msg.event);
    if (event.workerGeneration !== lease.generation) throw new Error("stale Worker generation");
    const db = dbForSpaceForTurn(event.turnId, event.attemptId, event.sessionId);
    if (!db) throw new Error("turn event target not found");
    const inserted = new TurnLedger(db.spaceId, db.db).appendEvent(event);
    if (inserted) {
      await projectTurnEvent(db.spaceId, db.db, event).catch((error) => {
        log.warn("v2 turn event projection failed after durable append", { eventId: event.eventId, detail: errorMessage(error) });
      });
    }
    if (!isWorkerLeaseCurrent(lease)) throw new Error("Worker lease changed during event commit");
    ws.send(JSON.stringify({ type: "agent:turn:event:ack", eventId: event.eventId, ok: true }));
  } catch (error) {
    if (eventId && isWorkerLeaseCurrent(lease)) {
      ws.send(JSON.stringify({ type: "agent:turn:event:ack", eventId, ok: false, error: errorMessage(error) }));
    }
  }
}

async function onTurnTerminal(ws: WebSocket, msg: any, lease: WorkerLease): Promise<void> {
  const attemptId = typeof msg.attemptId === "string" ? msg.attemptId : "";
  let spaceId: string | null = null;
  try {
    if (Buffer.byteLength(JSON.stringify(msg), "utf8") > MAX_RUNTIME_TERMINAL_BYTES) throw new Error("runtime terminal envelope exceeds the byte limit");
    if (!attemptId || msg.generation !== lease.generation || !isWorkerLeaseCurrent(lease)) throw new Error("stale Worker terminal state");
    if (typeof msg.turnId !== "string" || typeof msg.sessionId !== "string" || !Number.isInteger(msg.sessionGeneration)) {
      throw new Error("invalid Worker terminal identity");
    }
    const located = dbForSpaceForTurn(msg.turnId, attemptId, msg.sessionId);
    if (!located) throw new Error("turn terminal target not found");
    spaceId = located.spaceId;
    const attempt = located.db.select().from(schema.agentTurnAttempts).where(eq(schema.agentTurnAttempts.id, attemptId)).get();
    const turn = located.db.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, msg.turnId)).get();
    if (!attempt || !turn || attempt.workerGeneration !== lease.generation || turn.sessionGeneration !== msg.sessionGeneration
      || msg.agentId !== turn.agentId || msg.spaceId !== turn.spaceId) {
      throw new Error("turn terminal identity does not match its live attempt");
    }
    if (["succeeded", "failed", "cancelled", "lost"].includes(attempt.status)) {
      if (!isWorkerLeaseCurrent(lease)) throw new Error("Worker lease changed before duplicate terminal acknowledgement");
      ws.send(JSON.stringify({ type: "agent:turn:terminal:ack", attemptId, ok: true }));
      return;
    }
    const result = runtimeTurnResult(msg.result);
    const ledger = new TurnLedger(spaceId, located.db);
    ledger.markRuntimeTerminal(attemptId, result);
    turnCapabilityService(spaceId).revokeAttempt(attemptId);
    let completed = false;
    if (result.outcome === "completed") {
      const finalized = turnOutputService(spaceId).finalizeAttempt(attemptId);
      completed = finalized.finalized;
      if (!finalized.finalized) ledger.failAttempt(attemptId, "required_input_unresolved");
    }
    await projectTurnTerminal(spaceId, located.db, turn, attemptId, result, completed).catch((error) => {
      log.warn("v2 turn terminal projection failed after durable commit", { attemptId, detail: errorMessage(error) });
    });
    harnessTurnScheduler.finishAttempt(spaceId, attemptId);
    if (!isWorkerLeaseCurrent(lease)) throw new Error("Worker lease changed during terminal commit");
    ws.send(JSON.stringify({ type: "agent:turn:terminal:ack", attemptId, ok: true }));
  } catch (error) {
    if (attemptId && isWorkerLeaseCurrent(lease)) {
      ws.send(JSON.stringify({ type: "agent:turn:terminal:ack", attemptId, ok: false, error: errorMessage(error) }));
    }
  }
}

function dbForSpaceForTurn(turnId: string, attemptId: string, sessionId: string): { spaceId: string; db: ReturnType<typeof dbForSpace> } | null {
  for (const { space, db } of allSpaceDbs()) {
    const turn = db.select().from(schema.agentTurns).where(and(
      eq(schema.agentTurns.id, turnId),
      eq(schema.agentTurns.runtimeSessionId, sessionId),
    )).get();
    if (!turn) continue;
    const attempt = db.select().from(schema.agentTurnAttempts).where(and(
      eq(schema.agentTurnAttempts.id, attemptId),
      eq(schema.agentTurnAttempts.turnId, turnId),
    )).get();
    if (attempt) return { spaceId: space.id, db };
  }
  return null;
}

function runtimeTurnResult(value: unknown): RuntimeTurnResult {
  return RuntimeTurnResultSchema.parse(value);
}

async function projectTurnEvent(
  spaceId: string,
  db: ReturnType<typeof dbForSpace>,
  event: import("../runtime/contract/v2/runtimeContract.js").RuntimeEventEnvelope,
): Promise<void> {
  const turn = db.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, event.turnId)).get();
  const session = turn ? db.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.id, turn.runtimeSessionId)).get() : null;
  const agent = turn ? db.select().from(schema.agents).where(eq(schema.agents.id, turn.agentId)).get() : null;
  if (!turn || !session || !agent) return;
  const scope = { scope: "scoped", channelId: session.surfaceId, conversationId: session.surfaceId, streamId: turn.id };
  const text = typeof event.payload.text === "string" ? event.payload.text : "";
  const toolName = typeof event.payload.toolName === "string" ? event.payload.toolName : "";
  const toolInput = typeof event.payload.toolInput === "string" ? event.payload.toolInput : "";
  const activity = event.kind === "thinking_summary" ? "thinking" : "working";
  if (event.kind === "turn_started" || event.kind === "thinking_summary" || event.kind === "tool_started" || event.kind === "activity") {
    db.update(schema.agents).set({ status: "active", activity }).where(eq(schema.agents.id, agent.id)).run();
    await publish(spaceId, { type: "agent", id: agent.id, name: agent.name, status: "active", activity, detail: text.slice(0, 200), ...scope });
  }
  if (event.kind === "thinking_summary" || event.kind === "text_preview" || event.kind === "tool_started" || event.kind === "tool_completed" || event.kind === "tool_failed") {
    await publish(spaceId, {
      type: "trajectory",
      agentId: agent.id,
      name: agent.name,
      entries: [{
        kind: toolName ? "tool" : event.kind === "thinking_summary" ? "thinking" : "text",
        text: text.slice(0, 2_000),
        ...(toolName ? { toolName, toolInput: toolInput.slice(0, 1_000) } : {}),
      }],
      ...scope,
    });
  }
  if (turn.effectiveDirective === "required") {
    if (event.kind === "turn_started") {
      await publish(spaceId, { type: "agent:reply", agentId: agent.id, channelId: session.surfaceId, streamId: turn.id, name: agent.displayName || agent.name, op: "start", text: "" });
    } else if (event.kind === "text_preview" && text) {
      await publish(spaceId, { type: "agent:reply", agentId: agent.id, channelId: session.surfaceId, streamId: turn.id, name: agent.displayName || agent.name, op: "delta", text });
    }
  }
  await logActivity(spaceId, agent.id, {
    kind: toolName ? "tool" : event.kind,
    activity,
    detail: event.kind,
    ...(toolName ? { toolName, toolInput: toolInput.slice(0, 500) } : {}),
    ...(event.kind === "thinking_summary" ? { text: text.slice(0, 200) } : {}),
  });
}

async function projectTurnTerminal(
  spaceId: string,
  db: ReturnType<typeof dbForSpace>,
  turn: typeof schema.agentTurns.$inferSelect,
  attemptId: string,
  result: RuntimeTurnResult,
  completed: boolean,
): Promise<void> {
  const session = db.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.id, turn.runtimeSessionId)).get();
  const agent = db.select().from(schema.agents).where(eq(schema.agents.id, turn.agentId)).get();
  if (!session || !agent) return;
  const activity = completed ? "online" : "error";
  const detail = completed ? "" : result.outcome === "completed" ? "required input unresolved; retry scheduled" : result.errorCode ?? `runtime ${result.outcome}`;
  db.update(schema.agents).set({ status: "active", activity }).where(eq(schema.agents.id, agent.id)).run();
  const scope = { scope: "scoped", channelId: session.surfaceId, conversationId: session.surfaceId, streamId: turn.id };
  await publish(spaceId, { type: "agent", id: agent.id, name: agent.name, status: "active", activity, detail, ...scope });
  if (turn.effectiveDirective === "required") {
    await publish(spaceId, { type: "agent:reply", agentId: agent.id, channelId: session.surfaceId, streamId: turn.id, name: agent.displayName || agent.name, op: completed ? "done" : "error", text: detail });
  }
  await logActivity(spaceId, agent.id, { kind: "status", activity, detail, attemptId });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function onAgentUpdate(msg: any, lease: WorkerLease): Promise<void> {
  if (!msg.agentId) return;
  const located = await locateAgent(msg.agentId);
  if (!located || !isWorkerLeaseCurrent(lease)) return;
  if (new SessionModule(located.spaceId, located.db).harnessMode(msg.agentId) !== "legacy") return;
  const patch: Record<string, unknown> = {};
  if (msg.type === "agent:status") patch.status = msg.status;
  if (msg.type === "agent:activity") patch.activity = msg.activity;
  await located.db.update(schema.agents).set(patch).where(eq(schema.agents.id, msg.agentId));
  if (!isWorkerLeaseCurrent(lease)) return;
  const agent = (await located.db.select().from(schema.agents).where(eq(schema.agents.id, msg.agentId)))[0];
  if (!isWorkerLeaseCurrent(lease)) return;
  const trajectoryScope = await resolveTrajectoryScope(located.db, msg);
  if (!isWorkerLeaseCurrent(lease)) return;
  if (agent) await publish(located.spaceId, { type: "agent", id: agent.id, name: agent.name, status: agent.status, activity: agent.activity, detail: msg.detail ?? "", ...trajectoryScope });
  if (!isWorkerLeaseCurrent(lease)) return;
  if (msg.type === "agent:activity") {
    await logActivity(located.spaceId, msg.agentId, { kind: "status", activity: msg.activity, detail: msg.detail });
  }
}

// Per-agent retention cap for the activity log. Agents stream trajectory entries continuously, so this
// table would otherwise grow unbounded; we keep only the newest ACTIVITY_LOG_CAP rows per agent (pruned on
// insert). The read endpoint (GET /api/agents/:id/activity-log) already caps at 200, so 500 leaves headroom.
// Trade-off (high-frequency inserts → a prune per insert) tracked in docs/tech-debt-tracker.md.
export const ACTIVITY_LOG_CAP = 500;

// Delete all but the newest ACTIVITY_LOG_CAP rows (by ts) for one agent. Uses the (agentId, ts) index.
export async function pruneAgentActivityLog(spaceId: string, agentId: string): Promise<void> {
  const db = dbForSpace(spaceId);
  const keep = db.select({ id: schema.agentActivityLog.id }).from(schema.agentActivityLog)
    .where(eq(schema.agentActivityLog.agentId, agentId)).orderBy(desc(schema.agentActivityLog.ts)).limit(ACTIVITY_LOG_CAP);
  await db.delete(schema.agentActivityLog).where(and(eq(schema.agentActivityLog.agentId, agentId), notInArray(schema.agentActivityLog.id, keep)));
}

// Persist activity to the DB (daemon-pushed status/trajectory entries → agent_activity_log, feeds the activity facet history + timeline)
export async function logActivity(spaceId: string, agentId: string, e: any): Promise<void> {
  const db = dbForSpace(spaceId);
  const kind = e.kind === "tool" ? "tool_start" : (e.kind || (e.toolName ? "tool_start" : "text"));
  try {
    await db.insert(schema.agentActivityLog).values({
      spaceId, agentId, ts: Date.now(), kind,
      activity: e.activity ?? null, detail: e.detail ?? null, text: e.text ?? null,
      toolName: e.toolName ?? null, toolInput: e.toolInput ?? null,
    });
    await pruneAgentActivityLog(spaceId, agentId); // keep the table bounded per agent (newest ACTIVITY_LOG_CAP)
  } catch { /* logging failure must not block */ }
}
