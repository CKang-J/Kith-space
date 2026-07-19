import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { kithSpaceHome } from "../paths.js";
import { ContextAssembler } from "./contextAssembler.js";
import { TurnInspector } from "../turns/turnInspector.js";
import { TurnLedger } from "../turns/turnLedger.js";
import { EpisodicMemoryService } from "../memory/episodicMemoryService.js";
import { UserGlobalMemoryService } from "../memory/userGlobalMemoryService.js";
import { SessionCompactionMarkerService } from "../sessions/sessionCompactionMarker.js";
import { CapabilityGateway } from "../capabilities/capabilityGateway.js";
import type { TurnCapabilityClaims } from "../capabilities/contracts.js";

test("thread Context Envelope freezes root, as-of parent snapshot, current batch and UI context", () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const parentId = randomUUID();
  const threadId = randomUUID();
  registerSpace({ id: spaceId, name: "Context", slug: `context-${spaceId}`, rootPath: path.join(kithSpaceHome(), "context", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "context-agent", displayName: "Context Agent", runtime: "claude", status: "active" }).run();
    db.insert(schema.channels).values({ id: parentId, spaceId, name: "parent", type: "channel" }).run();
    for (let seq = 1; seq <= 10; seq += 1) {
      db.insert(schema.messages).values({ id: randomUUID(), seq, spaceId, channelId: parentId, senderType: seq % 2 ? "human" : "agent", senderId: "member", senderName: "Member", content: `parent-${seq}` }).run();
    }
    const rootId = randomUUID();
    db.insert(schema.messages).values({
      id: rootId,
      seq: 11,
      spaceId,
      channelId: parentId,
      senderType: "human",
      senderId: "human",
      senderName: "Human",
      content: "@context-agent root",
      threadId,
      contextSnapshot: {
        spaceId,
        module: "chat",
        routeId: "chat.channel",
        openObjectRefs: [{ type: "channel", id: parentId }],
        capturedAt: 11,
      },
    }).run();
    db.insert(schema.channels).values({ id: threadId, spaceId, name: "thread", type: "thread", parentMessageId: rootId }).run();
    db.insert(schema.channelAgentMembers).values({ channelId: parentId, agentId }).run();
    db.insert(schema.channelAgentMembers).values({ channelId: threadId, agentId }).run();
    const sessionId = randomUUID();
    db.insert(schema.runtimeSessions).values({
      id: sessionId,
      spaceId,
      agentId,
      surfaceKind: "thread",
      surfaceId: threadId,
      sessionGeneration: 1,
      runtime: "claude",
      runtimeConfigFingerprint: "config",
      adapterVersion: "test",
      workspaceRootFingerprint: "workspace",
      status: "idle",
      engineSessionId: "engine-before-compaction",
    }).run();
    const compactedTurnId = randomUUID();
    const compactedAttemptId = randomUUID();
    db.insert(schema.agentTurns).values({
      id: compactedTurnId, runtimeSessionId: sessionId, sessionGeneration: 1, spaceId, agentId,
      effectiveDirective: "optional", status: "completed", outcome: "ceded", completedAt: new Date(90),
    }).run();
    db.insert(schema.agentTurnAttempts).values({
      id: compactedAttemptId, turnId: compactedTurnId, attemptNo: 1, status: "succeeded", workerGeneration: 1,
      leaseOwner: "test", leaseExpiresAt: new Date(1_000), completedAt: new Date(90),
    }).run();
    db.insert(schema.agentTurnEvents).values({
      attemptId: compactedAttemptId, ordinal: 0, kind: "compaction_completed", payload: {}, createdAt: new Date(80),
    }).run();
    const compactionEvent = {
      schemaVersion: 2 as const, workerGeneration: 1, sessionId, sessionGeneration: 1,
      turnId: compactedTurnId, attemptId: compactedAttemptId, eventId: randomUUID(), ordinal: 0,
      kind: "compaction_completed" as const, payload: {}, createdAt: 80,
    };
    const markers = new SessionCompactionMarkerService(spaceId, db);
    assert.equal(markers.recordPersistedEvent(compactionEvent).revision, 1);
    assert.equal(markers.recordPersistedEvent(compactionEvent).revision, 1, "reprojecting the same durable event cannot advance the marker");
    db.update(schema.runtimeSessions).set({ compactionRevision: 0, lastCompactedAt: null }).where(eq(schema.runtimeSessions.id, sessionId)).run();
    assert.equal(markers.reconcile(sessionId, 1)?.revision, 1, "terminal reconciliation repairs a lost best-effort event projection");
    const turnId = randomUUID();
    db.insert(schema.agentTurns).values({ id: turnId, runtimeSessionId: sessionId, sessionGeneration: 1, spaceId, agentId, effectiveDirective: "required" }).run();
    const deliveryId = randomUUID();
    db.insert(schema.agentDeliveryItems).values({
      id: deliveryId,
      spaceId,
      agentId,
      messageId: rootId,
      sourceChannelId: parentId,
      sourceSeq: 11,
      cursorOwnerChannelId: parentId,
      targetSurfaceKind: "thread",
      targetSurfaceId: threadId,
      targetRuntimeSessionId: sessionId,
      directive: "required",
      reason: "explicit_mention",
      policySnapshot: {},
      disposition: "bound",
      turnId,
    }).run();
    db.insert(schema.messages).values({ id: randomUUID(), seq: 12, spaceId, channelId: parentId, senderType: "human", senderId: "human", senderName: "Human", content: "later-parent" }).run();

    const first = new ContextAssembler(spaceId, db, () => 100).assemble(turnId, "activation-1");
    assert.equal(first.envelope.continuityMode, "post_compaction");
    assert.equal(db.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.id, sessionId)).get()!.contextCompactionRevision, 1);
    assert.equal(first.envelope.objectSnapshots[0]?.sourceKind, "runtime_compaction");
    assert.equal(first.envelope.objectSnapshots[0]?.sourceId, `${compactedTurnId}:${compactedAttemptId}:0`);
    assert.equal(first.envelope.objectSnapshots[0]?.injectionMode, "reference");
    assert.equal(first.envelope.rootMessage?.sourceId, rootId);
    assert.deepEqual(first.envelope.parentSnapshot?.messageRefs.map((ref) => ref.sourceRevision), [3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(first.envelope.parentSnapshot?.asOfSeq, 11);
    assert.equal(first.envelope.parentSnapshot?.omittedCount, 2);
    assert.equal(first.envelope.currentBatch[0]?.sourceId, rootId);
    assert.equal(first.envelope.uiSnapshot?.routeId, "chat.channel");
    assert.ok(first.envelope.seenWatermarks.some((watermark) => watermark.channelId === parentId && watermark.throughSeq === 11));
    assert.ok(first.envelope.seenWatermarks.some((watermark) => watermark.channelId === threadId && watermark.throughSeq === 0));
    assert.doesNotMatch(first.renderedContext, /later-parent/);
    assert.equal(db.select().from(schema.turnContextSources).where(eq(schema.turnContextSources.turnId, turnId)).all().length, 12);
    const omittedSource = db.select().from(schema.turnContextSources).where(eq(schema.turnContextSources.turnId, turnId)).all()
      .find((source) => source.sourceId !== rootId)!;
    db.update(schema.turnContextSources).set({ injectionMode: "omitted" }).where(and(
      eq(schema.turnContextSources.turnId, turnId),
      eq(schema.turnContextSources.ordinal, omittedSource.ordinal),
    )).run();
    const omittedInspection = new TurnInspector(spaceId, db).inspect(turnId);
    assert.equal(omittedInspection?.context.sources.find((source) => source.ordinal === omittedSource.ordinal)?.state, "omitted");
    assert.equal(omittedInspection?.context.sources.find((source) => source.ordinal === omittedSource.ordinal)?.content, null);

    const deletedSourceId = first.envelope.parentSnapshot!.messageRefs.at(-1)!.sourceId;
    db.delete(schema.messages).where(eq(schema.messages.id, deletedSourceId)).run();
    const replay = new ContextAssembler(spaceId, db, () => 200).assemble(turnId, "activation-2", "resumed");
    assert.equal(replay.envelope.capabilityActivationId, "activation-1", "the logical turn manifest remains immutable across attempts");
    assert.match(replay.renderedContext, /deleted; lineage HMAC=[0-9a-f]{64}/);
    const inspected = new TurnInspector(spaceId, db).inspect(turnId);
    assert.equal(inspected?.context.manifestState, "valid");
    assert.ok(inspected?.context.sources.some((source) => source.sourceId === deletedSourceId && source.state === "tombstone"));
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});

