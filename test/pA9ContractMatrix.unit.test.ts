import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  AGENT_ENDPOINT_OWNERS,
  AGENT_ENDPOINT_MODULE_SOURCES,
  CURRENT_CREATE_MESSAGE_CALL_SITES,
  P_A9_4_TARGET_CONTRACTS,
  PRODUCTION_WRITE_OWNERS,
  extractAgentEndpointBranches,
  findCreateMessageCallSites,
} from "../scripts/p-a9/contract-matrix.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("P-A9 production write ownership evidence remains complete", () => {
  const requiredCases = new Set([
    "human-message", "human-as-task", "human-task-batch", "agent-message", "agent-introduction",
    "agent-thread-reply", "agent-task", "action-prepare", "reminder-write", "reminder-delivery", "internal-task-audit",
  ]);
  assert.deepEqual(new Set(PRODUCTION_WRITE_OWNERS.map((entry) => entry.id)), requiredCases);

  for (const entry of PRODUCTION_WRITE_OWNERS) {
    const source = readFileSync(path.join(root, entry.source), "utf8");
    for (const evidence of entry.evidence) {
      assert.equal(source.includes(evidence), true, `${entry.id} lost evidence ${JSON.stringify(evidence)} in ${entry.source}`);
    }
    assert.match(entry.owner, /Module/);
  }

  assert.deepEqual(findCreateMessageCallSites(root), CURRENT_CREATE_MESSAGE_CALL_SITES);
});

test("P-A9 Agent endpoint ownership matrix matches every implemented route", () => {
  const implemented = AGENT_ENDPOINT_MODULE_SOURCES.flatMap((source) =>
    extractAgentEndpointBranches(readFileSync(path.join(root, source), "utf8")),
  ).sort();
  const owned = AGENT_ENDPOINT_OWNERS.map((entry) => `${entry.method} ${entry.path}`).sort();

  assert.deepEqual(owned, implemented);
  assert.equal(new Set(owned).size, owned.length, "endpoint ownership entries must be unique");
  assert.deepEqual(new Set(AGENT_ENDPOINT_OWNERS.map((entry) => entry.owner)), new Set([
    "MessagesContextModule",
    "ChannelsThreadsModule",
    "TaskModule",
    "ActionModule",
    "FilesModule",
    "ProfileSpaceModule",
    "ReminderModule",
  ]));
  const routeIndex = readFileSync(path.join(root, "src/server/routes-agent.ts"), "utf8");
  assert.doesNotMatch(routeIndex, /dbForSpace|schema\./, "Agent route index must not access the database");
});

test("P-A9 Agent endpoint inventory is independent of comparison order", () => {
  assert.deepEqual(
    extractAgentEndpointBranches('if (method === "POST" && p === "/agent-api/example") {}'),
    ["POST /agent-api/example"],
  );
  assert.deepEqual(
    extractAgentEndpointBranches('if ("/agent-api/example" === p && "POST" === method) {}'),
    ["POST /agent-api/example"],
  );
});

test("P-A9.4 admission and replay contracts have executable evidence", () => {
  assert.deepEqual(P_A9_4_TARGET_CONTRACTS.map((entry) => entry.id), [
    "persistent-get-or-reserve", "admission-ack-commit", "duplicate-command-ack", "disconnect-before-ack",
    "stale-worker-generation", "live-session-capacity", "slot-release", "per-agent-order",
    "priority-aging-fairness", "queued-cancel-reset", "shutdown-drain", "queue-full-expiry",
    "unread-replay", "command-identities", "manual-command-budget", "read-before-reply-limit",
  ]);
  assert.equal(P_A9_4_TARGET_CONTRACTS.every((entry) => entry.stage === "implemented-p-a9.4"), true);
  assert.equal(P_A9_4_TARGET_CONTRACTS.every((entry) => entry.target.length > 0), true);
  for (const entry of P_A9_4_TARGET_CONTRACTS) {
    assert.ok(entry.evidence.length > 0, `${entry.id} must name executable or documentation evidence`);
    for (const evidence of entry.evidence) assert.equal(readFileSync(path.join(root, evidence), "utf8").length > 0, true);
  }
});
