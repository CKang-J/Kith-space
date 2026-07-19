import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import test from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { kithSpaceHome } from "../paths.js";
import { workspaceDbFile } from "../paths.js";
import type { CreateEpisodicMemoryCommand } from "./contracts.js";
import { EpisodicMemoryService, MemoryError } from "./episodicMemoryService.js";

function command(input: {
  agentId: string;
  surfaceId: string;
  text: string;
  summary?: string | null;
  disclosure?: "internal_use" | "shareable_summary" | "explicit_only";
  sourceId?: string;
  visibility?: "public" | "private" | "dm" | "local_file";
  idempotencyKey?: string;
}): CreateEpisodicMemoryCommand {
  return {
    schemaVersion: 1,
    scope: "agent_private",
    ownerAgentId: input.agentId,
    kind: "preference",
    subjectRef: { kind: "human", id: "human" },
    subjectKey: "human",
    predicateKey: "preferred_drink",
    canonicalText: input.text,
    internalSummary: input.summary ?? null,
    shareableSummary: input.summary ?? null,
    status: "active",
    confidence: 1,
    importance: 0.8,
    sensitivity: "private",
    disclosure: input.disclosure ?? "shareable_summary",
    validFrom: null,
    validTo: null,
    tags: ["偏好", "饮品"],
    evidence: [{
      sourceSpaceId: null,
      sourceKind: "message",
      sourceId: input.sourceId ?? randomUUID(),
      sourceSurfaceId: input.surfaceId,
      visibilityAtOccurrence: input.visibility ?? "dm",
      assertedBy: { type: "human", id: "human" },
      quotedFrom: null,
      claimType: "human_assertion",
      memoryPolicy: "human_manual",
      excerpt: input.text,
      occurredAt: 100,
    }],
    actor: { type: "human", id: "human" },
    idempotencyKey: input.idempotencyKey ?? randomUUID(),
  };
}