test("Context Envelope never injects or acknowledges a later unbound delivery", () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  registerSpace({ id: spaceId, name: "Frontier", slug: `frontier-${spaceId}`, rootPath: path.join(kithSpaceHome(), "frontier", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "frontier-agent", displayName: "Frontier Agent", runtime: "claude", status: "active" }).run();
    db.insert(schema.channels).values({ id: channelId, spaceId, name: "frontier", type: "channel" }).run();
    db.insert(schema.channelAgentMembers).values({ channelId, agentId }).run();
    const sessionId = randomUUID();
    db.insert(schema.runtimeSessions).values({
      id: sessionId, spaceId, agentId, surfaceKind: "channel", surfaceId: channelId, sessionGeneration: 1,
      runtime: "claude", runtimeConfigFingerprint: "config", adapterVersion: "test", workspaceRootFingerprint: "root", status: "cold",
    }).run();
    const turnId = randomUUID();
    db.insert(schema.agentTurns).values({ id: turnId, runtimeSessionId: sessionId, sessionGeneration: 1, spaceId, agentId, effectiveDirective: "required" }).run();
    const boundMessageId = randomUUID();
    const laterMessageId = randomUUID();
    db.insert(schema.messages).values([
      { id: boundMessageId, seq: 1, spaceId, channelId, senderType: "human", senderId: "human", senderName: "Human", content: "bound-one" },
      { id: laterMessageId, seq: 2, spaceId, channelId, senderType: "human", senderId: "human", senderName: "Human", content: "pending-two-must-not-leak" },
    ]).run();
    db.insert(schema.agentDeliveryItems).values([
      {
        id: randomUUID(), spaceId, agentId, messageId: boundMessageId, sourceChannelId: channelId, sourceSeq: 1,
        cursorOwnerChannelId: channelId, targetSurfaceKind: "channel", targetSurfaceId: channelId, targetRuntimeSessionId: sessionId,
        directive: "required", reason: "mention", policySnapshot: {}, disposition: "bound", turnId,
      },
      {
        id: randomUUID(), spaceId, agentId, messageId: laterMessageId, sourceChannelId: channelId, sourceSeq: 2,
        cursorOwnerChannelId: channelId, targetSurfaceKind: "channel", targetSurfaceId: channelId,
        directive: "required", reason: "mention", policySnapshot: {}, disposition: "pending",
      },
    ]).run();

    const assembled = new ContextAssembler(spaceId, db).assemble(turnId, "activation", "cold");
    assert.deepEqual(assembled.envelope.currentBatch.map((ref) => ref.sourceId), [boundMessageId]);
    assert.equal(assembled.envelope.recentSurface.some((ref) => ref.sourceId === laterMessageId), false);
    assert.equal(assembled.envelope.seenWatermarks.find((item) => item.channelId === channelId)?.throughSeq, 1);
    assert.doesNotMatch(assembled.renderedContext, /pending-two-must-not-leak/);
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});

