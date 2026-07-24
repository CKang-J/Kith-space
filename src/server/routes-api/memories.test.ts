import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import test from "node:test";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../../db/index.js";
import { EpisodicMemoryService } from "../../memory/episodicMemoryService.js";
import { kithSpaceHome } from "../../paths.js";
import type { SpaceCtx } from "./ctx.js";
import { handleMemories } from "./memories.js";

function responseCapture() {
  const capture: { status?: number; body?: string } = {};
  const res = {
    writeHead(status: number) { capture.status = status; return this; },
    end(body?: string) { capture.body = body; return this; },
  } as unknown as ServerResponse;
  return { capture, res };
}

test("Human memory REST exposes revision history/relations and can revoke a suppression", async () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  registerSpace({ id: spaceId, name: "Memory API", slug: `memory-api-${spaceId}`, rootPath: path.join(kithSpaceHome(), "memory-api", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "memory-api-agent", displayName: "Memory API Agent", status: "active" }).run();
    db.insert(schema.channels).values({ id: channelId, spaceId, name: "source", type: "channel" }).run();
    db.insert(schema.channelAgentMembers).values({ channelId, agentId }).run();
    const message = db.insert(schema.messages).values({
      id: randomUUID(), seq: 1, spaceId, channelId, senderType: "human", senderId: "human", senderName: "Human",
      content: "记忆API来源", memoryPolicy: "eligible",
    }).returning().get();
    const service = new EpisodicMemoryService(spaceId, db);
    const command = {
      schemaVersion: 1 as const, scope: "agent_private" as const, ownerAgentId: agentId, kind: "fact" as const,
      subjectRef: { kind: "human" as const, id: "human" }, subjectKey: "human", predicateKey: "api_fact",
      canonicalText: "记忆API事实", internalSummary: null, shareableSummary: "API事实", status: "active" as const,
      confidence: 1, importance: 1, sensitivity: "normal" as const, disclosure: "shareable_summary" as const,
      validFrom: null, validTo: null, tags: [], actor: { type: "human" as const, id: "human" }, idempotencyKey: randomUUID(),
      evidence: [{ sourceSpaceId: spaceId, sourceKind: "message" as const, sourceId: message.id, sourceSurfaceId: channelId,
        visibilityAtOccurrence: "public" as const, assertedBy: { type: "human" as const, id: "human" }, quotedFrom: null,
        claimType: "human_assertion" as const, memoryPolicy: "human_manual" as const, excerpt: message.content, occurredAt: Date.now() }],
    };
    const memory = service.create(command);
    service.mutate({ schemaVersion: 1, action: "correct", memoryId: memory.memory.id, expectedRevision: 1,
      idempotencyKey: randomUUID(), payload: { canonicalText: "记忆API事实 v2" } }, { type: "human", id: "human" });

    const detailResponse = responseCapture();
    const detailUrl = new URL(`http://localhost/api/memories/${memory.memory.id}`);
    await handleMemories({ req: {} as IncomingMessage, res: detailResponse.res, url: detailUrl,
      method: "GET", p: detailUrl.pathname, humanId: "human", spaceId } satisfies SpaceCtx);
    assert.equal(detailResponse.capture.status, 200);
    const detail = JSON.parse(detailResponse.capture.body ?? "{}") as { revisionHistory: unknown[]; relations: unknown[] };
    assert.equal(detail.revisionHistory.length, 2);
    assert.equal(detail.relations.length, 1);

    service.mutate({ schemaVersion: 1, action: "forget_suppress", memoryId: memory.memory.id, expectedRevision: 2,
      idempotencyKey: randomUUID(), payload: {} }, { type: "human", id: "human" });
    const suppressionId = service.listSuppressions({ ownerAgentId: agentId })[0]!.id;
    const revokeResponse = responseCapture();
    const revokeUrl = new URL(`http://localhost/api/memories/suppressions/${suppressionId}/revoke`);
    await handleMemories({ req: {} as IncomingMessage, res: revokeResponse.res, url: revokeUrl,
      method: "POST", p: revokeUrl.pathname, humanId: "human", spaceId } satisfies SpaceCtx);
    assert.equal(revokeResponse.capture.status, 200);
    assert.equal((JSON.parse(revokeResponse.capture.body ?? "{}") as { status: string }).status, "revoked");
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});