test("revisioned episodic memory enforces disclosure, CAS, Chinese recall and forget suppression", () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const dmId = randomUUID();
  const publicId = randomUUID();
  registerSpace({ id: spaceId, name: "Memory", slug: `memory-${spaceId}`, rootPath: path.join(kithSpaceHome(), "episodic-memory", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "memory-agent", displayName: "Memory Agent", status: "active" }).run();
    db.insert(schema.channels).values([
      { id: dmId, spaceId, name: "human-memory-agent", type: "dm" },
      { id: publicId, spaceId, name: "public", type: "channel" },
    ]).run();
    db.insert(schema.channelAgentMembers).values([
      { channelId: dmId, agentId },
      { channelId: publicId, agentId },
    ]).run();
    const sourceMessageId = randomUUID();
    db.insert(schema.messages).values({
      id: sourceMessageId, seq: 1, spaceId, channelId: dmId, senderType: "human", senderId: "human", senderName: "Human",
      content: "我偏爱乌龙茶，不要咖啡",
    }).run();
    const service = new EpisodicMemoryService(spaceId, db, () => 1_000);
    const create = command({ agentId, surfaceId: dmId, sourceId: sourceMessageId, text: "我偏爱乌龙茶，不要咖啡", summary: "Human 偏爱乌龙茶。", visibility: "public", idempotencyKey: "create-preference" });
    const first = service.create(create);
    assert.equal(first.memory.currentRevision, 1);
    assert.equal(first.revision.canonicalText, create.canonicalText);
    assert.deepEqual(first.tags, ["偏好", "饮品"]);
    assert.equal(first.evidence[0]?.visibilityAtOccurrence, "dm", "stored visibility comes from the authoritative surface");
    assert.equal(service.create(create).memory.id, first.memory.id, "same create command replays idempotently");
    assert.throws(() => service.mutate({
      schemaVersion: 1, action: "archive", memoryId: first.memory.id, expectedRevision: 1,
      idempotencyKey: "create-preference", payload: {},
    }, { type: "human", id: "human" }), (error: unknown) => error instanceof MemoryError && error.code === "MEMORY_CONFLICT");

    const publicRecall = service.recall({ agentId, targetSurfaceId: publicId, query: "喜欢什么茶" });
    assert.equal(publicRecall[0]?.memoryId, first.memory.id);
    assert.equal(publicRecall[0]?.projection, "shareable_summary");
    assert.equal(publicRecall[0]?.content, "Human 偏爱乌龙茶。");
    assert.deepEqual(publicRecall[0]?.evidenceRefs, [{ sourceKind: "message", sourceId: sourceMessageId }]);
    assert.equal(publicRecall[0]?.score, Object.values(publicRecall[0]!.scoreBreakdown).reduce((sum, value) => sum + value, 0));
    assert.deepEqual(publicRecall[0]?.reasons, ["continuity"], "continuity does not require lexical overlap");
    const dmRecall = service.recall({ agentId, targetSurfaceId: dmId, query: "乌龙茶" });
    assert.equal(dmRecall[0]?.projection, "canonical");
    assert.match(dmRecall[0]?.content ?? "", /不要咖啡/);

    const edited = service.mutate({
      schemaVersion: 1,
      action: "correct",
      memoryId: first.memory.id,
      expectedRevision: 1,
      idempotencyKey: "edit-preference",
      payload: { canonicalText: "我偏爱凤凰单丛乌龙茶", shareableSummary: "Human 偏爱凤凰单丛。", tags: ["偏好", "凤凰单丛"] },
    }, { type: "human", id: "human" });
    assert.ok("memory" in edited);
    assert.equal("memory" in edited ? edited.memory.currentRevision : 0, 2);
    assert.equal(db.select().from(schema.episodicMemoryRevisions).where(eq(schema.episodicMemoryRevisions.memoryId, first.memory.id)).all().length, 2);
    assert.deepEqual(db.select({
      fromRevision: schema.memoryRelations.fromRevision,
      toRevision: schema.memoryRelations.toRevision,
      relationType: schema.memoryRelations.relationType,
    }).from(schema.memoryRelations).where(eq(schema.memoryRelations.fromMemoryId, first.memory.id)).get(), {
      fromRevision: 1,
      toRevision: 2,
      relationType: "supersedes",
    });
    assert.equal(service.getHumanDetail(first.memory.id).revisionHistory.length, 2);
    assert.equal(service.getHumanDetail(first.memory.id).relations.length, 1);
    assert.throws(() => service.mutate({
      schemaVersion: 1, action: "archive", memoryId: first.memory.id, expectedRevision: 1,
      idempotencyKey: "stale", payload: {},
    }, { type: "human", id: "human" }), (error: unknown) => error instanceof MemoryError && error.code === "MEMORY_CONFLICT");

    const chinese = service.recall({ agentId, targetSurfaceId: publicId, query: "凤凰单丛" });
    assert.equal(chinese[0]?.memoryId, first.memory.id);
    const archived = service.mutate({
      schemaVersion: 1, action: "archive", memoryId: first.memory.id, expectedRevision: 2,
      idempotencyKey: "archive-preference", payload: {},
    }, { type: "human", id: "human" });
    assert.equal("memory" in archived ? archived.memory.status : "", "archived");
    assert.equal(service.recall({ agentId, targetSurfaceId: publicId, query: "凤凰单丛" }).length, 0);
    const restored = service.mutate({
      schemaVersion: 1, action: "restore", memoryId: first.memory.id, expectedRevision: 3,
      idempotencyKey: "restore-preference", payload: {},
    }, { type: "human", id: "human" });
    assert.equal("memory" in restored ? restored.memory.status : "", "active");
    const forgotten = service.mutate({
      schemaVersion: 1, action: "forget_suppress", memoryId: first.memory.id, expectedRevision: 4,
      idempotencyKey: "forget-preference", payload: {},
    }, { type: "human", id: "human" });
    assert.deepEqual(forgotten, { memoryId: first.memory.id, deleted: true, suppressed: true });
    assert.equal(db.select().from(schema.episodicMemoryRevisions).where(eq(schema.episodicMemoryRevisions.memoryId, first.memory.id)).all().length, 0);
    assert.equal((db.all(sql`SELECT count(*) AS count FROM memory_fts WHERE memory_id = ${first.memory.id}`) as Array<{ count: number }>)[0]?.count, 0);
    assert.equal(service.reindex(), 0);
    assert.throws(
      () => service.create({
        ...create,
        canonicalText: "我仍然偏爱凤凰单丛乌龙茶！",
        shareableSummary: "Human 偏爱凤凰单丛。",
        idempotencyKey: "recreate-forgotten",
      }),
      (error: unknown) => error instanceof MemoryError && error.code === "MEMORY_SUPPRESSED",
    );
    const suppression = service.listSuppressions({ scope: "agent_private", ownerAgentId: agentId })[0]!;
    assert.equal(service.revokeSuppression(suppression.id, { type: "human", id: "human" }).status, "revoked");
    const recreated = service.create({
      ...create,
      canonicalText: "我仍然偏爱凤凰单丛乌龙茶！",
      idempotencyKey: "recreate-after-unsuppress",
    });
    assert.equal(recreated.memory.status, "active");
    service.mutate({ schemaVersion: 1, action: "forget_suppress", memoryId: recreated.memory.id,
      expectedRevision: 1, idempotencyKey: "forget-again", payload: {} }, { type: "human", id: "human" });
    assert.throws(() => service.create({
      ...create, canonicalText: "我依然偏爱凤凰单丛乌龙茶", idempotencyKey: "third-create",
    }), (error: unknown) => error instanceof MemoryError && error.code === "MEMORY_SUPPRESSED");
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});

