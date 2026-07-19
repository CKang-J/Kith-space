import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { nextSeq } from "../counters.js";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { kithSpaceHome } from "../paths.js";
import { MAX_TURN_EVENT_AGGREGATE_BYTES, TurnLedger } from "./turnLedger.js";
import { TurnOutputService } from "./turnOutputService.js";

async function fixture() {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  const sessionId = randomUUID();
  const turnId = randomUUID();
  const attemptId = randomUUID();
  registerSpace({ id: spaceId, name: "Turn output", slug: `turn-output-${spaceId}`, rootPath: path.join(kithSpaceHome(), "turn-output", spaceId) });
  const db = dbForSpace(spaceId);
  db.insert(schema.agents).values({ id: agentId, spaceId, name: "output-agent", displayName: "Output Agent", status: "active" }).run();
  db.insert(schema.channels).values({ id: channelId, spaceId, name: "output", type: "channel" }).run();
  db.insert(schema.channelAgentMembers).values({ channelId, agentId, lastReadSeq: 0 }).run();
  db.insert(schema.agentHarnessState).values({ agentId, mode: "v2" }).run();
  db.insert(schema.runtimeSessions).values({
    id: sessionId,
    spaceId,
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
    spaceId,
    agentId,
    effectiveDirective: "required",
    status: "running",
  }).run();
  const deliveries: string[] = [];
  for (const content of ["first required", "second required"]) {
    const messageId = randomUUID();
    const seq = await nextSeq(spaceId);
    db.insert(schema.messages).values({ id: messageId, seq, spaceId, channelId, senderType: "human", senderId: "human", senderName: "Human", content, memoryPolicy: "eligible" }).run();
    const deliveryId = randomUUID();
    db.insert(schema.agentDeliveryItems).values({
      id: deliveryId,
      spaceId,
      agentId,
      messageId,
      sourceChannelId: channelId,
      sourceSeq: seq,
      cursorOwnerChannelId: channelId,
      targetSurfaceKind: "channel",
      targetSurfaceId: channelId,
      targetRuntimeSessionId: sessionId,
      directive: "required",
      reason: "direct_mention",
      policySnapshot: {},
      disposition: "bound",
      turnId,
    }).run();
    deliveries.push(deliveryId);
  }
  db.insert(schema.agentTurnAttempts).values({
    id: attemptId,
    turnId,
    attemptNo: 1,
    status: "running",
    workerGeneration: 2,
    leaseOwner: "test",
    leaseExpiresAt: new Date(Date.now() + 60_000),
  }).run();
  const events: unknown[] = [];
  const legacyDispatches: unknown[] = [];
  const legacyReservationCounts: number[] = [];
  const legacyRecoveries: string[] = [];
  const output = new TurnOutputService(spaceId, {
    async publish(_spaceId, event) { events.push(event); },
    async dispatchLegacyMentions(input) {
      legacyReservationCounts.push(db.select().from(schema.dispatchWakes).where(and(
        eq(schema.dispatchWakes.messageId, input.messageId),
        eq(schema.dispatchWakes.status, "reserved"),
      )).all().length);
      legacyDispatches.push(input);
    },
    async recoverLegacyMentions(targetSpaceId) { legacyRecoveries.push(targetSpaceId); },
  }, db);
  return {
    spaceId, agentId, channelId, sessionId, turnId, attemptId, deliveries, db, output, events,
    legacyDispatches, legacyReservationCounts, legacyRecoveries,
  };
}

test("two required inputs cannot finalize after only one is covered", async () => {
  const f = await fixture();
  try {
    await f.output.reply({ turnId: f.turnId, attemptId: f.attemptId, idempotencyKey: "reply:first", body: "Handled the first.", handledInputIds: [f.deliveries[0]!] });
    new TurnLedger(f.spaceId, f.db).markRuntimeTerminal(f.attemptId, { outcome: "completed", engineSessionId: "engine-1" });
    assert.deepEqual(f.output.finalizeAttempt(f.attemptId), { finalized: false, unresolvedInputIds: [f.deliveries[1]!] });
    assert.equal(f.db.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, f.turnId)).get()?.status, "running");
    await f.output.reply({ turnId: f.turnId, attemptId: f.attemptId, idempotencyKey: "reply:second", body: "Handled the second.", handledInputIds: [f.deliveries[1]!] });
    assert.equal(f.db.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, f.turnId)).get()?.status, "completed");
    assert.equal(f.db.select().from(schema.channelAgentMembers).where(and(
      eq(schema.channelAgentMembers.channelId, f.channelId),
      eq(schema.channelAgentMembers.agentId, f.agentId),
    )).get()?.lastReadSeq, 4);
  } finally {
    closeSpaceDb(f.spaceId);
    unregisterSpace(f.spaceId);
  }
});

