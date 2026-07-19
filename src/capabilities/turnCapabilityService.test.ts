import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { kithSpaceHome } from "../paths.js";
import { SessionCapabilityBroker } from "./sessionCapabilityBroker.js";
import { TurnCapabilityService } from "./turnCapabilityService.js";

test("context refresh rotates only the active activation watermark and an expired resident handle cannot reuse it", () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  const sessionId = randomUUID();
  const turnId = randomUUID();
  const attemptId = randomUUID();
  let now = 1_000;
  registerSpace({ id: spaceId, name: "Capabilities", slug: `cap-${spaceId}`, rootPath: path.join(kithSpaceHome(), "cap", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({
      id: agentId, spaceId, name: "cap", displayName: "Cap", status: "active",
      scopes: { granted: ["task:read", "knowledge:read"], mode: "custom", revision: 1, updatedAt: new Date(0).toISOString() },
    }).run();
    db.insert(schema.channels).values({ id: channelId, spaceId, name: "cap", type: "channel" }).run();
    db.insert(schema.channelAgentMembers).values({ channelId, agentId }).run();
    db.insert(schema.runtimeSessions).values({
      id: sessionId, spaceId, agentId, surfaceKind: "channel", surfaceId: channelId, sessionGeneration: 1,
      runtime: "claude", runtimeConfigFingerprint: "config", adapterVersion: "v2-bridge-2", workspaceRootFingerprint: "root", status: "running",
    }).run();
    db.insert(schema.agentTurns).values({
      id: turnId, runtimeSessionId: sessionId, sessionGeneration: 1, spaceId, agentId, status: "running", effectiveDirective: "optional",
    }).run();
    db.insert(schema.agentTurnAttempts).values({
      id: attemptId, turnId, attemptNo: 1, status: "claimed", workerGeneration: 5,
      leaseOwner: "test", leaseExpiresAt: new Date(2_000),
    }).run();
    const broker = new SessionCapabilityBroker(() => now);
    const service = new TurnCapabilityService(spaceId, broker, db, () => now);
    const prepared = service.prepare(attemptId);
    assert.equal(prepared.claims.scopes.includes("task.read"), true);
    assert.equal(prepared.claims.scopes.includes("memory.read"), true);
    assert.equal(prepared.claims.scopes.includes("task.write"), false);
    assert.equal(prepared.claims.scopes.includes("conversation.read"), false);
    assert.equal(prepared.claims.scopes.includes("turn.reply"), false);
    db.update(schema.agentTurnAttempts).set({ status: "admitted" }).where(eq(schema.agentTurnAttempts.id, attemptId)).run();
    service.activate(prepared);
    const grantId = randomUUID();
    db.insert(schema.disclosureGrants).values({
      id: grantId, turnId, sourceRefs: [{ sourceId: "source", revision: 1 }], targetSurfaceId: channelId,
      actionDigest: "digest", allowedProjection: "canonical", status: "active", expiresAt: new Date(1_900), createdBy: "human",
    }).run();
    assert.deepEqual(service.authorizeDisclosureGrant(turnId, grantId).disclosureGrantIds, [grantId]);
    assert.throws(() => service.resolve({
      sessionHandle: prepared.sessionHandle,
      activationId: prepared.claims.activationId,
      workerGeneration: 5,
      scope: "task.write",
    }), /does not allow task.write/);
    const refreshed = service.refreshSeenWatermark({
      sessionHandle: prepared.sessionHandle,
      activationId: prepared.claims.activationId,
      workerGeneration: 5,
      channelId,
      throughSeq: 9,
    });
    assert.equal(refreshed.seenWatermarks.find((item) => item.channelId === channelId)?.throughSeq, 9);
    assert.equal(broker.resolve({
      sessionHandle: prepared.sessionHandle,
      activationId: prepared.claims.activationId,
      workerGeneration: 5,
    }).seenWatermarks[0]?.throughSeq, 9);
    db.update(schema.agents).set({
      scopes: { granted: [], mode: "custom", revision: 2, updatedAt: new Date(1_500).toISOString() },
    }).where(eq(schema.agents.id, agentId)).run();
    assert.throws(() => service.resolve({
      sessionHandle: prepared.sessionHandle,
      activationId: prepared.claims.activationId,
      workerGeneration: 5,
      scope: "task.read",
    }), /no longer grants task:read/);
    now = 2_001;
    assert.throws(() => service.resolve({
      sessionHandle: prepared.sessionHandle,
      activationId: prepared.claims.activationId,
      workerGeneration: 5,
      scope: "context.check",
    }), /expired/);
    assert.throws(() => broker.replace(prepared.sessionHandle, prepared.claims.activationId, refreshed), /no matching active attempt/);
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});

test("a required turn fails closed before runtime admission when message:send is absent", () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  const sessionId = randomUUID();
  const turnId = randomUUID();
  const attemptId = randomUUID();
  registerSpace({ id: spaceId, name: "No reply", slug: `no-reply-${spaceId}`, rootPath: path.join(kithSpaceHome(), "no-reply", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({
      id: agentId, spaceId, name: "no-reply", displayName: "No Reply", status: "active",
      scopes: { granted: ["message:read"], mode: "custom", revision: 1, updatedAt: new Date(0).toISOString() },
    }).run();
    db.insert(schema.channels).values({ id: channelId, spaceId, name: "required", type: "channel" }).run();
    db.insert(schema.channelAgentMembers).values({ channelId, agentId }).run();
    db.insert(schema.runtimeSessions).values({
      id: sessionId, spaceId, agentId, surfaceKind: "channel", surfaceId: channelId, sessionGeneration: 1,
      runtime: "claude", runtimeConfigFingerprint: "config", adapterVersion: "test", workspaceRootFingerprint: "root", status: "running",
    }).run();
    db.insert(schema.agentTurns).values({
      id: turnId, runtimeSessionId: sessionId, sessionGeneration: 1, spaceId, agentId, status: "running", effectiveDirective: "required",
    }).run();
    db.insert(schema.agentTurnAttempts).values({
      id: attemptId, turnId, attemptNo: 1, status: "claimed", workerGeneration: 1,
      leaseOwner: "test", leaseExpiresAt: new Date(Date.now() + 60_000),
    }).run();
    assert.throws(() => new TurnCapabilityService(spaceId, new SessionCapabilityBroker(), db).prepare(attemptId), /without message:send/);
    assert.equal(db.select().from(schema.turnCapabilityActivations).all().length, 0);
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});