test("FTS failure degrades to continuity and exact lookup without failing memory recall", () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const dmId = randomUUID();
  const channelId = randomUUID();
  registerSpace({ id: spaceId, name: "FTS fallback", slug: `fts-fallback-${spaceId}`, rootPath: path.join(kithSpaceHome(), "memory-fts-fallback", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "fts-agent", displayName: "FTS Agent", status: "active" }).run();
    db.insert(schema.channels).values([
      { id: dmId, spaceId, name: "human-fts-agent", type: "dm" },
      { id: channelId, spaceId, name: "target", type: "channel" },
    ]).run();
    db.insert(schema.channelAgentMembers).values([{ channelId: dmId, agentId }, { channelId, agentId }]).run();
    const sourceId = randomUUID();
    db.insert(schema.messages).values({
      id: sourceId, seq: 1, spaceId, channelId: dmId, senderType: "human", senderId: "human", senderName: "Human",
      content: "用户喜欢简洁周报格式", memoryPolicy: "eligible",
    }).run();
    const service = new EpisodicMemoryService(spaceId, db);
    const created = service.create({
      ...command({ agentId, surfaceId: dmId, sourceId, text: "用户喜欢简洁周报格式", summary: "偏好简洁周报" }),
      predicateKey: "weekly_report_style",
    });
    db.run(sql`DROP TABLE memory_fts`);

    const continuity = service.recall({ agentId, targetSurfaceId: channelId, query: "完全不同的问法" });
    assert.equal(continuity[0]?.memoryId, created.memory.id);
    assert.deepEqual(continuity[0]?.reasons, ["continuity"]);
    const exact = service.recall({ agentId, targetSurfaceId: channelId, query: "周报", includeContinuity: false });
    assert.equal(exact[0]?.memoryId, created.memory.id);
    assert.ok(exact[0]?.reasons.includes("query"));
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});