test("reply atomically binds owned temporary attachments and publishes them", async () => {
  const f = await fixture();
  try {
    const attachment = f.db.insert(schema.attachments).values({
      spaceId: f.spaceId,
      channelId: f.channelId,
      uploaderType: "agent",
      uploaderId: f.agentId,
      filename: "result.txt",
      mimeType: "text/plain",
      sizeBytes: 6,
      storageKey: "fixture/result.txt",
      uploadState: "temporary",
      sourceTurnId: f.turnId,
      sourceActivationId: "activation",
      expiresAt: new Date(Date.now() + 60_000),
    }).returning().get();
    const message = await f.output.reply({
      turnId: f.turnId,
      attemptId: f.attemptId,
      idempotencyKey: "reply:attachment",
      body: "",
      attachmentIds: [attachment.id],
      attachmentActivationId: "activation",
      handledInputIds: [f.deliveries[0]!],
    });
    assert.equal(message.content, "");
    assert.equal(f.db.select().from(schema.attachments).where(eq(schema.attachments.id, attachment.id)).get()?.messageId, message.id);
    const published = f.events.find((event): event is { type: string; message: { attachments: Array<{ id: string }> } } =>
      typeof event === "object" && event !== null && (event as { type?: unknown }).type === "message");
    assert.deepEqual(published?.message.attachments.map((item) => item.id), [attachment.id]);
  } finally {
    closeSpaceDb(f.spaceId);
    unregisterSpace(f.spaceId);
  }
});

test("reply rolls back the message when an attachment is foreign or already bound", async () => {
  const f = await fixture();
  try {
    const foreign = f.db.insert(schema.attachments).values({
      spaceId: f.spaceId,
      channelId: f.channelId,
      uploaderType: "agent",
      uploaderId: randomUUID(),
      filename: "foreign.txt",
      mimeType: "text/plain",
      sizeBytes: 7,
      storageKey: "fixture/foreign.txt",
      uploadState: "temporary",
      sourceTurnId: f.turnId,
      sourceActivationId: "activation",
      expiresAt: new Date(Date.now() + 60_000),
    }).returning().get();
    await assert.rejects(() => f.output.reply({
      turnId: f.turnId,
      attemptId: f.attemptId,
      idempotencyKey: "reply:foreign-attachment",
      body: "must roll back",
      attachmentIds: [foreign.id],
      attachmentActivationId: "activation",
      handledInputIds: [f.deliveries[0]!],
    }), /attachments are unavailable/);
    assert.equal(f.db.select().from(schema.messages).where(eq(schema.messages.producedByTurnId, f.turnId)).all().length, 0);
    assert.equal(f.db.select().from(schema.turnOperations).where(eq(schema.turnOperations.idempotencyKey, "reply:foreign-attachment")).get(), undefined);
    assert.equal(f.db.select().from(schema.attachments).where(eq(schema.attachments.id, foreign.id)).get()?.messageId, null);
  } finally {
    closeSpaceDb(f.spaceId);
    unregisterSpace(f.spaceId);
  }
});