test("both recall providers may fail without blocking required context or audited conversation access", (t) => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  const sessionId = randomUUID();
  const turnId = randomUUID();
  const attemptId = randomUUID();
  const activationId = randomUUID();
  registerSpace({
    id: spaceId,
    name: "Recall fail-open",
    slug: `recall-fail-open-${spaceId}`,
    rootPath: path.join(kithSpaceHome(), "recall-fail-open", spaceId),
  });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "recall-agent", displayName: "Recall Agent", runtime: "claude", status: "active" }).run();
    db.insert(schema.channels).values({ id: channelId, spaceId, name: "surface", type: "channel" }).run();
    db.insert(schema.channelAgentMembers).values({ channelId, agentId }).run();
    db.insert(schema.runtimeSessions).values({
      id: sessionId, spaceId, agentId, surfaceKind: "channel", surfaceId: channelId, sessionGeneration: 1,
      runtime: "claude", runtimeConfigFingerprint: "config", adapterVersion: "test", workspaceRootFingerprint: "root", status: "running",
    }).run();
    db.insert(schema.agentTurns).values({
      id: turnId, runtimeSessionId: sessionId, sessionGeneration: 1, spaceId, agentId,
      effectiveDirective: "required", status: "running",
    }).run();
    const message = db.insert(schema.messages).values({
      id: randomUUID(), seq: 1, spaceId, channelId, senderType: "human", senderId: "human", senderName: "Human",
      content: "required input survives recall outage", searchText: "required input survives recall outage",
    }).returning().get();
    const delivery = db.insert(schema.agentDeliveryItems).values({
      id: randomUUID(), spaceId, agentId, messageId: message.id, sourceChannelId: channelId, sourceSeq: 1,
      cursorOwnerChannelId: channelId, targetSurfaceKind: "channel", targetSurfaceId: channelId, targetRuntimeSessionId: sessionId,
      directive: "required", reason: "direct_mention", policySnapshot: {}, disposition: "bound", turnId,
    }).returning().get();
    db.insert(schema.agentTurnAttempts).values({
      id: attemptId, turnId, attemptNo: 1, status: "running", workerGeneration: 4,
      leaseOwner: "test", leaseExpiresAt: new Date(Date.now() + 60_000),
    }).run();
    db.insert(schema.turnCapabilityActivations).values({
      id: activationId, turnId, attemptId, sessionGeneration: 1, workerGeneration: 4,
      claimsDigest: "test", status: "active", expiresAt: new Date(Date.now() + 60_000),
    }).run();

    t.mock.method(EpisodicMemoryService.prototype, "recall", () => { throw new Error("workspace recall offline"); });
    t.mock.method(UserGlobalMemoryService.prototype, "recall", () => { throw new Error("global recall offline"); });
    const assembled = new ContextAssembler(spaceId, db).assemble(turnId, activationId, "cold");
    assert.deepEqual(assembled.envelope.currentBatch.map((ref) => ref.sourceId), [message.id]);
    assert.deepEqual(assembled.envelope.omissions.map((item) => item.sourceKind).sort(), ["memory", "user_global_memory"]);
    assert.match(assembled.renderedContext, /required input survives recall outage/);

    const claims: TurnCapabilityClaims = {
      schemaVersion: 1,
      activationId,
      turnId,
      attemptId,
      sessionId,
      sessionGeneration: 1,
      workerGeneration: 4,
      spaceId,
      agentId,
      allowedOutputSurfaceIds: [channelId],
      allowedInputIds: [delivery.id],
      seenWatermarks: [{ channelId, throughSeq: 1 }],
      scopes: ["conversation.read"],
      disclosureGrantIds: [],
      expiresAt: Date.now() + 60_000,
    };
    const read = new CapabilityGateway(spaceId, db).conversationRead(claims, { channelId, limit: 10 });
    assert.deepEqual(read.messages.map((item) => item.id), [message.id]);
    assert.equal(db.select().from(schema.turnContextSources).where(and(
      eq(schema.turnContextSources.turnId, turnId),
      eq(schema.turnContextSources.sourceId, message.id),
    )).get()?.phase, "initial");
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});

