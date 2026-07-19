import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import { deleteAgentAndPrivateConversations } from "../agents/agentDeletion.js";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { kithSpaceHome, workspaceDbFile } from "../paths.js";
import type { CreateEpisodicMemoryCommand } from "./contracts.js";
import { EpisodicMemoryService } from "./episodicMemoryService.js";

test("Agent deletion clears private episodic payload and suppressions but preserves Space-shared memory", async () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "memory-lifecycle", spaceId);
  const privateCanary = `AGENT_PRIVATE_CANARY_${randomUUID().replaceAll("-", "")}`;
  registerSpace({ id: spaceId, name: "Memory lifecycle", slug: `memory-lifecycle-${spaceId}`, rootPath });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "lifecycle-agent", displayName: "Lifecycle Agent", status: "active" }).run();
    db.insert(schema.channels).values({ id: channelId, spaceId, name: "source", type: "channel" }).run();
    db.insert(schema.channelAgentMembers).values({ channelId, agentId }).run();
    const service = new EpisodicMemoryService(spaceId, db);
    let seq = 0;
    const create = (scope: "agent_private" | "space_shared", text: string): CreateEpisodicMemoryCommand => {
      const sourceId = randomUUID();
      db.insert(schema.messages).values({
        id: sourceId, seq: ++seq, spaceId, channelId,
        senderType: "human", senderId: "human", senderName: "Human", content: "authoritative source", memoryPolicy: "eligible",
      }).run();
      return {
        schemaVersion: 1, scope, ownerAgentId: scope === "agent_private" ? agentId : null, kind: "fact",
        subjectRef: { kind: "human", id: "human" }, subjectKey: "human", predicateKey: randomUUID(),
        canonicalText: text, internalSummary: null, shareableSummary: text, status: "active", confidence: 1,
        importance: 1, sensitivity: "normal", disclosure: "shareable_summary", validFrom: null, validTo: null,
        tags: [], actor: { type: "human", id: "human" }, idempotencyKey: randomUUID(),
        evidence: [{ sourceSpaceId: spaceId, sourceKind: "message", sourceId, sourceSurfaceId: channelId,
          visibilityAtOccurrence: "public", assertedBy: { type: "human", id: "human" }, quotedFrom: null,
          claimType: "human_assertion", memoryPolicy: "human_manual", excerpt: "authoritative source", occurredAt: Date.now() }],
      };
    };
    const forgotten = service.create(create("agent_private", "private forgotten payload"));
    service.mutate({ schemaVersion: 1, action: "forget_suppress", memoryId: forgotten.memory.id, expectedRevision: 1, idempotencyKey: randomUUID(), payload: {} }, { type: "human", id: "human" });
    const privateMemory = service.create(create("agent_private", privateCanary));
    const sharedMemory = service.create(create("space_shared", "shared payload"));

    await deleteAgentAndPrivateConversations(spaceId, agentId);

    assert.equal(db.select().from(schema.episodicMemories).where(eq(schema.episodicMemories.id, privateMemory.memory.id)).get(), undefined);
    assert.ok(db.select().from(schema.episodicMemories).where(eq(schema.episodicMemories.id, sharedMemory.memory.id)).get());
    assert.equal(db.select().from(schema.memorySuppressions).where(eq(schema.memorySuppressions.ownerAgentId, agentId)).all().length, 0);
    for (const file of [workspaceDbFile(rootPath), `${workspaceDbFile(rootPath)}-wal`]) {
      if (existsSync(file)) assert.equal(readFileSync(file).includes(Buffer.from(privateCanary)), false, `${path.basename(file)} retained deleted Agent memory`);
    }
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});
