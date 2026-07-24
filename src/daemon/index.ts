#!/usr/bin/env node
// Kith-space local runtime worker: one installation-level connection that hosts local CLI agents.
import "../env.js"; // must be first: loads project root .env (does not override shell env vars like OPENAI_API_KEY)
import { randomUUID } from "node:crypto";
import { Connection } from "./connection.js";
import { AgentManager } from "./agentManager.js";
import { listWorkspace, readWorkspaceFile, listSkills } from "./workspace.js";
import { detectRuntimes } from "./runtimes.js";
import { listModels } from "./listModels.js";
import { createLogger } from "../log.js";
import { workerBootstrapToken } from "../local-runtime/internalCredentials.js";
import { RuntimeAdmissionController } from "../runtime/worker/runtimeAdmissionController.js";
import type { AgentConfig } from "./agentManager.js";
import { hasWorkerAdmissionIdentity, type WorkerAdmissionCommand } from "../runtime/contract/runtimeWorkerPort.js";
import { RuntimeSessionHost } from "../runtime/worker/sessions/runtimeSessionHost.js";
import { RuntimeTurnController } from "../runtime/worker/sessions/runtimeTurnController.js";
import { getRuntimeV2 } from "../runtime/adapters/runtimeV2Bridge.js";
import { completeClaudeMaintenanceJson } from "../runtime/worker/maintenance/claudeMaintenanceRuntime.js";
import { AdvisorRunController } from "../runtime/worker/maintenance/advisorRunController.js";
import type { ActivatedAdvisorCredential } from "../runtime/contract/advisorProviderRuntimePort.js";
import { withManagedRuntimePath } from "../local-runtime/runtimeSetupCatalog.js";

const log = createLogger("daemon");
// Kith-managed runtime bins take precedence without changing the user's shell or CLI config.
// Installation/removal is intentionally activated on the next Worker start.
process.env.PATH = withManagedRuntimePath();
// The installation-level Worker and Core Service always share one physical computer.
// PORT remains configurable for parallel worktrees, but the host is never remotely configurable.
const serverUrl = `http://127.0.0.1:${process.env.PORT ?? 7777}`;
const workerToken = workerBootstrapToken();

let conn: Connection;
let admissions: RuntimeAdmissionController;
const sessionHost = new RuntimeSessionHost(getRuntimeV2, {
  activeTurnLimit: Number(process.env.KITH_SPACE_RUNTIME_CAPACITY ?? 4),
  residentProcessLimit: Number(process.env.KITH_SPACE_RUNTIME_RESIDENT_LIMIT ?? 4),
});
const turns = new RuntimeTurnController(sessionHost, {
  maxAdmitted: Number(process.env.KITH_SPACE_RUNTIME_QUEUE_LIMIT ?? 128),
  send(message) { return conn?.send(message) ?? false; },
});
let latestCoreGeneration = 0;
const advisorRuns = new AdvisorRunController();
const pendingAdvisorCredentials = new Map<string, { resolve: (value: ActivatedAdvisorCredential) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
const PROVIDER_WORKER_ERROR_CODES = new Set([
  "provider_unavailable", "provider_busy", "provider_auth_required", "provider_model_incompatible",
  "provider_revision_changed", "provider_timeout", "provider_cancelled", "provider_invalid_output",
  "provider_preflight_destination_mismatch", "provider_postflight_destination_mismatch",
]);
function providerWorkerErrorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  return PROVIDER_WORKER_ERROR_CODES.has(code) ? code : "provider_unavailable";
}
function requestAdvisorCredential(message: any): Promise<ActivatedAdvisorCredential> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingAdvisorCredentials.delete(requestId);
      reject(new Error("provider_auth_required"));
    }, 10_000);
    timer.unref?.();
    pendingAdvisorCredentials.set(requestId, { resolve, reject, timer });
    if (!conn.send({
      type: "advisor:credential:redeem", requestId, credentialHandle: message.credentialHandle,
      runId: message.runId, providerEpoch: message.providerEpoch, workerGeneration: latestCoreGeneration,
      executionSnapshotDigest: message.snapshotDigest,
    })) {
      clearTimeout(timer);
      pendingAdvisorCredentials.delete(requestId);
      reject(new Error("provider_auth_required"));
    }
  });
}

