import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { kithSpaceHome } from "../paths.js";
import { EpisodicMemoryService } from "./episodicMemoryService.js";
import { MemoryManagementService } from "./memoryManagementService.js";

test("management view performs server-side search/filter/pagination and exposes recall diagnostics", () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  registerSpace({ id: spaceId, name: "Manage", slug: `manage-${spaceId}`, rootPath: path.join(kithSpaceHome(), "memory-manage", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "manage", displayName: "Manage", status: "active" }).run();
    db.insert(schema.channels).values({ id: channelId, spaceId, name: "dm", type: "dm" }).run();
    db.insert(schema.channelAgentMembers).values({ channelId, agentId }).run();
    const source = db.insert(schema.messages).values({
      id: randomUUID(), seq: 1, spaceId, channelId, senderType: "human", senderId: "human",
      senderName: "Human", content: "我喜欢中文简报", memoryPolicy: "eligible",
    }).returning().get();
    const service = new EpisodicMemoryService(spaceId, db);
    const memory = service.create({
      schemaVersion: 1, scope: "agent_private", ownerAgentId: agentId, kind: "preference",
      subjectRef: { kind: "human", id: "human" }, subjectKey: "human", predicateKey: "brief_language",
      canonicalText: "Human prefers Chinese briefs", internalSummary: "中文简报", shareableSummary: "偏好中文简报",
      status: "active", confidence: 1, importance: 0.9, sensitivity: "normal", disclosure: "shareable_summary",
      validFrom: null, validTo: null, tags: ["语言"], actor: { type: "human", id: "human" }, idempotencyKey: randomUUID(),
      evidence: [{ sourceSpaceId: spaceId, sourceKind: "message", sourceId: source.id, sourceSurfaceId: channelId,
        visibilityAtOccurrence: "dm", assertedBy: { type: "human", id: "human" }, quotedFrom: null,
        claimType: "human_assertion", memoryPolicy: "human_manual", excerpt: source.content, occurredAt: Date.now() }],
    });
    const selected = service.recall({ agentId, targetSurfaceId: channelId, query: "中文", includeContinuity: true });
    assert.equal(selected[0]?.memoryId, memory.memory.id);

    const management = new MemoryManagementService(spaceId, db);
    const result = management.list({ ownerAgentId: agentId, query: "中文", kind: "preference", status: "active", tag: "语言", page: 1, pageSize: 10 });
    assert.equal(result.total, 1);
    assert.equal(result.items[0]!.memory.id, memory.memory.id);
    assert.equal(result.items[0]!.evidenceCount, 1);
    assert.equal(result.items[0]!.inContinuityBundle, true);
    assert.equal(result.items[0]!.lastRecall?.projection, "canonical");
    const detail = management.detail(memory.memory.id);
    assert.equal(detail.revisionHistory.length, 1);
    assert.equal(detail.recalls.length, 1);
    db.delete(schema.channelAgentMembers).where(and(
      eq(schema.channelAgentMembers.channelId, channelId), eq(schema.channelAgentMembers.agentId, agentId),
    )).run();
    const revoked = management.list({ ownerAgentId: agentId, status: "active" }).items[0]!;
    assert.equal(revoked.memory.sourceAccess, "revoked");
    assert.equal(revoked.inContinuityBundle, false);
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});
