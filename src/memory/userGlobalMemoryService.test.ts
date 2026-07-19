import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { migrateAppDatabase } from "../app-data/appDatabaseMigrations.js";
import { and, eq } from "drizzle-orm";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { kithSpaceHome } from "../paths.js";
import type { CreateEpisodicMemoryCommand } from "./contracts.js";
import { MemoryError } from "./episodicMemoryService.js";
import { UserGlobalMemoryService } from "./userGlobalMemoryService.js";

function globalCommand(): CreateEpisodicMemoryCommand {
  return {
    schemaVersion: 1,
    scope: "user_global",
    ownerAgentId: null,
    kind: "preference",
    subjectRef: { kind: "human", id: "human" },
    subjectKey: "human",
    predicateKey: "writing_style",
    canonicalText: "中文回答保持简洁",
    internalSummary: "Human prefers concise Chinese answers.",
    shareableSummary: "Human 偏好简洁中文回答。",
    status: "active",
    confidence: 1,
    importance: 0.9,
    sensitivity: "private",
    disclosure: "shareable_summary",
    validFrom: null,
    validTo: null,
    tags: ["中文", "偏好"],
    evidence: [{
      sourceSpaceId: null,
      sourceKind: "manual",
      sourceId: randomUUID(),
      sourceSurfaceId: null,
      visibilityAtOccurrence: "local_file",
      assertedBy: { type: "human", id: "human" },
      quotedFrom: null,
      claimType: "manual",
      memoryPolicy: "human_manual",
      excerpt: "中文回答保持简洁",
      occurredAt: 100,
    }],
    actor: { type: "human", id: "human" },
    idempotencyKey: randomUUID(),
  };
}

test("app.db user-global memory is Human-owned, revisioned and suppressible", () => {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrateAppDatabase(sqlite, ":memory:");
  try {
    const service = new UserGlobalMemoryService(sqlite, () => 1_000);
    const command = globalCommand();
    const created = service.create(command);
    assert.equal(created.memory.scope, "user_global");
    const recalled = service.recall({ currentSpaceId: "current-space", agentId: "agent", targetSurfaceId: "public-target", query: "中文简洁" });
    assert.equal(recalled[0]?.content, "Human 偏好简洁中文回答。");
    assert.equal(recalled[0]?.score, Object.values(recalled[0]!.scoreBreakdown).reduce((sum, value) => sum + value, 0));
    assert.equal(service.recall({ currentSpaceId: "current-space", agentId: "agent", targetSurfaceId: "public-target", query: "完全不同的问题" })[0]?.memoryId, created.memory.id);

    const edited = service.mutate({
      schemaVersion: 1,
      action: "edit",
      memoryId: created.memory.id,
      expectedRevision: 1,
      idempotencyKey: "global-edit",
      payload: { canonicalText: "中文回答保持非常简洁" },
    }, { type: "human", id: "human" });
    assert.ok("memory" in edited);
    assert.equal("memory" in edited ? edited.memory.current_revision : 0, 2);
    assert.equal(service.getHumanDetail(created.memory.id).revisionHistory.length, 2);
    assert.throws(() => service.mutate({
      schemaVersion: 1, action: "archive", memoryId: created.memory.id, expectedRevision: 2,
      idempotencyKey: "global-edit", payload: {},
    }, { type: "human", id: "human" }), (error: unknown) => error instanceof MemoryError && error.code === "MEMORY_CONFLICT");

    assert.throws(() => service.mutate({
      schemaVersion: 1,
      action: "archive",
      memoryId: created.memory.id,
      expectedRevision: 2,
      idempotencyKey: "agent-global-edit",
      payload: {},
    }, { type: "agent", id: "agent" }), (error: unknown) => error instanceof MemoryError && error.code === "MEMORY_FORBIDDEN");

    assert.deepEqual(service.mutate({
      schemaVersion: 1,
      action: "forget_suppress",
      memoryId: created.memory.id,
      expectedRevision: 2,
      idempotencyKey: "global-forget",
      payload: {},
    }, { type: "human", id: "human" }), { memoryId: created.memory.id, deleted: true, suppressed: true });
    assert.equal(sqlite.prepare("SELECT count(*) FROM user_episodic_memory_revisions").pluck().get(), 0);
    assert.equal(sqlite.prepare("SELECT count(*) FROM user_memory_fts").pluck().get(), 0);
    assert.throws(() => service.create({
      ...command,
      canonicalText: "中文回答仍应保持非常简洁！",
      idempotencyKey: "global-recreate",
    }), (error: unknown) => error instanceof MemoryError && error.code === "MEMORY_SUPPRESSED");
    const suppression = service.listSuppressions()[0] as { id: string };
    assert.ok(suppression);
    assert.equal((service.revokeSuppression(suppression.id, { type: "human", id: "human" }) as { status: string }).status, "revoked");
    const recreated = service.create({
      ...command, canonicalText: "中文回答仍应保持非常简洁！", idempotencyKey: "global-recreate-after-unsuppress",
    });
    assert.equal(recreated.memory.status, "active");
    service.mutate({ schemaVersion: 1, action: "forget_suppress", memoryId: recreated.memory.id,
      expectedRevision: 1, idempotencyKey: "global-forget-again", payload: {} }, { type: "human", id: "human" });
    assert.throws(() => service.create({
      ...command, canonicalText: "中文回答依旧保持非常简洁", idempotencyKey: "global-third-create",
    }), (error: unknown) => error instanceof MemoryError && error.code === "MEMORY_SUPPRESSED");
  } finally {
    sqlite.close();
  }
});

