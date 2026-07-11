import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const wsSrc = fs.readFileSync(new URL("../src/server/ws.ts", import.meta.url), "utf8");
const socketSrc = fs.readFileSync(new URL("../src/server/socketio.ts", import.meta.url), "utf8");
const coreSrc = fs.readFileSync(new URL("../src/server/core.ts", import.meta.url), "utf8");

test("agent activity detail is forwarded to the UI activity signal", () => {
  assert.match(
    wsSrc,
    /publish\(located\.spaceId, \{ type: "agent", id: agent\.id, name: agent\.name, status: agent\.status, activity: agent\.activity, detail: msg\.detail \?\? "" \}\)/,
    "worker activity detail should be included in the Space-level agent event",
  );
  assert.match(
    socketSrc,
    /room\.emit\("agent:activity", \{ agentId: event\.id, name: event\.name, status: event\.status, activity: event\.activity, detail: event\.detail \?\? "" \}\)/,
    "Socket.IO mapping should preserve detail for Store.activityDetail",
  );
});

test("agent wake delivery handles local worker send failure after preview start", () => {
  assert.match(
    coreSrc,
    /const startSent = sendAgentStart\(opts\.serverId, target, mem\.id\);/,
    "message wake should check whether agent:start was actually sent",
  );
  assert.match(
    coreSrc,
    /const deliverSent = startSent && sendAgentDeliver\(opts\.serverId, target, \{ agentId: mem\.id,/,
    "message wake should only deliver after a successful start send",
  );
  assert.match(
    coreSrc,
    /if \(!deliverSent\) \{[\s\S]*?op: "error", text: "local runtime worker offline"[\s\S]*?await markAgentUnavailable\(opts\.serverId, mem\.id, "local runtime worker offline"\);[\s\S]*?continue;/,
    "send failure should mark the agent unavailable and close the preview instead of leaving a stuck thinking card",
  );
});

test("agent lifecycle control targets the one local runtime worker", () => {
  assert.match(
    coreSrc,
    /async function agentControlTarget\(serverId: string, agentId: string\)/,
    "stop/reset/profile sync should validate the agent and local worker separately from start config",
  );
  assert.match(
    coreSrc,
    /function sendAgentControl\(_serverId: string, _target: AgentControlTarget, msg: Record<string, unknown>\): boolean \{[\s\S]*?return sendToWorker\(msg\);/,
    "lifecycle controls should use the installation-local worker",
  );
  assert.match(
    coreSrc,
    /if \(!isWorkerConnected\(\)\) return \{ ok: false, reason: "local runtime worker offline" \};/,
    "lifecycle controls should report the local worker boundary explicitly",
  );
  assert.match(
    coreSrc,
    /sendAgentControl\(serverId, target, \{ type: "agent:stop", agentId \}\)/,
    "stop should target the local worker",
  );
  assert.match(
    coreSrc,
    /sendAgentControl\(serverId, target, \{ type: "agent:reset", agentId, wipeWorkspace, clearMemory \}\)/,
    "reset should target the local worker",
  );
  assert.match(
    coreSrc,
    /sendAgentControl\(serverId, target, \{ type: "agent:profile", agentId, displayName, description: description \?\? null \}\)/,
    "profile sync should target the local worker",
  );
});
