import test from "node:test";
import assert from "node:assert/strict";
import { SessionCapabilityBroker } from "./sessionCapabilityBroker.js";
import type { TurnCapabilityClaims } from "./contracts.js";

function claims(overrides: Partial<TurnCapabilityClaims> = {}): TurnCapabilityClaims {
  return {
    schemaVersion: 1,
    activationId: "activation-1",
    turnId: "turn-1",
    attemptId: "attempt-1",
    sessionId: "session-1",
    sessionGeneration: 1,
    workerGeneration: 7,
    spaceId: "space-1",
    agentId: "agent-1",
    allowedOutputSurfaceIds: ["channel-1"],
    allowedInputIds: [],
    seenWatermarks: [],
    scopes: [],
    disclosureGrantIds: [],
    expiresAt: 2_000,
    ...overrides,
  };
}

test("stable broker handle only resolves the currently activated attempt", () => {
  let now = 1_000;
  const broker = new SessionCapabilityBroker(() => now);
  const handle = broker.openSession({
    sessionId: "session-1",
    sessionGeneration: 1,
    spaceId: "space-1",
    agentId: "agent-1",
  });

  assert.throws(() => broker.resolve({ sessionHandle: handle, activationId: "activation-1", workerGeneration: 7 }), /no matching active attempt/);
  broker.activate(handle, claims());
  assert.equal(broker.resolve({
    sessionHandle: handle,
    activationId: "activation-1",
    workerGeneration: 7,
    turnId: "turn-1",
    attemptId: "attempt-1",
  }).sessionId, "session-1");
  assert.throws(() => broker.resolve({ sessionHandle: handle, activationId: "activation-1", workerGeneration: 6 }), /another Worker generation/);
  assert.throws(() => broker.activate(handle, claims({ activationId: "activation-2" })), /already has an active attempt/);

  assert.equal(broker.deactivate(handle, "activation-1"), true);
  assert.throws(() => broker.resolve({ sessionHandle: handle, activationId: "activation-1", workerGeneration: 7 }), /no matching active attempt/);

  broker.activate(handle, claims({ activationId: "activation-2", expiresAt: 1_100 }));
  now = 1_101;
  assert.throws(() => broker.resolve({ sessionHandle: handle, activationId: "activation-2", workerGeneration: 7 }), /expired/);
});

test("broker rejects cross-session activation and invalidates a closed handle", () => {
  const broker = new SessionCapabilityBroker(() => 1_000);
  const handle = broker.openSession({ sessionId: "session-1", sessionGeneration: 2, spaceId: "space-1", agentId: "agent-1" });
  assert.throws(() => broker.activate(handle, claims()), /does not match its broker session/);
  broker.closeSession(handle);
  assert.throws(() => broker.activate(handle, claims({ sessionGeneration: 2 })), /unknown or closed/);
});
