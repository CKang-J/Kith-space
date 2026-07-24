import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const wsSrc = fs.readFileSync(new URL("../src/server/ws.ts", import.meta.url), "utf8");
const socketSrc = fs.readFileSync(new URL("../src/server/socketio.ts", import.meta.url), "utf8");
const coreSrc = fs.readFileSync(new URL("../src/server/core.ts", import.meta.url), "utf8");
const wakeAdapterSrc = fs.readFileSync(new URL("../src/server/messageWakeDispatchAdapter.ts", import.meta.url), "utf8");

test("agent activity detail is forwarded to the UI activity signal", () => {
  assert.match(
    wsSrc,
    /publish\(located\.spaceId, \{ type: "agent", id: agent\.id, name: agent\.name, status: agent\.status, activity: agent\.activity, detail: msg\.detail \?\? "", \.\.\.trajectoryScope \}\)/,
    "worker activity detail and conversation scope should be included in the Space-level agent event",
  );
  assert.match(
    socketSrc,
    /room\.emit\("agent:activity", \{ agentId: event\.id, name: event\.name, status: event\.status, activity: event\.activity, detail: event\.detail \?\? "", \.\.\.trajectoryScopeFields\(event\) \}\)/,
    "Socket.IO mapping should preserve detail and conversation scope for Store.activityDetail",
  );
});

test("agent wake delivery preserves reservations on uncertain admission and closes rejected previews", () => {
  assert.match(
    wakeAdapterSrc,
    /admission = await dependencies\.runtimeWorker\.start\(/,
    "message wake should cross the RuntimeWorkerPort admission boundary",
  );
  assert.match(
    wakeAdapterSrc,
    /error instanceof WorkerAdmissionUncertainError[\s\S]*?status: "pending"/,
    "uncertain admission must keep the durable reservation for reconnect replay",
  );
  assert.match(
    wakeAdapterSrc,
    /if \(admission\.status === "rejected"\) \{[\s\S]*?releaseWake\(reservation\.reservationId\)[\s\S]*?op: "error"/,
    "an explicit rejection should release the reservation and close the required preview",
  );
});

test("agent lifecycle control targets the one local runtime worker", () => {
  assert.match(
    coreSrc,
    /async function agentControlTarget\(spaceId: string, agentId: string\)/,
    "stop/reset/profile sync should validate the agent and local worker separately from start config",
  );
  assert.match(
    coreSrc,
    /runtimeWorkerPort\.stop\(\{ type: "agent:stop", source: "lifecycle", commandId: randomUUID\(\), spaceId, agentId \}\)/,
    "stop should wait for an admission ack from the installation-local worker",
  );
  assert.match(
    coreSrc,
    /if \(!isWorkerConnected\(\)\) return \{ ok: false, reason: "local runtime worker offline" \};/,
    "lifecycle controls should report the local worker boundary explicitly",
  );
  assert.match(
    coreSrc,
    /if \(admission\.status === "rejected"\) log\.warn\("agent stop rejected"/,
    "stop should handle an explicit Worker rejection",
  );
  assert.match(
    coreSrc,
    /runtimeWorkerPort\.reset\(\{ type: "agent:reset", source: "lifecycle", commandId: randomUUID\(\), agentId, spaceId: target\.spaceId, workspaceRoot: target\.workspaceRoot, clearAgentMemory \}\)/,
    "reset should send resolved Space paths with a stable command id",
  );
  assert.match(
    coreSrc,
    /if \(clearAgentMemory\) \{\s*clearAgentPrivateMemory\(spaceId, agentId\);\s*\}/,
    "full reset should clear Agent-private structured memory through the Memory lifecycle module",
  );
  assert.match(
    coreSrc,
    /sendAgentControl\(target, \{ type: "agent:profile", agentId, spaceId: target\.spaceId, workspaceRoot: target\.workspaceRoot, displayName, description: description \?\? null \}\)/,
    "profile sync should send resolved Space paths to the local worker",
  );
});
