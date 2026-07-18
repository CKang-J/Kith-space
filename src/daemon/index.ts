#!/usr/bin/env node
// Kith-space local runtime worker: one installation-level connection that hosts local CLI agents.
import "../env.js"; // must be first: loads project root .env (does not override shell env vars like OPENAI_API_KEY)
import { Connection } from "./connection.js";
import { AgentManager } from "./agentManager.js";
import { listWorkspace, readWorkspaceFile, listSkills } from "./workspace.js";
import { detectRuntimes } from "./runtimes.js";
import { listModels } from "./listModels.js";
import { createLogger } from "../log.js";
import { workerBootstrapToken } from "../local-runtime/internalCredentials.js";
import { RuntimeAdmissionController } from "../runtime/worker/runtimeAdmissionController.js";
import type { AgentConfig } from "./agentManager.js";
import type { WorkerAdmissionCommand } from "../runtime/contract/runtimeWorkerPort.js";

const log = createLogger("daemon");
// The installation-level Worker and Core Service always share one physical computer.
// PORT remains configurable for parallel worktrees, but the host is never remotely configurable.
const serverUrl = `http://127.0.0.1:${process.env.PORT ?? 7777}`;
const workerToken = workerBootstrapToken();

let conn: Connection;
let admissions: RuntimeAdmissionController;
const mgr = new AgentManager((m) => conn.send(m), {
  onSessionEnded(agentId) { admissions?.sessionEnded(agentId); },
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

function isAdmissionCommand(message: any): message is WorkerAdmissionCommand {
  return Number.isInteger(message?.generation)
    && (message?.source === "wake" || message?.source === "manual" || message?.source === "lifecycle")
    && (typeof message?.deliveryId === "string" || typeof message?.commandId === "string");
}

function admitWorkerCommand(message: any): void {
  if (!isAdmissionCommand(message)) {
    log.warn("rejected Worker command without admission identity", { type: message?.type, agentId: message?.agentId });
    return;
  }
  void admitAndAck(message);
}

conn = new Connection(serverUrl, workerToken, (msg) => {
  if (msg.type !== "ping") log.debug("recv", { type: msg.type, agentId: msg.agentId });
  switch (msg.type) {
    case "ready:ack": break;
    case "agent:start": admitWorkerCommand(msg); break;
    case "agent:deliver": admitWorkerCommand(msg); break;
    case "agent:stop": admitWorkerCommand(msg); break;
    case "agent:sleep": admitWorkerCommand(msg); break;
    case "agent:reset": admitWorkerCommand(msg); break;
    case "agent:profile": void mgr.syncProfile({ agentId: msg.agentId, spaceId: msg.spaceId ?? "", workspaceRoot: msg.workspaceRoot ?? "" }, msg.displayName ?? "", msg.description).catch((error) => log.warn("agent profile sync rejected", { agentId: msg.agentId, detail: String(error) })); break;
    case "agent:workspace:list": void listWorkspace(msg.workspaceRoot ?? "", msg.path ?? "").then((r) => conn.send({ type: "workspace:file_tree", requestId: msg.requestId, agentId: msg.agentId, ...r })); break;
    case "agent:workspace:read": void readWorkspaceFile(msg.workspaceRoot ?? "", msg.path ?? "").then((r) => conn.send({ type: "workspace:file_content", requestId: msg.requestId, agentId: msg.agentId, ...r })); break;
    case "agent:skills:list": void listSkills(msg.workspaceRoot ?? "", msg.runtime).then((r) => conn.send({ type: "skills:list", requestId: msg.requestId, agentId: msg.agentId, ...r })); break;
    case "probe-models": void listModels(msg.runtime ?? "").then((models) => conn.send({ type: "models", requestId: msg.requestId, runtime: msg.runtime, models })).catch((e) => conn.send({ type: "models", requestId: msg.requestId, runtime: msg.runtime, models: null, error: String((e as any)?.message ?? e) })); break;
    case "ping": conn.send({ type: "pong" }); break;
  }
}, () => {
  const runtimes = detectRuntimes();
  log.info("ready", { runtimes });
  conn.send({
    type: "ready", capabilities: ["agent:start", "agent:stop", "agent:sleep", "agent:reset", "agent:profile", "agent:deliver", "agent:workspace"],
    runtimes, runningAgents: mgr.running(), daemonVersion: process.env.DAEMON_VERSION ?? "dev",
  });
});

log.info("Kith-space daemon starting", { serverUrl });
conn.connect();
let shutdownPromise: Promise<void> | null = null;
const shutdown = () => {
  if (shutdownPromise) return shutdownPromise;
  log.info("shutting down");
  shutdownPromise = admissions.shutdown().then(() => {
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
