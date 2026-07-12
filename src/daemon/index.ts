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

const log = createLogger("daemon");
// The installation-level Worker and Core Service always share one physical computer.
// PORT remains configurable for parallel worktrees, but the host is never remotely configurable.
const serverUrl = `http://127.0.0.1:${process.env.PORT ?? 7777}`;
const workerToken = workerBootstrapToken();

let conn: Connection;
const mgr = new AgentManager((m) => conn.send(m));

conn = new Connection(serverUrl, workerToken, (msg) => {
  if (msg.type !== "ping") log.debug("recv", { type: msg.type, agentId: msg.agentId });
  switch (msg.type) {
    case "ready:ack": break;
    case "agent:start": void mgr.start(msg.agentId, msg.config, msg.reason ?? "manual"); break;
    case "agent:deliver": mgr.deliver(msg.agentId, msg.from ?? "someone", msg.target ?? "", !!msg.mentioned, { targetName: msg.targetName, msgShort: msg.msgShort, isTask: msg.isTask, streamId: msg.streamId }); conn.send({ type: "agent:deliver:ack", agentId: msg.agentId, seq: msg.seq }); break;
    case "agent:stop": mgr.stop(msg.agentId); break;
    case "agent:sleep": mgr.sleep(msg.agentId); break;
    case "agent:reset": void mgr.reset(msg.agentId, !!msg.wipeWorkspace, !!msg.clearMemory); break;
    case "agent:profile": void mgr.syncProfile(msg.agentId, msg.displayName ?? "", msg.description); break;
    case "agent:workspace:list": void listWorkspace(msg.agentId, msg.path ?? "").then((r) => conn.send({ type: "workspace:file_tree", requestId: msg.requestId, agentId: msg.agentId, ...r })); break;
    case "agent:workspace:read": void readWorkspaceFile(msg.agentId, msg.path ?? "").then((r) => conn.send({ type: "workspace:file_content", requestId: msg.requestId, agentId: msg.agentId, ...r })); break;
    case "agent:skills:list": void listSkills(msg.agentId, msg.runtime).then((r) => conn.send({ type: "skills:list", requestId: msg.requestId, agentId: msg.agentId, ...r })); break;
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
  shutdownPromise = mgr.stopAllAndWait().then(() => {
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