test("only manually promoted, non-secret user-global memory is accepted", () => {
  const sqlite = new Database(":memory:");
  migrateAppDatabase(sqlite, ":memory:");
  try {
    const service = new UserGlobalMemoryService(sqlite);
    const command = globalCommand();
    assert.throws(() => service.create({ ...command, actor: { type: "agent", id: "agent" } }), /only the Human/);
    assert.throws(() => service.create({ ...command, sensitivity: "secret" }), /secret content/);
    assert.throws(() => service.create({
      ...command,
      evidence: command.evidence.map((item) => ({ ...item, memoryPolicy: "eligible" as const })),
    }), /manually promoted/);
    const future = service.create({ ...command, validFrom: Date.now() + 60_000, idempotencyKey: randomUUID() });
    assert.equal(service.recall({ currentSpaceId: "space", agentId: "agent", targetSurfaceId: "target", query: "中文" })
      .some((item) => item.memoryId === future.memory.id), false);
  } finally {
    sqlite.close();
  }
});

test("user-global forget removes canonical payload bytes from app.db and WAL", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-user-memory-forget-"));
  const dbPath = path.join(root, "app.db");
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  migrateAppDatabase(sqlite, dbPath);
  const canary = `USER_MEMORY_CANARY_${randomUUID().replaceAll("-", "")}`;
  try {
    const service = new UserGlobalMemoryService(sqlite);
    const created = service.create({ ...globalCommand(), canonicalText: canary, idempotencyKey: randomUUID() });
    service.mutate({
      schemaVersion: 1, action: "forget_suppress", memoryId: created.memory.id, expectedRevision: 1,
      idempotencyKey: randomUUID(), payload: {},
    }, { type: "human", id: "human" });
    sqlite.close();
    for (const file of [dbPath, `${dbPath}-wal`]) {
      if (existsSync(file)) assert.equal(readFileSync(file).includes(Buffer.from(canary)), false, `${path.basename(file)} retained forgotten plaintext`);
    }
  } finally {
    if (sqlite.open) sqlite.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("user-global message evidence is authoritative and follows current cross-Space ACL", () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  const otherSpaceId = randomUUID();
  const otherAgentId = randomUUID();
  const otherChannelId = randomUUID();
  registerSpace({ id: spaceId, name: "Global source", slug: `global-source-${spaceId}`, rootPath: path.join(kithSpaceHome(), "global-source", spaceId) });
  registerSpace({ id: otherSpaceId, name: "Global consumer", slug: `global-consumer-${otherSpaceId}`, rootPath: path.join(kithSpaceHome(), "global-consumer", otherSpaceId) });
  const db = dbForSpace(spaceId);
  const otherDb = dbForSpace(otherSpaceId);
  const sqlite = new Database(":memory:");
  migrateAppDatabase(sqlite, ":memory:");
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "global-agent", displayName: "Global Agent", status: "active" }).run();
    db.insert(schema.channels).values({ id: channelId, spaceId, name: "private-source", type: "private" }).run();
    db.insert(schema.channelAgentMembers).values({ channelId, agentId }).run();
    otherDb.insert(schema.agents).values({ id: otherAgentId, spaceId: otherSpaceId, name: "other-agent", displayName: "Other Agent", status: "active" }).run();
    otherDb.insert(schema.channels).values({ id: otherChannelId, spaceId: otherSpaceId, name: "other-target", type: "channel" }).run();
    otherDb.insert(schema.channelAgentMembers).values({ channelId: otherChannelId, agentId: otherAgentId }).run();
    const messageId = randomUUID();
    db.insert(schema.messages).values({
      id: messageId, seq: 1, spaceId, channelId, senderType: "human", senderId: "human", senderName: "Human",
      content: "跨Space偏好", memoryPolicy: "eligible",
    }).run();
    const service = new UserGlobalMemoryService(sqlite);
    const created = service.create({
      ...globalCommand(),
      idempotencyKey: randomUUID(),
      evidence: [{ sourceSpaceId: spaceId, sourceKind: "message", sourceId: messageId, sourceSurfaceId: channelId,
        visibilityAtOccurrence: "public", assertedBy: { type: "human", id: "human" }, quotedFrom: null,
        claimType: "manual", memoryPolicy: "human_manual", excerpt: "跨Space偏好", occurredAt: Date.now() }],
    });
    assert.equal(created.evidence[0]?.visibility_at_occurrence, "private");
    assert.equal(service.recall({ currentSpaceId: spaceId, agentId, targetSurfaceId: channelId, query: "中文" })[0]?.memoryId, created.memory.id);
    db.delete(schema.channelAgentMembers).where(and(
      eq(schema.channelAgentMembers.channelId, channelId), eq(schema.channelAgentMembers.agentId, agentId),
    )).run();
    assert.deepEqual(service.recall({ currentSpaceId: spaceId, agentId, targetSurfaceId: channelId, query: "中文" }), []);
    assert.equal(service.getHuman(created.memory.id).memory.source_access, "revoked");
    db.insert(schema.channelAgentMembers).values({ channelId, agentId }).run();
    assert.equal(service.recall({ currentSpaceId: spaceId, agentId, targetSurfaceId: channelId, query: "中文" })[0]?.memoryId, created.memory.id);
    assert.deepEqual(service.recall({
      currentSpaceId: otherSpaceId, agentId: otherAgentId, targetSurfaceId: otherChannelId, query: "中文",
    }), [], "an Agent in another Space cannot inherit private source access");

    const excludedId = randomUUID();
    db.insert(schema.messages).values({
      id: excludedId, seq: 2, spaceId, channelId, senderType: "human", senderId: "human", senderName: "Human",
      content: "禁止记忆", memoryPolicy: "exclude",
    }).run();
    assert.throws(() => service.create({
      ...globalCommand(), idempotencyKey: randomUUID(), evidence: [{
        sourceSpaceId: spaceId, sourceKind: "message", sourceId: excludedId, sourceSurfaceId: channelId,
        visibilityAtOccurrence: "private", assertedBy: { type: "human", id: "human" }, quotedFrom: null,
        claimType: "manual", memoryPolicy: "human_manual", excerpt: "禁止记忆", occurredAt: Date.now(),
      }],
    }), /memory-excluded source message/);

    unregisterSpace(spaceId);
    assert.equal(service.hasSourceAccess(created.memory.id, spaceId, agentId), false,
      "a lost or removed source Space cannot remain readable through user-global memory");
    assert.equal(service.getHuman(created.memory.id).memory.source_access, "unavailable");
  } finally {
    sqlite.close();
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
    closeSpaceDb(otherSpaceId);
    unregisterSpace(otherSpaceId);
  }
});