function rejectPendingAdvisorCredentials(): void {
  for (const pending of pendingAdvisorCredentials.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error("provider_cancelled"));
  }
  pendingAdvisorCredentials.clear();
}
const mgr = new AgentManager((m) => conn.send(m), {
  onSessionEnded(agentId) { admissions?.sessionEnded(agentId); },
  onSessionIdle(agentId) { admissions?.sessionIdle(agentId); },
});
admissions = new RuntimeAdmissionController({
  isRunning(agentId) { return mgr.running().includes(agentId); },
  async start(command) {
    await mgr.start(command.agentId, command.config as AgentConfig, command.reason);
    return mgr.running().includes(command.agentId);
  },
  deliver(command) {
    mgr.deliver(command.agentId, command.from, command.target, command.mentioned, {
      targetName: command.targetName,
      msgShort: command.msgShort,
      isTask: command.isTask,
      streamId: command.streamId,
      responseDirective: command.responseDirective,
      responseReason: command.responseReason,
    });
  },
  stop(agentId) { mgr.stop(agentId); },
  sleep(agentId) { mgr.sleep(agentId); },
  async reset(agentId, command) {
    await mgr.reset({ agentId, spaceId: command.spaceId, workspaceRoot: command.workspaceRoot }, { clearAgentMemory: command.clearAgentMemory });
  },
  stopAllAndWait() { return mgr.stopAllAndWait(); },
}, {
  capacity: Number(process.env.KITH_SPACE_RUNTIME_CAPACITY ?? 4),
  maxQueue: Number(process.env.KITH_SPACE_RUNTIME_QUEUE_LIMIT ?? 128),
  queueTtlMs: Number(process.env.KITH_SPACE_RUNTIME_QUEUE_TTL_MS ?? 120_000),
  onOutcome(outcome) { conn.send({ type: "worker:queue:outcome", ...outcome }); },
});

async function admitAndAck(message: WorkerAdmissionCommand): Promise<void> {
  const result = await admissions.admit(message);
  conn.send({
    type: "worker:admission",
    generation: result.generation,
    ...(message.source === "wake" ? { deliveryId: result.id } : { commandId: result.id }),
    status: result.status,
    ...(result.reason ? { reason: result.reason } : {}),
  });
}

function admitWorkerCommand(message: any): void {
  if (!hasWorkerAdmissionIdentity(message)) {
    log.warn("rejected Worker command without admission identity", { type: message?.type, agentId: message?.agentId });
    return;
  }
  void admitAndAck(message);
}

function admitTurnCommand(message: any): void {
  if (!hasWorkerAdmissionIdentity(message) || message.type !== "agent:turn:admit" || message.source !== "turn") {
    log.warn("rejected v2 turn command without admission identity", { type: message?.type, attemptId: message?.turn?.attemptId });
    return;
  }
  const result = turns.admit(message);
  conn.send({ type: "worker:admission", generation: result.generation, commandId: result.id, status: result.status, ...(result.reason ? { reason: result.reason } : {}) });
}

async function closeTurnSessionsAndAck(message: any): Promise<void> {
  if (!hasWorkerAdmissionIdentity(message) || message.type !== "agent:turn:sessions:close" || message.source !== "turn") return;
  const result = await turns.closeAgent(message);
  conn.send({ type: "worker:admission", generation: result.generation, commandId: result.id, status: result.status, ...(result.reason ? { reason: result.reason } : {}) });
}

