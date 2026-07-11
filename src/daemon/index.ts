#!/usr/bin/env node
// Kith-space local runtime worker: one installation-level connection that hosts local CLI agents.
// Usage: kith-space-daemon --server-url http://127.0.0.1:7777 --api-key <DAEMON_BOOTSTRAP_KEY>
import "../env.js"; // must be first: loads project root .env (does not override shell env vars like OPENAI_API_KEY)
import { Connection } from "./connection.js";
import { AgentManager } from "./agentManager.js";
import { listWorkspace, readWorkspaceFile, listSkills } from "./workspace.js";
import { detectRuntimes } from "./runtimes.js";
import { listModels } from "./listModels.js";
import { createLogger } from "../log.js";

const log = createLogger("daemon");
const args = process.argv.slice(2);
let serverUrl = "", apiKey = "";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--server-url" && args[i + 1]) serverUrl = args[++i]!;
  if (args[i] === "--api-key" && args[i + 1]) apiKey = args[++i]!;
}
// Default: connect to the server port from .env (worktree/prod each have their own .env port; --server-url overrides).
if (!serverUrl) serverUrl = `http://127.0.0.1:${process.env.PORT ?? 7777}`;
// A3/A4 replace this development bootstrap secret with an internal short-lived credential.
if (!apiKey) apiKey = process.env.DAEMON_BOOTSTRAP_KEY ?? "";
if (!apiKey) {
  console.error("Usage: kith-space-daemon [--server-url <url>] --api-key <DAEMON_BOOTSTRAP_KEY>");
  console.error("   or: DAEMON_BOOTSTRAP_KEY=<key> kith-space-daemon [--server-url <url>]");
  process.exit(1);
}

let conn: Connection;
const mgr = new AgentManager((m) => conn.send(m));

conn = new Connection(serverUrl, apiKey, (msg) => {
  if (msg.type !== "ping") log.debug("recv", { type: msg.type, agentId: msg.agentId });
  switch (msg.type) {
    case "ready:ack": break;
    // Agent dials the same server URL this daemon connected with (proven reachable), overriding the
    // server-reported config.serverUrl (SELF_URL = localhost:PORT on the server box — wrong whenever the
    // daemon runs on a different host than the server, e.g. local daemon ↔ getopentag.com).
    case "agent:start": void mgr.start(msg.agentId, { ...msg.config, serverUrl }); break;
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
const shutdown = () => { log.info("shutting down"); mgr.stopAll(); conn.close(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
