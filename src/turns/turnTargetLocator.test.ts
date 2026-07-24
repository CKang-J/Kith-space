import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Database from "better-sqlite3";
import {
  availableSpaceDbs,
  closeSpaceDb,
  dbForSpace,
  registerSpace,
  schema,
  unregisterSpace,
} from "../db/index.js";
import { kithSpaceHome, workspaceDbFile } from "../paths.js";
import { locateTurnTarget } from "./turnTargetLocator.js";

test("turn target lookup and registry scans isolate an unrelated incompatible Space", () => {
  const invalidSpaceId = randomUUID();
  const validSpaceId = randomUUID();
  const invalidRoot = path.join(kithSpaceHome(), "turn-target-invalid", invalidSpaceId);
  const validRoot = path.join(kithSpaceHome(), "turn-target-valid", validSpaceId);
  const invalidDbPath = workspaceDbFile(invalidRoot);
  mkdirSync(path.dirname(invalidDbPath), { recursive: true });
  const invalid = new Database(invalidDbPath);
  invalid.exec("CREATE TABLE poison (id TEXT); PRAGMA user_version = 6;");
  invalid.close();
  registerSpace({ id: invalidSpaceId, name: "Invalid", slug: `invalid-${invalidSpaceId}`, rootPath: invalidRoot });
  registerSpace({ id: validSpaceId, name: "Valid", slug: `valid-${validSpaceId}`, rootPath: validRoot });

  try {
    const db = dbForSpace(validSpaceId);
    const agentId = randomUUID();
    const channelId = randomUUID();
    const sessionId = randomUUID();
    const turnId = randomUUID();
    const attemptId = randomUUID();
    db.insert(schema.agents).values({
      id: agentId,
      spaceId: validSpaceId,
      name: "valid-agent",
      displayName: "Valid Agent",
      status: "active",
    }).run();
    db.insert(schema.channels).values({ id: channelId, spaceId: validSpaceId, name: "valid", type: "channel" }).run();
    db.insert(schema.runtimeSessions).values({
      id: sessionId,
      spaceId: validSpaceId,
      agentId,
      surfaceKind: "channel",
      surfaceId: channelId,
      sessionGeneration: 1,
      runtime: "claude",
      runtimeConfigFingerprint: "config",
      adapterVersion: "test",
      workspaceRootFingerprint: "root",
      status: "running",
    }).run();
    db.insert(schema.agentTurns).values({
      id: turnId,
      runtimeSessionId: sessionId,
      sessionGeneration: 1,
      spaceId: validSpaceId,
      agentId,
      effectiveDirective: "required",
      status: "running",
    }).run();
    db.insert(schema.agentTurnAttempts).values({
      id: attemptId,
      turnId,
      attemptNo: 1,
      status: "running",
      workerGeneration: 1,
      leaseOwner: "test",
      leaseExpiresAt: new Date(Date.now() + 60_000),
    }).run();

    const skipped: string[] = [];
    assert.deepEqual(
      availableSpaceDbs((space) => skipped.push(space.id)).map(({ space }) => space.id),
      [validSpaceId],
    );
    assert.deepEqual(skipped, [invalidSpaceId]);
    assert.equal(locateTurnTarget({ spaceId: validSpaceId, turnId, attemptId, sessionId })?.spaceId, validSpaceId);
    assert.equal(locateTurnTarget({ spaceId: validSpaceId, turnId, attemptId: randomUUID(), sessionId }), null);
  } finally {
    closeSpaceDb(validSpaceId);
    closeSpaceDb(invalidSpaceId);
    unregisterSpace(validSpaceId);
    unregisterSpace(invalidSpaceId);
    rmSync(validRoot, { recursive: true, force: true });
    rmSync(invalidRoot, { recursive: true, force: true });
  }
});