conn = new Connection(serverUrl, workerToken, (msg) => {
  if (msg.type !== "ping") log.debug("recv", { type: msg.type, agentId: msg.agentId });
  switch (msg.type) {
    case "advisor:credential:result": {
      const pending = pendingAdvisorCredentials.get(String(msg.requestId ?? ""));
      if (!pending) break;
      clearTimeout(pending.timer);
      pendingAdvisorCredentials.delete(String(msg.requestId));
      if (msg.ok === true && msg.credential && ["api_key", "oauth", "none"].includes(msg.credential.type)) pending.resolve(msg.credential);
      else pending.reject(new Error(typeof msg.errorCode === "string" ? msg.errorCode : "provider_auth_required"));
      break;
    }
    case "ready:ack": {
      latestCoreGeneration = Number(msg.generation) || 0;
      void turns.advanceGeneration(latestCoreGeneration).catch((error) => log.warn("turn generation advance failed", { detail: String(error) }));
      break;
    }
    case "agent:start": admitWorkerCommand(msg); break;
    case "agent:deliver": admitWorkerCommand(msg); break;
    case "agent:stop": admitWorkerCommand(msg); break;
    case "agent:sleep": admitWorkerCommand(msg); break;
    case "agent:reset": admitWorkerCommand(msg); break;
    case "agent:turn:admit": admitTurnCommand(msg); break;
    case "agent:turn:activate": void turns.activate(msg); break;
    case "agent:turn:cancel": void turns.cancel(msg).catch((error) => log.warn("turn cancel failed", { attemptId: msg.attemptId, detail: String(error) })); break;
    case "agent:turn:sessions:close": void closeTurnSessionsAndAck(msg).catch((error) => log.warn("turn session close failed", { agentId: msg.agentId, detail: String(error) })); break;
    case "agent:turn:event:ack": turns.acknowledgeEvent(msg); break;
    case "agent:turn:terminal:ack": turns.acknowledgeTerminal(msg); break;
    case "agent:session:snapshot:ack": break;
    case "agent:profile": void mgr.syncProfile({ agentId: msg.agentId, spaceId: msg.spaceId ?? "", workspaceRoot: msg.workspaceRoot ?? "" }, msg.displayName ?? "", msg.description).catch((error) => log.warn("agent profile sync rejected", { agentId: msg.agentId, detail: String(error) })); break;
    case "agent:workspace:list": void listWorkspace(msg.workspaceRoot ?? "", msg.path ?? "").then((r) => conn.send({ type: "workspace:file_tree", requestId: msg.requestId, agentId: msg.agentId, ...r })); break;
    case "agent:workspace:read": void readWorkspaceFile(msg.workspaceRoot ?? "", msg.path ?? "").then((r) => conn.send({ type: "workspace:file_content", requestId: msg.requestId, agentId: msg.agentId, ...r })); break;
    case "agent:skills:list": void listSkills(msg.workspaceRoot ?? "", msg.runtime).then((r) => conn.send({ type: "skills:list", requestId: msg.requestId, agentId: msg.agentId, ...r })); break;
    case "probe-models": void listModels(msg.runtime ?? "").then((models) => conn.send({ type: "models", requestId: msg.requestId, runtime: msg.runtime, models })).catch((e) => conn.send({ type: "models", requestId: msg.requestId, runtime: msg.runtime, models: null, error: String((e as any)?.message ?? e) })); break;
    case "maintenance:complete-json": {
      if (msg.runtime !== "claude" || msg.purpose !== "memory_advisor" || typeof msg.requestId !== "string" || typeof msg.prompt !== "string") {
        conn.send({ type: "maintenance:result", requestId: msg.requestId ?? "invalid", ok: false, errorCode: "maintenance_request_invalid" });
        break;
      }
      void completeClaudeMaintenanceJson({ prompt: msg.prompt, model: typeof msg.model === "string" ? msg.model : null })
        .then((result) => conn.send({ type: "maintenance:result", requestId: msg.requestId, ok: true, ...result }))
        .catch(() => conn.send({ type: "maintenance:result", requestId: msg.requestId, ok: false, errorCode: "maintenance_provider_failed" }));
      break;
    }
    case "advisor:prepare": {
      if (typeof msg.requestId !== "string" || typeof msg.runId !== "string" || !msg.snapshot || !msg.config) {
        conn.send({ type: "advisor:result", requestId: msg.requestId ?? "invalid", ok: false, errorCode: "provider_request_invalid" });
        break;
      }
      if (msg.expectedGeneration !== latestCoreGeneration) {
        conn.send({ type: "advisor:result", requestId: msg.requestId, ok: false, errorCode: "provider_revision_changed" });
        break;
      }
      void advisorRuns.prepare({ runId: msg.runId, snapshot: msg.snapshot, config: msg.config })
        .then((prepared) => conn.send({ type: "advisor:result", requestId: msg.requestId, ok: true, workerGeneration: latestCoreGeneration, ...prepared }))
        .catch((error) => conn.send({ type: "advisor:result", requestId: msg.requestId, ok: false, errorCode: providerWorkerErrorCode(error) }));
      break;
    }
    case "advisor:complete": {
      if (typeof msg.requestId !== "string" || typeof msg.runId !== "string" || typeof msg.localHandle !== "string"
        || typeof msg.snapshotDigest !== "string" || typeof msg.prompt !== "string" || typeof msg.credentialHandle !== "string"
        || !Number.isSafeInteger(msg.providerEpoch)) {
        conn.send({ type: "advisor:result", requestId: msg.requestId ?? "invalid", ok: false, errorCode: "provider_request_invalid" });
        break;
      }
      if (msg.expectedGeneration !== latestCoreGeneration) {
        conn.send({ type: "advisor:result", requestId: msg.requestId, ok: false, errorCode: "provider_revision_changed" });
        break;
      }
      void requestAdvisorCredential(msg).then((credential) => advisorRuns.complete({ ...msg, credential }))
        .then((result) => conn.send({ type: "advisor:result", requestId: msg.requestId, ok: true, ...result }))
        .catch((error) => conn.send({ type: "advisor:result", requestId: msg.requestId, ok: false, errorCode: providerWorkerErrorCode(error) }));
      break;
    }
    case "advisor:cancel": {
      if (msg.expectedGeneration !== latestCoreGeneration) {
        conn.send({ type: "advisor:result", requestId: msg.requestId, ok: false, errorCode: "provider_revision_changed" });
        break;
      }
      void advisorRuns.cancel(String(msg.runId ?? "")).then(() => conn.send({ type: "advisor:result", requestId: msg.requestId, ok: true }));
      break;
    }
    case "ping": conn.send({ type: "pong" }); break;
  }
}, () => {
  const runtimes = detectRuntimes();
  log.info("ready", { runtimes });
  conn.send({
    type: "ready", capabilities: ["agent:start", "agent:stop", "agent:sleep", "agent:reset", "agent:profile", "agent:deliver", "agent:workspace", "agent:turn:v2", "maintenance:claude:no-tools"],
    runtimes, runningAgents: mgr.running(), daemonVersion: process.env.DAEMON_VERSION ?? "dev",
  });
}, undefined, async () => {
  latestCoreGeneration = 0;
  rejectPendingAdvisorCredentials();
  await advisorRuns.shutdown();
});

log.info("Kith-space daemon starting", { serverUrl });
conn.connect();
const snapshotFallback = setInterval(() => {
  if (!latestCoreGeneration) return;
  void sessionHost.snapshotAll().then((reports) => {
    for (const report of reports) conn.send({
      type: "agent:session:snapshot",
      requestId: randomUUID(),
      generation: latestCoreGeneration,
      report,
    });
  }).catch((error) => log.warn("session snapshot fallback failed open", { detail: String(error) }));
}, 60_000);
snapshotFallback.unref?.();
let shutdownPromise: Promise<void> | null = null;
const shutdown = () => {
  if (shutdownPromise) return shutdownPromise;
  clearInterval(snapshotFallback);
  log.info("shutting down");
  advisorRuns.shutdown();
  shutdownPromise = Promise.all([admissions.shutdown(), turns.shutdown()]).then(() => {
    conn.close();
    process.exit(0);
  }).catch((error) => {
    conn.close();
    log.error("agent runtimes did not stop cleanly; waiting for Desktop process-tree cleanup", { detail: String(error) });
  });
  return shutdownPromise;
};
process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
process.on("message", (message: unknown) => {
  if ((message as { type?: unknown } | null)?.type === "kith:shutdown") void shutdown();
});