test("v2 top-level mention dispatches a legacy peer once without creating a v2 delivery", async () => {
  const f = await fixture();
  try {
    const legacyId = randomUUID();
    f.db.insert(schema.agents).values({
      id: legacyId,
      spaceId: f.spaceId,
      name: "legacy-peer",
      displayName: "Legacy Peer",
      status: "active",
      defaultResponseMode: "mention_only",
    }).run();
    f.db.insert(schema.channelAgentMembers).values({ channelId: f.channelId, agentId: legacyId, lastReadSeq: 0 }).run();
    const message = await f.output.reply({
      turnId: f.turnId,
      attemptId: f.attemptId,
      idempotencyKey: "reply:legacy-peer",
      body: "@legacy-peer please continue.",
      handledInputIds: [f.deliveries[0]!],
    });
    assert.ok(message.threadId);
    assert.equal(f.db.select().from(schema.agentDeliveryItems).where(and(
      eq(schema.agentDeliveryItems.messageId, message.id),
      eq(schema.agentDeliveryItems.agentId, legacyId),
    )).get(), undefined);
    assert.deepEqual(f.legacyDispatches, [{
      spaceId: f.spaceId,
      messageId: message.id,
      targetSurfaceId: message.threadId,
      targetAgentIds: [legacyId],
    }]);
    assert.deepEqual(f.legacyReservationCounts, [1], "the legacy dispatch intent commits atomically before post-commit dispatch");
    const retried = await f.output.reply({
      turnId: f.turnId,
      attemptId: f.attemptId,
      idempotencyKey: "reply:legacy-peer",
      body: "@legacy-peer please continue.",
      handledInputIds: [f.deliveries[0]!],
    });
    assert.equal(retried.id, message.id);
    assert.equal(f.legacyDispatches.length, 1, "an idempotent output retry does not dispatch legacy work twice");
    assert.deepEqual(f.legacyRecoveries, [f.spaceId], "an idempotent retry invokes durable legacy recovery");
  } finally {
    closeSpaceDb(f.spaceId);
    unregisterSpace(f.spaceId);
  }
});

test("silent legacy mention does not reserve or charge a dispatch wake", async () => {
  const f = await fixture();
  try {
    const legacyId = randomUUID();
    f.db.insert(schema.agents).values({
      id: legacyId,
      spaceId: f.spaceId,
      name: "silent-peer",
      displayName: "Silent Peer",
      status: "active",
      defaultResponseMode: "silent",
    }).run();
    f.db.insert(schema.channelAgentMembers).values({ channelId: f.channelId, agentId: legacyId, lastReadSeq: 0 }).run();
    const message = await f.output.reply({
      turnId: f.turnId,
      attemptId: f.attemptId,
      idempotencyKey: "reply:silent-peer",
      body: "@silent-peer do not wake.",
      handledInputIds: [f.deliveries[0]!],
    });
    assert.equal(f.db.select().from(schema.dispatchWakes).where(eq(schema.dispatchWakes.messageId, message.id)).all().length, 0);
    assert.equal(f.db.select().from(schema.dispatchChains).where(eq(schema.dispatchChains.id, message.dispatchChainId!)).get()?.wakeCount, 0);
    assert.deepEqual(f.legacyDispatches, []);
  } finally {
    closeSpaceDb(f.spaceId);
    unregisterSpace(f.spaceId);
  }
});

test("legacy mention behind the surface watermark does not reserve or charge a dispatch wake", async () => {
  const f = await fixture();
  try {
    const root = f.db.select().from(schema.messages).where(eq(schema.messages.channelId, f.channelId)).get()!;
    const threadId = randomUUID();
    f.db.update(schema.messages).set({ threadId }).where(eq(schema.messages.id, root.id)).run();
    f.db.insert(schema.channels).values({ id: threadId, spaceId: f.spaceId, name: "historical", type: "thread", parentMessageId: root.id }).run();
    f.db.insert(schema.channelAgentMembers).values({ channelId: threadId, agentId: f.agentId, lastReadSeq: 0 }).run();
    f.db.update(schema.runtimeSessions).set({ surfaceKind: "thread", surfaceId: threadId }).where(eq(schema.runtimeSessions.id, f.sessionId)).run();
    f.db.update(schema.agentDeliveryItems).set({ targetSurfaceKind: "thread", targetSurfaceId: threadId })
      .where(eq(schema.agentDeliveryItems.turnId, f.turnId)).run();
    const legacyId = randomUUID();
    f.db.insert(schema.agents).values({
      id: legacyId,
      spaceId: f.spaceId,
      name: "historical-peer",
      displayName: "Historical Peer",
      status: "active",
      defaultResponseMode: "mention_only",
    }).run();
    f.db.insert(schema.channelAgentMembers).values([
      { channelId: f.channelId, agentId: legacyId, lastReadSeq: 0 },
      { channelId: threadId, agentId: legacyId, lastReadSeq: 0, mentionWakeAfterSeq: 999 },
    ]).run();
    const message = await f.output.reply({
      turnId: f.turnId,
      attemptId: f.attemptId,
      idempotencyKey: "reply:historical-peer",
      body: "@historical-peer this is behind your wake boundary.",
      handledInputIds: [f.deliveries[0]!],
    });
    assert.equal(f.db.select().from(schema.dispatchWakes).where(eq(schema.dispatchWakes.messageId, message.id)).all().length, 0);
    assert.equal(f.db.select().from(schema.dispatchChains).where(eq(schema.dispatchChains.id, message.dispatchChainId!)).get()?.wakeCount, 0);
    assert.deepEqual(f.legacyDispatches, []);
  } finally {
    closeSpaceDb(f.spaceId);
    unregisterSpace(f.spaceId);
  }
});