test("TurnLedger leaves required delivery overflow pending for the next logical turn", () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  registerSpace({ id: spaceId, name: "Budget", slug: `budget-${spaceId}`, rootPath: path.join(kithSpaceHome(), "budget", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "budget-agent", displayName: "Budget Agent", runtime: "claude", status: "active" }).run();
    db.insert(schema.channels).values({ id: channelId, spaceId, name: "budget", type: "channel" }).run();
    db.insert(schema.channelAgentMembers).values({ channelId, agentId }).run();
    const sessionId = randomUUID();
    db.insert(schema.runtimeSessions).values({
      id: sessionId, spaceId, agentId, surfaceKind: "channel", surfaceId: channelId, sessionGeneration: 1,
      runtime: "claude", runtimeConfigFingerprint: "config", adapterVersion: "test", workspaceRootFingerprint: "root", status: "cold",
    }).run();
    for (let seq = 1; seq <= 3; seq += 1) {
      const messageId = randomUUID();
      db.insert(schema.messages).values({
        id: messageId, seq, spaceId, channelId, senderType: "human", senderId: "human", senderName: "Human", content: String(seq).repeat(16_000),
      }).run();
      db.insert(schema.agentDeliveryItems).values({
        id: randomUUID(), spaceId, agentId, messageId, sourceChannelId: channelId, sourceSeq: seq,
        cursorOwnerChannelId: channelId, targetSurfaceKind: "channel", targetSurfaceId: channelId,
        directive: "required", reason: "mention", policySnapshot: {}, disposition: "pending",
      }).run();
    }
    const session = db.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.id, sessionId)).get()!;
    const turn = new TurnLedger(spaceId, db).bindPendingDeliveries(session);
    assert.ok(turn);
    assert.equal(db.select().from(schema.agentDeliveryItems).where(eq(schema.agentDeliveryItems.turnId, turn!.id)).all().length, 2);
    assert.equal(db.select().from(schema.agentDeliveryItems).where(eq(schema.agentDeliveryItems.disposition, "pending")).all().length, 1);
    const assembled = new ContextAssembler(spaceId, db).assemble(turn!.id, "activation", "cold");
    assert.equal(assembled.envelope.currentBatch.length, 2);
    assert.equal(assembled.envelope.budget.used <= assembled.envelope.budget.available, true);
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});

