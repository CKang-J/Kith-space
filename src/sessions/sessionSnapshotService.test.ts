import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { kithSpaceHome } from "../paths.js";
import { assertTerminalSnapshotIdentity, SessionSnapshotService } from "./sessionSnapshotService.js";

test("snapshot store accepts monotonic same-generation state and rejects stale/corrupt/secret payloads", () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  const sessionId = randomUUID();
  registerSpace({ id: spaceId, name: "Snapshot", slug: `snapshot-${spaceId}`,
    rootPath: path.join(kithSpaceHome(), "snapshot-test", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "snapshot", displayName: "Snapshot" }).run();
    db.insert(schema.channels).values({ id: channelId, spaceId, name: "surface", type: "channel" }).run();
    db.insert(schema.runtimeSessions).values({
      id: sessionId, spaceId, agentId, surfaceKind: "channel", surfaceId: channelId, sessionGeneration: 2,
      runtime: "codex", engineSessionId: "engine-authority", runtimeConfigFingerprint: "config",
      adapterVersion: "test", workspaceRootFingerprint: "root", status: "idle", checklistRevision: 3,
    }).run();
    db.insert(schema.sessionChecklistItems).values({ runtimeSessionId: sessionId, text: "resume me", status: "in_progress", sortOrder: 1, rowVersion: 3 }).run();
    const service = new SessionSnapshotService(spaceId, db);
    const report = {
      schemaVersion: 1 as const, spaceId, sessionId, sessionGeneration: 2, snapshotVersion: 1, savedAt: 1000,
      adapterSnapshot: { schemaVersion: 1, payload: { runtime: "codex", engineSessionId: "engine-authority", resumable: true } },
    };
    assert.doesNotThrow(() => assertTerminalSnapshotIdentity(report, { spaceId, sessionId, sessionGeneration: 2 }));
    assert.throws(() => assertTerminalSnapshotIdentity(report, { spaceId, sessionId: "another-session", sessionGeneration: 2 }), /identity does not match/);
    assert.throws(() => assertTerminalSnapshotIdentity(report, { spaceId, sessionId, sessionGeneration: 3 }), /identity does not match/);
    assert.throws(() => assertTerminalSnapshotIdentity(report, { spaceId: "another-space", sessionId, sessionGeneration: 2 }), /identity does not match/);
    assert.deepEqual(service.persist(report), { persisted: true, snapshotVersion: 1 });
    assert.equal(service.load(sessionId)?.checklistRevision, 3);
    db.update(schema.runtimeSessions).set({ checklistRevision: 5 }).where(eq(schema.runtimeSessions.id, sessionId)).run();
    assert.equal(service.load(sessionId)?.checklistRevision, 5, "restoring an older adapter snapshot cannot roll back the authoritative checklist collection revision");
    assert.equal(service.load(sessionId)?.engineSessionId, "engine-authority");
    assert.deepEqual(service.persist(report), { persisted: false, snapshotVersion: 1 }, "same version/content is idempotent");
    assert.throws(() => service.persist({ ...report, adapterSnapshot: { schemaVersion: 1, payload: { runtime: "other" } } }), /reused with different content/);
    assert.throws(() => service.persist({ ...report, sessionGeneration: 1, snapshotVersion: 2 }), /stale session generation/);
    assert.throws(() => service.persist({ ...report, snapshotVersion: 2, adapterSnapshot: { schemaVersion: 1, payload: { transcript: "must not persist" } } }), /forbidden recovery field/);
    assert.throws(() => service.persist({ ...report, snapshotVersion: 2, adapterSnapshot: { schemaVersion: 1, payload: { note: "api_key=abcdefghijklmnop" } } }), /credential-shaped/);

    db.update(schema.runtimeSessions).set({ snapshotChecksum: "corrupt" }).where(eq(schema.runtimeSessions.id, sessionId)).run();
    assert.equal(service.load(sessionId), null);
    const row = db.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.id, sessionId)).get()!;
    assert.equal(row.snapshot, null, "corrupt payload is discarded while authoritative session/checklist rows remain");
    assert.equal(db.select().from(schema.sessionChecklistItems).where(eq(schema.sessionChecklistItems.runtimeSessionId, sessionId)).all().length, 1);
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});