test("expired task-scoped membership cannot be mentioned or reserve a legacy wake", async () => {
  const f = await fixture();
  try {
    const root = f.db.select().from(schema.messages).where(eq(schema.messages.channelId, f.channelId)).get()!;
    const threadId = randomUUID();
    f.db.update(schema.messages).set({ threadId }).where(eq(schema.messages.id, root.id)).run();
    f.db.insert(schema.channels).values({ id: threadId, spaceId: f.spaceId, name: "expired-task", type: "thread", parentMessageId: root.id }).run();
    f.db.insert(schema.channelAgentMembers).values({ channelId: threadId, agentId: f.agentId, lastReadSeq: 0 }).run();
    f.db.update(schema.runtimeSessions).set({ surfaceKind: "thread", surfaceId: threadId }).where(eq(schema.runtimeSessions.id, f.sessionId)).run();
    f.db.update(schema.agentDeliveryItems).set({ targetSurfaceKind: "thread", targetSurfaceId: threadId })
      .where(eq(schema.agentDeliveryItems.turnId, f.turnId)).run();
    const legacyId = randomUUID();
    f.db.insert(schema.agents).values({
      id: legacyId,
      spaceId: f.spaceId,
      name: "expired-peer",
      displayName: "Expired Peer",
      status: "active",
      defaultResponseMode: "mention_only",
    }).run();
    f.db.insert(schema.channelAgentMembers).values({
      channelId: threadId,
      agentId: legacyId,
      lastReadSeq: 0,
      accessKind: "task_scoped",
      taskScope: { taskId: root.id },
      accessExpiresAt: new Date(Date.now() - 1),
    }).run();
    const message = await f.output.reply({
      turnId: f.turnId,
      attemptId: f.attemptId,
      idempotencyKey: "reply:expired-peer",
      body: "@expired-peer cannot be revived.",
      handledInputIds: [f.deliveries[0]!],
    });
    assert.equal(f.db.select().from(schema.messageMentions).where(eq(schema.messageMentions.messageId, message.id)).get(), undefined);
    assert.equal(f.db.select().from(schema.dispatchWakes).where(eq(schema.dispatchWakes.messageId, message.id)).get(), undefined);
    assert.equal(f.db.select().from(schema.dispatchChains).where(eq(schema.dispatchChains.id, message.dispatchChainId!)).get()?.wakeCount, 0);
    assert.deepEqual(f.legacyDispatches, []);
  } finally {
    closeSpaceDb(f.spaceId);
    unregisterSpace(f.spaceId);
  }
});

test("reply operation retry returns one durable message and one sequence", async () => {
  const f = await fixture();
  try {
    assert.throws(() => f.output.cede({
      turnId: f.turnId,
      attemptId: f.attemptId,
      idempotencyKey: "cede:required",
      inputIds: [f.deliveries[0]!],
      reason: "skip",
    }), /required or observe inputs cannot be ceded/);
    const input = { turnId: f.turnId, attemptId: f.attemptId, idempotencyKey: "reply:all", body: "Handled both.", handledInputIds: f.deliveries };
    const first = await f.output.reply(input);
    const second = await f.output.reply(input);
    assert.equal(second.id, first.id);
    assert.equal(f.db.select().from(schema.messages).all().filter((message) => message.senderType === "agent").length, 1);
    assert.equal(f.db.select().from(schema.turnOperations).where(eq(schema.turnOperations.turnId, f.turnId)).all().length, 1);
  } finally {
    closeSpaceDb(f.spaceId);
    unregisterSpace(f.spaceId);
  }
});