test("Context Envelope freezes disclosure-projected memory revisions and forget becomes a tombstone", () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const dmId = randomUUID();
  const channelId = randomUUID();
  registerSpace({ id: spaceId, name: "Memory context", slug: `memory-context-${spaceId}`, rootPath: path.join(kithSpaceHome(), "memory-context", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "memory-context", displayName: "Memory Context", status: "active" }).run();
    db.insert(schema.channels).values([
      { id: dmId, spaceId, name: "dm", type: "dm" },
      { id: channelId, spaceId, name: "channel", type: "channel" },
    ]).run();
    db.insert(schema.channelAgentMembers).values([{ channelId: dmId, agentId }, { channelId, agentId }]).run();
    const source = db.insert(schema.messages).values({
      id: randomUUID(), seq: 1, spaceId, channelId: dmId, senderType: "human", senderId: "human", senderName: "Human",
      content: "我的私密偏好是乌龙茶，不喝咖啡",
    }).returning().get();
    const memory = new EpisodicMemoryService(spaceId, db, () => 100).create({
      schemaVersion: 1, scope: "agent_private", ownerAgentId: agentId, kind: "preference",
      subjectRef: { kind: "human", id: "human" }, subjectKey: "human", predicateKey: "drink",
      canonicalText: "Human 私下说偏好乌龙茶且不喝咖啡", internalSummary: "Human 偏好乌龙茶。", shareableSummary: "Human 偏好乌龙茶。",
      status: "active", confidence: 1, importance: 1, sensitivity: "private", disclosure: "shareable_summary",
      validFrom: null, validTo: null, tags: ["乌龙茶"],
      evidence: [{ sourceSpaceId: null, sourceKind: "message", sourceId: source.id, sourceSurfaceId: dmId,
        visibilityAtOccurrence: "dm", assertedBy: { type: "human", id: "human" }, quotedFrom: null,
        claimType: "human_assertion", memoryPolicy: "human_manual", excerpt: source.content, occurredAt: 100 }],
      actor: { type: "human", id: "human" }, idempotencyKey: "context-memory-create",
    });
    const input = db.insert(schema.messages).values({
      id: randomUUID(), seq: 2, spaceId, channelId, senderType: "human", senderId: "human", senderName: "Human",
      content: "我喜欢喝什么？",
    }).returning().get();
    const sessionId = randomUUID();
    db.insert(schema.runtimeSessions).values({
      id: sessionId, spaceId, agentId, surfaceKind: "channel", surfaceId: channelId, sessionGeneration: 1,
      runtime: "claude", runtimeConfigFingerprint: "config", adapterVersion: "test", workspaceRootFingerprint: "root", status: "cold",
    }).run();
    const turnId = randomUUID();
    db.insert(schema.agentTurns).values({ id: turnId, runtimeSessionId: sessionId, sessionGeneration: 1, spaceId, agentId, effectiveDirective: "required" }).run();
    db.insert(schema.agentDeliveryItems).values({
      id: randomUUID(), spaceId, agentId, messageId: input.id, sourceChannelId: channelId, sourceSeq: input.seq,
      cursorOwnerChannelId: channelId, targetSurfaceKind: "channel", targetSurfaceId: channelId, targetRuntimeSessionId: sessionId,
      directive: "required", reason: "mention", policySnapshot: {}, disposition: "bound", turnId,
    }).run();

    const first = new ContextAssembler(spaceId, db).assemble(turnId, "activation", "cold");
    assert.equal(first.envelope.recalledMemories[0]?.memoryId, memory.memory.id);
    assert.equal(first.envelope.recalledMemories[0]?.projection, "shareable_summary");
    assert.match(first.renderedContext, /Human 偏好乌龙茶。/);
    assert.doesNotMatch(first.renderedContext, /不喝咖啡/);

    new EpisodicMemoryService(spaceId, db).mutate({
      schemaVersion: 1, action: "forget_suppress", memoryId: memory.memory.id, expectedRevision: 1,
      idempotencyKey: "context-memory-forget", payload: {},
    }, { type: "human", id: "human" });
    const replay = new ContextAssembler(spaceId, db).assemble(turnId, "other-activation", "resumed");
    assert.match(replay.renderedContext, /forgotten or unavailable; lineage HMAC=/);
    assert.doesNotMatch(replay.renderedContext, /Human 偏好乌龙茶。/);
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});
