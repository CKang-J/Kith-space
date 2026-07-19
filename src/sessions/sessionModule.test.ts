import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { kithSpaceHome } from "../paths.js";
import { runtimeConfigFingerprint, SessionModule } from "./sessionModule.js";

test("per-Agent cutover is mutually exclusive and never backfills the legacy global session", () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "session-module-test", spaceId);
  registerSpace({ id: spaceId, name: "Sessions", slug: `sessions-${spaceId}`, rootPath });
  const db = dbForSpace(spaceId);
  db.insert(schema.agents).values({
    id: agentId,
    spaceId,
    name: "session-agent",
    displayName: "Session Agent",
    sessionId: "legacy-global-session",
  }).run();
  let now = 1_700_000_000_000;
  const sessions = new SessionModule(spaceId, db, () => now);
  const address = { spaceId, agentId, surfaceKind: "channel" as const, surfaceId: "channel-1" };

  try {
    assert.equal(sessions.harnessMode(agentId), "legacy");
    assert.throws(() => sessions.ensureSession({
      address,
      runtime: "claude",
      model: null,
      runtimeConfig: {},
      adapterVersion: "v2-bridge-1",
      workspaceRootFingerprint: "root-1",
    }), /legacy harness mode/);
    assert.throws(() => sessions.beginCutover(agentId, { legacyDrained: false, reason: "test" }), /must be drained/);

    sessions.beginCutover(agentId, { legacyDrained: true, reason: "test" });
    assert.equal(sessions.harnessMode(agentId), "migrating");
    assert.throws(() => sessions.assertDataPlane(agentId, "legacy"), /migrating harness mode/);
    assert.throws(() => sessions.assertDataPlane(agentId, "v2"), /migrating harness mode/);
    sessions.completeCutover(agentId);
    assert.equal(sessions.harnessMode(agentId), "v2");

    const channel = sessions.ensureSession({
      address,
      runtime: "claude",
      model: null,
      runtimeConfig: { beta: 2, alpha: 1 },
      adapterVersion: "v2-bridge-1",
      workspaceRootFingerprint: "root-1",
      engineHostFingerprint: "host-1",
    });
    const same = sessions.ensureSession({
      address,
      runtime: "claude",
      model: null,
      runtimeConfig: { alpha: 1, beta: 2 },
      adapterVersion: "v2-bridge-1",
      workspaceRootFingerprint: "root-1",
      engineHostFingerprint: "host-1",
    });
    const dm = sessions.ensureSession({
      address: { ...address, surfaceKind: "dm", surfaceId: "dm-1" },
      runtime: "claude",
      model: null,
      runtimeConfig: { alpha: 1, beta: 2 },
      adapterVersion: "v2-bridge-1",
      workspaceRootFingerprint: "root-1",
      engineHostFingerprint: "host-1",
    });
    assert.equal(same.id, channel.id);
    assert.notEqual(dm.id, channel.id);
    assert.equal(channel.sessionGeneration, 1);
    assert.equal(dm.sessionGeneration, 1);
    assert.equal(db.select({ sessionId: schema.agents.sessionId }).from(schema.agents).where(eq(schema.agents.id, agentId)).get()?.sessionId, "legacy-global-session");

    now += 1;
    const activeTurnId = randomUUID();
    db.insert(schema.agentTurns).values({
      id: activeTurnId,
      runtimeSessionId: channel.id,
      sessionGeneration: channel.sessionGeneration,
      spaceId,
      agentId,
      effectiveDirective: "required",
      status: "running",
    }).run();
    assert.throws(() => sessions.ensureSession({
      address,
      runtime: "claude",
      model: "claude-new",
      runtimeConfig: { alpha: 1, beta: 2 },
      adapterVersion: "v2-bridge-1",
      workspaceRootFingerprint: "root-1",
      engineHostFingerprint: "host-1",
    }), /cannot change while a turn is non-terminal/);
    db.update(schema.agentTurns).set({ status: "completed", outcome: "replied", completedAt: new Date(now) })
      .where(eq(schema.agentTurns.id, activeTurnId)).run();
    const changed = sessions.ensureSession({
      address,
      runtime: "claude",
      model: "claude-new",
      runtimeConfig: { alpha: 1, beta: 2 },
      adapterVersion: "v2-bridge-1",
      workspaceRootFingerprint: "root-1",
      engineHostFingerprint: "host-1",
    });
    assert.notEqual(changed.id, channel.id);
    assert.equal(changed.sessionGeneration, 2);
    assert.throws(() => sessions.acknowledgeEngineSession({
      sessionId: channel.id,
      sessionGeneration: channel.sessionGeneration,
      engineSessionId: "stale-engine",
    }), /stale generation/);
    assert.equal(sessions.acknowledgeEngineSession({
      sessionId: changed.id,
      sessionGeneration: changed.sessionGeneration,
      engineSessionId: "engine-new",
    }).engineSessionId, "engine-new");

    assert.throws(() => sessions.rollbackToLegacy(agentId, { v2Drained: false, reason: "test" }), /must be drained/);
    const rollbackAcceptedAt = sessions.assertRollbackWindow(agentId);
    now += 8 * 24 * 60 * 60 * 1000;
    sessions.rollbackToLegacy(agentId, { v2Drained: true, reason: "test", acceptedAt: rollbackAcceptedAt });
    assert.equal(sessions.harnessMode(agentId), "legacy");
    assert.equal(sessions.currentSession(address), null);
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});

test("runtime config fingerprints are stable across object key order", () => {
  assert.equal(runtimeConfigFingerprint({ a: 1, b: { y: 2, x: 1 } }), runtimeConfigFingerprint({ b: { x: 1, y: 2 }, a: 1 }));
  assert.notEqual(runtimeConfigFingerprint({ a: 1 }), runtimeConfigFingerprint({ a: 2 }));
});

test("rollback to legacy is rejected after the explicit rollback window", () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  registerSpace({ id: spaceId, name: "Rollback", slug: `rollback-${spaceId}`, rootPath: path.join(kithSpaceHome(), "session-module-test", spaceId) });
  const db = dbForSpace(spaceId);
  let now = 10_000;
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "rollback-agent", displayName: "Rollback Agent" }).run();
    const sessions = new SessionModule(spaceId, db, () => now);
    sessions.beginCutover(agentId, { legacyDrained: true, reason: "test", rollbackWindowMs: 100 });
    sessions.completeCutover(agentId);
    now = 10_101;
    assert.throws(() => sessions.rollbackToLegacy(agentId, { v2Drained: true, reason: "late" }), /rollback window has expired/);
    assert.equal(sessions.harnessMode(agentId), "v2");
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});