test("server-owned reply persists member mentions and inherits one dispatch chain and depth", async () => {
  const f = await fixture();
  try {
    const peerId = randomUUID();
    f.db.insert(schema.agents).values({ id: peerId, spaceId: f.spaceId, name: "peer", displayName: "Peer", status: "active" }).run();
    f.db.insert(schema.channelAgentMembers).values({ channelId: f.channelId, agentId: peerId, lastReadSeq: 0 }).run();
    f.db.insert(schema.agentHarnessState).values({ agentId: peerId, mode: "v2" }).run();
    const source = f.db.select().from(schema.agentDeliveryItems).where(eq(schema.agentDeliveryItems.id, f.deliveries[0]!)).get()!;
    const message = await f.output.reply({
      turnId: f.turnId,
      attemptId: f.attemptId,
      idempotencyKey: "reply:peer",
      body: "@peer please continue.",
      handledInputIds: [f.deliveries[0]!],
    });
    assert.equal(message.dispatchChainId, source.messageId);
    assert.equal(message.dispatchDepth, 1);
    assert.ok(message.threadId);
    assert.equal(f.db.select().from(schema.channels).where(eq(schema.channels.id, message.threadId!)).get()?.parentMessageId, message.id);
    assert.equal(f.db.select().from(schema.messageMentions).where(eq(schema.messageMentions.messageId, message.id)).get()?.mentionId, peerId);
    const peerDelivery = f.db.select().from(schema.agentDeliveryItems).where(and(
      eq(schema.agentDeliveryItems.messageId, message.id),
      eq(schema.agentDeliveryItems.agentId, peerId),
    )).get();
    assert.equal(peerDelivery?.directive, "required");
    assert.equal(peerDelivery?.disposition, "pending");
    assert.equal(peerDelivery?.targetSurfaceKind, "thread");
    assert.equal(peerDelivery?.targetSurfaceId, message.threadId);
    assert.equal(f.db.select().from(schema.channelAgentMembers).where(and(
      eq(schema.channelAgentMembers.channelId, message.threadId!),
      eq(schema.channelAgentMembers.agentId, peerId),
    )).get()?.agentId, peerId);
    assert.deepEqual((f.events[0] as any).message.mentions, [{ type: "agent", id: peerId, name: "peer" }]);
  } finally {
    closeSpaceDb(f.spaceId);
    unregisterSpace(f.spaceId);
  }
});

