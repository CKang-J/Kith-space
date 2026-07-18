import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  AGENT_ENDPOINT_OWNERS,
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
  const source = readFileSync(path.join(root, "src/server/routes-agent.ts"), "utf8");
  const implemented = extractAgentEndpointBranches(source);
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

test("P-A9.4 admission and replay targets remain a non-executable target checklist", () => {
  assert.deepEqual(P_A9_4_TARGET_CONTRACTS, [
    { id: "persistent-get-or-reserve", stage: "target-p-a9.4", target: "A durable (spaceId, chainId, messageId, targetAgentId) key returns the existing reservationId without spending wake budget twice." },
    { id: "admission-ack-commit", stage: "target-p-a9.4", target: "Core commits a wake only after the current Worker generation returns admitted or queued for the matching deliveryId." },
    { id: "duplicate-command-ack", stage: "target-p-a9.4", target: "Duplicate commands and admission acknowledgements are idempotent within one Worker generation." },
    { id: "disconnect-before-ack", stage: "target-p-a9.4", target: "Disconnect or timeout before admission keeps the same reservation pending and replays the same deliveryId on the new Worker lease." },
    { id: "stale-worker-generation", stage: "target-p-a9.4", target: "Acknowledgements from an obsolete Worker generation cannot commit a wake." },
    { id: "live-session-capacity", stage: "target-p-a9.4", target: "Installation capacity counts live RuntimeSession instances and is never exceeded." },
    { id: "slot-release", stage: "target-p-a9.4", target: "stop, sleep, and exit release a live-session slot exactly once." },
    { id: "per-agent-order", stage: "target-p-a9.4", target: "Queued and merged deliveries preserve per-Agent ordering." },
    { id: "priority-aging-fairness", stage: "target-p-a9.4", target: "Manual control outranks required delivery, which outranks optional ambient delivery, with aging across Spaces." },
    { id: "queued-cancel-reset", stage: "target-p-a9.4", target: "Queued stop and reset cancel or replace work with a deterministic outcome." },
    { id: "shutdown-drain", stage: "target-p-a9.4", target: "Worker shutdown has a deterministic queue drain or cancel outcome." },
    { id: "queue-full-expiry", stage: "target-p-a9.4", target: "Queue-full and expiry outcomes are explicit and do not leak reservations." },
    { id: "unread-replay", stage: "target-p-a9.4", target: "Accepted but unread messages replay from lastReadSeq with the same reservationId and without consuming wake budget again." },
    { id: "command-identities", stage: "target-p-a9.4", target: "Wake commands reuse reservationId as deliveryId; manual and lifecycle commands use an independent commandId." },
    { id: "manual-command-budget", stage: "target-p-a9.4", target: "Manual and lifecycle commands never consume message wake budget." },
    { id: "read-before-reply-limit", stage: "target-p-a9.4", target: "A crash after read but before reply remains a documented Runtime contract v2 limitation, not a P-A9 guarantee." },
  ]);
  assert.equal(P_A9_4_TARGET_CONTRACTS.every((entry) => entry.stage === "target-p-a9.4"), true);
  assert.equal(P_A9_4_TARGET_CONTRACTS.every((entry) => entry.target.length > 0), true);
});
