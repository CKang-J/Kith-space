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
        log.info("local runtime worker ready", { runtimes, runningAgents: runningAgents.length, daemonVersion: msg.daemonVersion });
      }
      else if (msg.type === "agent:status" || msg.type === "agent:activity") await onAgentUpdate(msg, lease);
      else if (msg.type === "agent:session" && msg.agentId) {
        const located = await locateAgent(msg.agentId);
        if (!located || !isWorkerLeaseCurrent(lease)) return;
        await located.db.update(schema.agents).set({ sessionId: msg.sessionId }).where(eq(schema.agents.id, msg.agentId));
        if (!isWorkerLeaseCurrent(lease)) return;
        await publish(located.spaceId, { type: "agent:session", agentId: msg.agentId, sessionId: msg.sessionId });
      }
      else if (msg.type === "agent:trajectory" && msg.agentId) {
        const located = await locateAgent(msg.agentId);
        if (!located || !isWorkerLeaseCurrent(lease)) return;
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
        await publish(located.spaceId, { type: "agent:reply", agentId: msg.agentId, channelId: msg.channelId, streamId: msg.streamId, name: msg.name ?? located.agent.displayName ?? located.agent.name, op: msg.op, text: msg.text ?? "" });
      }
      else if (msg.type === "worker:admission") {
        resolveWorkerAdmission(lease, msg);
      }
      else if (msg.type === "worker:queue:outcome") {
        if (msg.source === "wake" && typeof msg.id === "string" && typeof msg.spaceId === "string"
          && (msg.status === "cancelled" || msg.status === "expired" || msg.status === "failed")) {
          const { SqliteDispatchState } = await import("./dispatchGuard.js");
          await new SqliteDispatchState(msg.spaceId).markWakePending(msg.id);
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
      await db.update(schema.agents).set({ status: "inactive", activity: "offline" }).where(eq(schema.agents.id, agent.id));
      if (!isWorkerLeaseLatest(lease)) return false;
      await publish(space.id, { type: "agent", id: agent.id, name: agent.name, status: "inactive", activity: "offline" });
      if (!isWorkerLeaseLatest(lease)) return false;
    }
  }
  return isWorkerLeaseLatest(lease);
}

async function onAgentUpdate(msg: any, lease: WorkerLease): Promise<void> {
  if (!msg.agentId) return;
  const located = await locateAgent(msg.agentId);
  if (!located || !isWorkerLeaseCurrent(lease)) return;
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