test("thread reply can join and wake only an Agent who already belongs to the parent", async () => {
  const f = await fixture();
  try {
    const root = f.db.select().from(schema.messages).where(eq(schema.messages.channelId, f.channelId)).get()!;
    const threadId = randomUUID();
    f.db.update(schema.messages).set({ threadId }).where(eq(schema.messages.id, root.id)).run();
    f.db.insert(schema.channels).values({ id: threadId, spaceId: f.spaceId, name: "delegation", type: "thread", parentMessageId: root.id }).run();
    f.db.insert(schema.channelAgentMembers).values({ channelId: threadId, agentId: f.agentId, lastReadSeq: 0 }).run();
    f.db.update(schema.runtimeSessions).set({ surfaceKind: "thread", surfaceId: threadId }).where(eq(schema.runtimeSessions.id, f.sessionId)).run();
    f.db.update(schema.agentDeliveryItems).set({ targetSurfaceKind: "thread", targetSurfaceId: threadId })
      .where(eq(schema.agentDeliveryItems.turnId, f.turnId)).run();
    const peerId = randomUUID();
    const outsiderId = randomUUID();
    f.db.insert(schema.agents).values([
      { id: peerId, spaceId: f.spaceId, name: "thread-peer", displayName: "Thread Peer", status: "active" },
      { id: outsiderId, spaceId: f.spaceId, name: "outsider", displayName: "Outsider", status: "active" },
    ]).run();
    f.db.insert(schema.channelAgentMembers).values({ channelId: f.channelId, agentId: peerId, lastReadSeq: 0 }).run();
    f.db.insert(schema.agentHarnessState).values({ agentId: outsiderId, mode: "v2" }).run();
    const message = await f.output.reply({
      turnId: f.turnId,
      attemptId: f.attemptId,
      idempotencyKey: "reply:thread-peer",
      body: "@thread-peer please continue; @outsider cannot join.",
      handledInputIds: [f.deliveries[0]!],
    });
    assert.equal(message.channelId, threadId);
    assert.equal(message.threadId, null);
    assert.equal(f.db.select().from(schema.channelAgentMembers).where(and(
      eq(schema.channelAgentMembers.channelId, threadId),
      eq(schema.channelAgentMembers.agentId, peerId),
    )).get()?.agentId, peerId);
    assert.equal(f.db.select().from(schema.channelAgentMembers).where(and(
      eq(schema.channelAgentMembers.channelId, threadId),
      eq(schema.channelAgentMembers.agentId, outsiderId),
    )).get(), undefined);
    assert.deepEqual(f.db.select().from(schema.messageMentions).where(eq(schema.messageMentions.messageId, message.id)).all().map((row) => row.mentionId), [peerId]);
    assert.equal(f.db.select().from(schema.agentDeliveryItems).where(and(
      eq(schema.agentDeliveryItems.messageId, message.id),
      eq(schema.agentDeliveryItems.agentId, peerId),
    )).get(), undefined);
    assert.deepEqual(f.legacyDispatches, [{
      spaceId: f.spaceId,
      messageId: message.id,
      targetSurfaceId: threadId,
      targetAgentIds: [peerId],
    }]);
  } finally {
    closeSpaceDb(f.spaceId);
    unregisterSpace(f.spaceId);
  }
});

test("reply cannot mention another Agent while combining unrelated dispatch chains", async () => {
  const f = await fixture();
  try {
    const peerId = randomUUID();
    f.db.insert(schema.agents).values({ id: peerId, spaceId: f.spaceId, name: "peer", displayName: "Peer", status: "active" }).run();
    f.db.insert(schema.channelAgentMembers).values({ channelId: f.channelId, agentId: peerId, lastReadSeq: 0 }).run();
    f.db.insert(schema.agentHarnessState).values({ agentId: peerId, mode: "v2" }).run();
    await assert.rejects(() => f.output.reply({
      turnId: f.turnId,
      attemptId: f.attemptId,
      idempotencyKey: "reply:ambiguous",
      body: "@peer these came from two chains.",
      handledInputIds: f.deliveries,
    }), /one dispatch chain/);
    assert.equal(f.db.select().from(schema.messages).all().filter((message) => message.senderType === "agent").length, 0);
  } finally {
    closeSpaceDb(f.spaceId);
    unregisterSpace(f.spaceId);
  }
});

test("expired terminals and oversized event streams fail closed", async () => {
  const f = await fixture();
  try {
    const ledger = new TurnLedger(f.spaceId, f.db, () => Date.now() + 120_000);
    assert.throws(() => ledger.markRuntimeTerminal(f.attemptId, { outcome: "completed", engineSessionId: null }), /no live attempt lease/);
    assert.throws(() => ledger.appendEvent({
      schemaVersion: 2,
      workerGeneration: 2,
      sessionId: f.sessionId,
      sessionGeneration: 1,
      turnId: f.turnId,
      attemptId: f.attemptId,
      eventId: "too-many",
      ordinal: 2_000,
      kind: "activity",
      payload: {},
      createdAt: Date.now(),
    }), /event count exceeds/);
    assert.throws(() => new TurnLedger(f.spaceId, f.db).appendEvent({
      schemaVersion: 2,
      workerGeneration: 2,
      sessionId: f.sessionId,
      sessionGeneration: 1,
      turnId: f.turnId,
      attemptId: f.attemptId,
      eventId: "too-large",
      ordinal: 0,
      kind: "activity",
      payload: { text: "x".repeat(70_000) },
      createdAt: Date.now(),
    }), /payload exceeds/);
    f.db.update(schema.agentTurnAttempts).set({ eventPayloadBytes: MAX_TURN_EVENT_AGGREGATE_BYTES })
      .where(eq(schema.agentTurnAttempts.id, f.attemptId)).run();
    assert.throws(() => new TurnLedger(f.spaceId, f.db).appendEvent({
      schemaVersion: 2,
      workerGeneration: 2,
      sessionId: f.sessionId,
      sessionGeneration: 1,
      turnId: f.turnId,
      attemptId: f.attemptId,
      eventId: "aggregate-full",
      ordinal: 0,
      kind: "activity",
      payload: { text: "small" },
      createdAt: Date.now(),
    }), /aggregate limit/);
  } finally {
    closeSpaceDb(f.spaceId);
    unregisterSpace(f.spaceId);
  }
});