test("agent reads never expose explicit-only private memory content across surfaces", () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const sourceId = randomUUID();
  const targetId = randomUUID();
  registerSpace({ id: spaceId, name: "Disclosure", slug: `disclosure-${spaceId}`, rootPath: path.join(kithSpaceHome(), "episodic-disclosure", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "disclosure-agent", displayName: "Disclosure Agent", status: "active" }).run();
    db.insert(schema.channels).values([
      { id: sourceId, spaceId, name: "source", type: "dm" },
      { id: targetId, spaceId, name: "target", type: "channel" },
    ]).run();
    db.insert(schema.channelAgentMembers).values([{ channelId: sourceId, agentId }, { channelId: targetId, agentId }]).run();
    const sourceMessageId = randomUUID();
    db.insert(schema.messages).values({
      id: sourceMessageId, seq: 1, spaceId, channelId: sourceId, senderType: "human", senderId: "human", senderName: "Human",
      content: "绝不能跨会话泄露",
    }).run();
    const service = new EpisodicMemoryService(spaceId, db);
    const record = service.create(command({ agentId, surfaceId: sourceId, sourceId: sourceMessageId, text: "绝不能跨会话泄露", summary: "也不应泄露", disclosure: "explicit_only" }));
    const expired = service.create({
      ...command({ agentId, surfaceId: sourceId, sourceId: sourceMessageId, text: "已经过期的偏好", summary: "过期" }),
      predicateKey: "expired_preference", validTo: 1, idempotencyKey: randomUUID(),
    });
    assert.equal(service.recall({ agentId, targetSurfaceId: targetId, query: "已经过期" }).some((item) => item.memoryId === expired.memory.id), false);
    const recalled = service.getForAgent(record.memory.id, agentId, targetId);
    assert.equal(recalled.projection, "ref_only");
    assert.equal(recalled.content, null);
    db.delete(schema.channelAgentMembers).where(and(
      eq(schema.channelAgentMembers.channelId, sourceId),
      eq(schema.channelAgentMembers.agentId, agentId),
    )).run();
    assert.deepEqual(service.recall({ agentId, targetSurfaceId: targetId, query: "绝不能" }), []);
    assert.throws(() => service.getForAgent(record.memory.id, agentId, targetId), /source is no longer accessible/);
    assert.equal(service.getHuman(record.memory.id).memory.sourceAccess, "revoked");
    db.insert(schema.channelAgentMembers).values({ channelId: sourceId, agentId }).run();
    assert.equal(service.recall({ agentId, targetSurfaceId: targetId, query: "绝不能" })[0]?.memoryId, record.memory.id);
    assert.equal(service.getHuman(record.memory.id).memory.sourceAccess, "available");
    const excludedMessageId = randomUUID();
    db.insert(schema.messages).values({
      id: excludedMessageId, seq: 2, spaceId, channelId: sourceId, senderType: "human", senderId: "human", senderName: "Human",
      content: "不要形成记忆", memoryPolicy: "exclude",
    }).run();
    assert.throws(() => service.create(
      command({ agentId, surfaceId: sourceId, sourceId: excludedMessageId, text: "不要形成记忆", summary: null }),
    ), /memory-excluded source message/);
    assert.throws(
      () => service.mutate({ schemaVersion: 1, action: "edit", memoryId: record.memory.id, expectedRevision: 1, idempotencyKey: "agent-edit", payload: { canonicalText: "bad" } }, { type: "agent", id: agentId }),
      (error: unknown) => error instanceof MemoryError && error.code === "MEMORY_FORBIDDEN",
    );
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});