test("explicit cancellation terminates the attempt and requeues only unsettled inputs", async () => {
  const f = await fixture();
  try {
    new TurnLedger(f.spaceId, f.db).cancelAttempt(f.attemptId, "agent_stopped", true);
    assert.equal(f.db.select().from(schema.agentTurnAttempts).where(eq(schema.agentTurnAttempts.id, f.attemptId)).get()?.status, "cancelled");
    assert.equal(f.db.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, f.turnId)).get()?.status, "cancelled");
    assert.deepEqual(f.db.select().from(schema.agentDeliveryItems).where(eq(schema.agentDeliveryItems.disposition, "pending")).all().map((row) => row.id).sort(), [...f.deliveries].sort());
  } finally {
    closeSpaceDb(f.spaceId);
    unregisterSpace(f.spaceId);
  }
});

test("reply stays stale until an audited context refresh advances the output-surface watermark", async () => {
  const f = await fixture();
  try {
    f.db.update(schema.agentTurns).set({
      contextEnvelope: {
        schemaVersion: 1,
        turnId: f.turnId,
        session: { spaceId: f.spaceId, agentId: f.agentId, surfaceKind: "channel", surfaceId: f.channelId },
        responseDirective: "required",
        deliveryItemIds: f.deliveries,
        seenWatermarks: [{ channelId: f.channelId, throughSeq: 2 }],
        continuityMode: "cold",
        currentBatch: f.deliveries.map((id, index) => ({
          sourceKind: "message", sourceId: id, sourceRevision: index + 1, snapshotId: null,
          contentHmac: "hash", visibility: "public", disclosureProjection: "canonical", injectionMode: "content",
          estimatedTokens: 1, reason: "delivery",
        })),
        recentSurface: [], objectSnapshots: [], recalledMemories: [], fileMemoryRefs: [],
        capabilityActivationId: "activation", budget: { available: 8000, used: 2, estimator: "test" }, omissions: [], assembledAt: 1,
      },
    }).where(eq(schema.agentTurns.id, f.turnId)).run();
    const laterSeq = await nextSeq(f.spaceId);
    f.db.insert(schema.messages).values({ id: randomUUID(), seq: laterSeq, spaceId: f.spaceId, channelId: f.channelId, senderType: "human", senderId: "human", senderName: "Human", content: "new information" }).run();
    await assert.rejects(() => f.output.reply({
      turnId: f.turnId,
      attemptId: f.attemptId,
      idempotencyKey: "reply:stale",
      body: "Outdated answer",
      handledInputIds: f.deliveries,
    }), (error: any) => error?.code === "stale_context" && error?.details?.laterSeq === laterSeq);
    assert.equal(f.db.select().from(schema.messages).all().filter((message) => message.senderType === "agent").length, 0);
    f.db.insert(schema.turnContextSources).values({
      turnId: f.turnId, phase: "later_query", ordinal: 0, sourceKind: "surface_watermark", sourceId: f.channelId,
      sourceRevision: laterSeq, visibility: "public", disclosureProjection: "ref_only", injectionMode: "reference",
      reason: "context_refresh_watermark", tokenEstimate: 0, contentHmac: "refresh-hash",
    }).run();
    const refreshed = await f.output.reply({
      turnId: f.turnId,
      attemptId: f.attemptId,
      idempotencyKey: "reply:refreshed",
      body: "Revised answer",
      handledInputIds: f.deliveries,
    });
    assert.equal(refreshed.content, "Revised answer");
  } finally {
    closeSpaceDb(f.spaceId);
    unregisterSpace(f.spaceId);
  }
});