test("Human can retain a revoked private memory as independent knowledge without restoring source access", () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const dmId = randomUUID();
  const publicId = randomUUID();
  registerSpace({ id: spaceId, name: "Retain", slug: `retain-${spaceId}`, rootPath: path.join(kithSpaceHome(), "memory-retain", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "retain-agent", displayName: "Retain Agent", status: "active" }).run();
    db.insert(schema.channels).values([
      { id: dmId, spaceId, name: "human-retain-agent", type: "dm" },
      { id: publicId, spaceId, name: "public", type: "channel" },
    ]).run();
    db.insert(schema.channelAgentMembers).values([
      { channelId: dmId, agentId },
      { channelId: publicId, agentId },
    ]).run();
    const sourceId = randomUUID();
    db.insert(schema.messages).values({
      id: sourceId,
      seq: 1,
      spaceId,
      channelId: dmId,
      senderType: "human",
      senderId: "human",
      senderName: "Human",
      content: "我偏好简洁周报",
      memoryPolicy: "eligible",
    }).run();
    const service = new EpisodicMemoryService(spaceId, db);
    const created = service.create(command({
      agentId,
      surfaceId: dmId,
      sourceId,
      text: "Human prefers concise weekly reports",
      summary: "Prefers concise reports",
      visibility: "dm",
    }));

    db.delete(schema.channelAgentMembers).where(and(
      eq(schema.channelAgentMembers.channelId, dmId),
      eq(schema.channelAgentMembers.agentId, agentId),
    )).run();
    assert.equal(service.recall({ agentId, targetSurfaceId: publicId, query: "weekly reports" }).length, 0);
    assert.equal(service.getHuman(created.memory.id).memory.sourceAccess, "revoked");
    const idempotencyKey = randomUUID();
    const retainCommand = {
      schemaVersion: 1 as const,
      action: "retain_independent" as const,
      memoryId: created.memory.id,
      expectedRevision: 1,
      idempotencyKey,
      payload: {},
    };
    assert.throws(() => service.mutate(retainCommand, { type: "agent", id: agentId }), /only the Human/);
    const retained = service.mutate(retainCommand, { type: "human", id: "human" });
    assert.ok("memory" in retained);
    assert.equal(retained.memory.currentRevision, 2);
    assert.equal(retained.memory.sourceAccess, "available");
    assert.deepEqual(retained.revision.createdBy, { type: "human", id: "human" });

    const detail = service.getHumanDetail(created.memory.id);
    assert.ok(detail.evidence.some((item) => item.sourceKind === "message" && item.sourceId === sourceId), "revoked source remains auditable");
    const manual = detail.evidence.find((item) => item.memoryRevision === 2);
    assert.equal(manual?.sourceKind, "manual");
    assert.equal(manual?.sourceSurfaceId, null);
    assert.deepEqual(manual?.assertedBy, { type: "human", id: "human" });
    assert.ok(detail.relations.some((item) => item.relationType === "derived_from"
      && item.fromRevision === 2 && item.toRevision === 1));

    const recalled = service.recall({ agentId, targetSurfaceId: publicId, query: "weekly reports" });
    assert.equal(recalled[0]?.memoryId, created.memory.id);
    assert.deepEqual(recalled[0]?.evidenceRefs, [{ sourceKind: "manual", sourceId: manual!.sourceId }]);
    assert.equal(db.select().from(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.channelId, dmId)).get(), undefined,
      "retaining knowledge must not restore source membership");

    const replay = service.mutate(retainCommand, { type: "human", id: "human" });
    assert.ok("memory" in replay);
    assert.equal(replay.memory.currentRevision, 2);
    assert.throws(() => service.mutate({ ...retainCommand, idempotencyKey: randomUUID() }, { type: "human", id: "human" }), /expected revision 1/);
    assert.throws(() => service.mutate({
      ...retainCommand,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
    }, { type: "human", id: "human" }), /only an active memory with unavailable source access/);
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});

test("forget removes canonical payload bytes from the workspace database and WAL", () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "episodic-physical-forget", spaceId);
  const canary = `MEMORY_CANARY_${randomUUID().replaceAll("-", "")}`;
  registerSpace({ id: spaceId, name: "Physical forget", slug: `physical-forget-${spaceId}`, rootPath });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "forget-agent", displayName: "Forget Agent", status: "active" }).run();
    db.insert(schema.channels).values({ id: channelId, spaceId, name: "forget-dm", type: "dm" }).run();
    db.insert(schema.channelAgentMembers).values({ channelId, agentId }).run();
    const messageId = randomUUID();
    db.insert(schema.messages).values({
      id: messageId, seq: 1, spaceId, channelId, senderType: "human", senderId: "human", senderName: "Human",
      content: "请记住这个临时偏好", memoryPolicy: "eligible",
    }).run();
    const service = new EpisodicMemoryService(spaceId, db);
    const created = service.create(command({ agentId, surfaceId: channelId, sourceId: messageId, text: canary, summary: "临时偏好" }));
    service.mutate({
      schemaVersion: 1, action: "forget_suppress", memoryId: created.memory.id, expectedRevision: 1,
      idempotencyKey: randomUUID(), payload: {},
    }, { type: "human", id: "human" });
    closeSpaceDb(spaceId);
    for (const file of [workspaceDbFile(rootPath), `${workspaceDbFile(rootPath)}-wal`]) {
      if (existsSync(file)) assert.equal(readFileSync(file).includes(Buffer.from(canary)), false, `${path.basename(file)} retained forgotten plaintext`);
    }
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});

test("correction can supersede an item with a replacement pointer used by old-term recall", () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  registerSpace({ id: spaceId, name: "Replacement", slug: `replacement-${spaceId}`, rootPath: path.join(kithSpaceHome(), "memory-replacement", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "replacement-agent", displayName: "Replacement Agent", status: "active" }).run();
    db.insert(schema.channels).values({ id: channelId, spaceId, name: "replacement", type: "channel" }).run();
    db.insert(schema.channelAgentMembers).values({ channelId, agentId }).run();
    const sourceIds = [randomUUID(), randomUUID()];
    db.insert(schema.messages).values(sourceIds.map((id, index) => ({
      id, seq: index + 1, spaceId, channelId, senderType: "human" as const, senderId: "human", senderName: "Human",
      content: index === 0 ? "旧偏好是拿铁" : "新偏好是乌龙茶", memoryPolicy: "eligible" as const,
    }))).run();
    const service = new EpisodicMemoryService(spaceId, db);
    const oldMemory = service.create(command({ agentId, surfaceId: channelId, sourceId: sourceIds[0], text: "旧偏好是拿铁", summary: "旧偏好拿铁" }));
    const replacement = service.create({
      ...command({ agentId, surfaceId: channelId, sourceId: sourceIds[1], text: "新偏好是乌龙茶", summary: "新偏好乌龙茶" }),
      predicateKey: "preferred_drink_new",
      idempotencyKey: randomUUID(),
    });
    service.mutate({
      schemaVersion: 1, action: "correct", memoryId: oldMemory.memory.id, expectedRevision: 1,
      idempotencyKey: randomUUID(), payload: { replacementMemoryId: replacement.memory.id, relationType: "supersedes" },
    }, { type: "human", id: "human" });

    const recalled = service.recall({ agentId, targetSurfaceId: channelId, query: "拿铁", includeContinuity: false });
    assert.equal(recalled[0]?.memoryId, replacement.memory.id);
    assert.deepEqual(recalled[0]?.relation, { type: "supersedes", replacementId: replacement.memory.id });
    assert.deepEqual(service.getForAgent(oldMemory.memory.id, agentId, channelId).relation, {
      type: "supersedes", replacementId: replacement.memory.id,
    });
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});

test("file evidence is resolved against the current Space lifecycle on every recall", () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "memory-file-source", spaceId);
  registerSpace({ id: spaceId, name: "File source", slug: `file-source-${spaceId}`, rootPath });
  const db = dbForSpace(spaceId);
  const sourcePath = path.join(rootPath, "preference.txt");
  writeFileSync(sourcePath, "Human prefers source-backed answers.");
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "file-agent", displayName: "File Agent", status: "active" }).run();
    db.insert(schema.channels).values({ id: channelId, spaceId, name: "target", type: "channel" }).run();
    db.insert(schema.channelAgentMembers).values({ channelId, agentId }).run();
    const service = new EpisodicMemoryService(spaceId, db);
    const created = service.create({
      schemaVersion: 1, scope: "agent_private", ownerAgentId: agentId, kind: "preference",
      subjectRef: { kind: "human", id: "human" }, subjectKey: "human", predicateKey: "source_backed",
      canonicalText: "Human prefers source-backed answers.", internalSummary: null, shareableSummary: "Use sources.",
      status: "active", confidence: 1, importance: 1, sensitivity: "normal", disclosure: "shareable_summary",
      validFrom: null, validTo: null, tags: [], actor: { type: "human", id: "human" }, idempotencyKey: randomUUID(),
      evidence: [{ sourceSpaceId: spaceId, sourceKind: "file", sourceId: "preference.txt", sourceSurfaceId: null,
        visibilityAtOccurrence: "public", assertedBy: { type: "human", id: "human" }, quotedFrom: null,
        claimType: "manual", memoryPolicy: "human_manual", excerpt: "source-backed", occurredAt: Date.now() }],
    });
    assert.equal(created.evidence[0]?.visibilityAtOccurrence, "local_file");
    assert.equal(service.recall({ agentId, targetSurfaceId: channelId, query: "source-backed" })[0]?.memoryId, created.memory.id);
    unlinkSync(sourcePath);
    assert.deepEqual(service.recall({ agentId, targetSurfaceId: channelId, query: "source-backed" }), []);
    assert.equal(service.getHuman(created.memory.id).memory.sourceAccess, "deleted");
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});

test("turn evidence derives its surface authoritatively and tombstones when the turn is deleted", () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  const sessionId = randomUUID();
  const turnId = randomUUID();
  registerSpace({ id: spaceId, name: "Turn source", slug: `turn-source-${spaceId}`, rootPath: path.join(kithSpaceHome(), "memory-turn-source", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "turn-agent", displayName: "Turn Agent", status: "active" }).run();
    db.insert(schema.channels).values({ id: channelId, spaceId, name: "turn-surface", type: "channel" }).run();
    db.insert(schema.channelAgentMembers).values({ channelId, agentId }).run();
    db.insert(schema.runtimeSessions).values({
      id: sessionId, spaceId, agentId, surfaceKind: "channel", surfaceId: channelId, sessionGeneration: 1,
      runtime: "claude", runtimeConfigFingerprint: "config", adapterVersion: "test", workspaceRootFingerprint: "root",
    }).run();
    db.insert(schema.agentTurns).values({
      id: turnId, runtimeSessionId: sessionId, sessionGeneration: 1, spaceId, agentId,
      status: "completed", outcome: "replied", effectiveDirective: "required",
    }).run();
    const service = new EpisodicMemoryService(spaceId, db);
    const created = service.create({
      schemaVersion: 1, scope: "agent_private", ownerAgentId: agentId, kind: "decision",
      subjectRef: { kind: "project", id: "project" }, subjectKey: "project", predicateKey: "turn_decision",
      canonicalText: "The turn decided to use SQLite.", internalSummary: null, shareableSummary: "Use SQLite.",
      status: "active", confidence: 1, importance: 1, sensitivity: "normal", disclosure: "shareable_summary",
      validFrom: null, validTo: null, tags: [], actor: { type: "human", id: "human" }, idempotencyKey: randomUUID(),
      evidence: [{ sourceSpaceId: spaceId, sourceKind: "turn", sourceId: turnId, sourceSurfaceId: null,
        visibilityAtOccurrence: "private", assertedBy: { type: "human", id: "human" }, quotedFrom: null,
        claimType: "manual", memoryPolicy: "human_manual", excerpt: "Use SQLite", occurredAt: Date.now() }],
    });
    assert.equal(created.evidence[0]?.sourceSurfaceId, channelId);
    assert.equal(created.evidence[0]?.visibilityAtOccurrence, "public");
    assert.equal(service.recall({ agentId, targetSurfaceId: channelId, query: "SQLite" })[0]?.memoryId, created.memory.id);
    db.delete(schema.agentTurns).where(eq(schema.agentTurns.id, turnId)).run();
    assert.deepEqual(service.recall({ agentId, targetSurfaceId: channelId, query: "SQLite" }), []);
    assert.equal(service.getHuman(created.memory.id).memory.sourceAccess, "deleted");
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});
