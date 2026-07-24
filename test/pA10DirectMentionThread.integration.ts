import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { rmSync } from "node:fs";
import { closeAllDatabases, unregisterSpace } from "../src/db/index.ts";
import { DeliveryJournal } from "../src/deliveries/deliveryJournal.ts";
import { reserveDispatchWakeInTransaction } from "../src/dispatch/dispatchReservation.ts";
import {
  createConversationModules,
  type ConversationEventSink,
  type WakeDispatchPort,
} from "../src/messages/messagePostingModule.ts";
import { integrationDatabase } from "./helpers/workspace.ts";

const { db, schema, spaceId, rootPath, human } = integrationDatabase("p-a10-direct-mention-thread");
const sqlite = db.$client;

function modules(eventSink: ConversationEventSink = { async publish() {} }, wakeIds: string[] = []) {
  const recordDispatch = async (input: Parameters<WakeDispatchPort["dispatch"]>[0]) => {
    wakeIds.push(input.targetAgent.id);
    if (input.durableReservation) {
      db.update(schema.dispatchWakes).set({ status: "success" }).where(and(
        eq(schema.dispatchWakes.messageId, input.messageId),
        eq(schema.dispatchWakes.targetAgentId, input.targetAgent.id),
        eq(schema.dispatchWakes.status, "reserved"),
      )).run();
    }
    return { status: "sent" as const };
  };
  const wakeDispatch: WakeDispatchPort = {
    async resolveMessageContext(input) {
      return { chainId: input.messageId, dispatchDepth: 0, taskMessageId: input.taskMessageId };
    },
    async ensureChain() {},
    async prepareTargets() { return { dispatch: recordDispatch }; },
    dispatch: recordDispatch,
  };
  return createConversationModules({
    eventSink,
    wakeDispatch,
    introductionProof: { consume: () => true, complete() {}, restore() {} },
    deliveryJournal: new DeliveryJournal(),
  });
}

try {
  const channel = db.insert(schema.channels).values({ spaceId, name: "direct", type: "channel" }).returning().get();
  const awake = db.insert(schema.agents).values({ spaceId, name: "awake", displayName: "Awake", runtime: "claude", creatorId: human.id, status: "active", defaultResponseMode: "mention_only" }).returning().get();
  const silent = db.insert(schema.agents).values({ spaceId, name: "silent", displayName: "Silent", runtime: "claude", creatorId: human.id, status: "active", defaultResponseMode: "silent" }).returning().get();
  const observer = db.insert(schema.agents).values({ spaceId, name: "observer", displayName: "Observer", runtime: "claude", creatorId: human.id, status: "active", defaultResponseMode: "active" }).returning().get();
  for (const agent of [awake, silent, observer]) db.insert(schema.agentHarnessState).values({ agentId: agent.id, mode: "v2" }).run();
  db.insert(schema.channelAgentMembers).values({ channelId: channel.id, agentId: observer.id }).run();
  const context = {
    spaceId,
    channelId: channel.id,
    sender: { type: "human" as const, id: human.id, name: human.name },
  };

  const root = await modules().messagePosting.post({
    kind: "chat",
    context,
    content: "@awake @silent investigate this",
  });
  assert.equal(root.channelId, channel.id);
  assert.ok(root.threadId);
  const thread = db.select().from(schema.channels).where(eq(schema.channels.id, root.threadId!)).get();
  assert.equal(thread?.parentMessageId, root.id);
  assert.equal(thread?.type, "thread");
  assert.ok(db.select().from(schema.humanChannelStates).where(eq(schema.humanChannelStates.channelId, root.threadId!)).get()?.threadFollowedAt);
  const threadMembers = db.select().from(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.channelId, root.threadId!)).all();
  assert.deepEqual(new Set(threadMembers.map((member) => member.agentId)), new Set([awake.id, silent.id]));
  const parentMembers = db.select().from(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.channelId, channel.id)).all();
  assert.deepEqual(new Set(parentMembers.map((member) => member.agentId)), new Set([awake.id, silent.id, observer.id]));
  const deliveries = db.select().from(schema.agentDeliveryItems).where(eq(schema.agentDeliveryItems.messageId, root.id)).all();
  const byAgent = new Map(deliveries.map((delivery) => [delivery.agentId, delivery]));
  assert.equal(byAgent.get(awake.id)?.directive, "required");
  assert.equal(byAgent.get(awake.id)?.targetSurfaceId, root.threadId);
  assert.equal(byAgent.get(awake.id)?.cursorOwnerChannelId, channel.id);
  assert.equal(byAgent.get(silent.id)?.directive, "observe");
  assert.equal(byAgent.get(silent.id)?.targetSurfaceId, root.threadId);
  assert.equal(byAgent.get(observer.id)?.directive, "observe");
  assert.equal(byAgent.get(observer.id)?.targetSurfaceId, channel.id);
  assert.equal(byAgent.get(observer.id)?.reason, "direct_mention_not_targeted");

  const broadcast = await modules().messagePosting.post({ kind: "chat", context, content: "@all status" });
  assert.equal(broadcast.threadId, null, "@all remains a top-level broadcast");

  const v2TaskWakes: string[] = [];
  const v2Task = await modules({ async publish() {} }, v2TaskWakes).tasks.create({
    context,
    title: "@silent verify the v2 task path",
    executionMode: "autopilot",
  });
  assert.ok(v2Task.threadId);
  assert.deepEqual(v2TaskWakes, [], "a v2 task assignee is never double-consumed by the legacy wake path");
  const v2TaskDeliveries = db.select().from(schema.agentDeliveryItems)
    .where(eq(schema.agentDeliveryItems.messageId, v2Task.id)).all();
  assert.equal(v2TaskDeliveries.filter((delivery) => delivery.agentId === silent.id && delivery.directive === "required").length, 1);

  const legacy = db.insert(schema.agents).values({
    spaceId, name: "legacy-new", displayName: "Legacy New", runtime: "claude", creatorId: human.id,
    status: "active", defaultResponseMode: "mention_only",
  }).returning().get();
  const legacyWakes: string[] = [];
  const legacyRoot = await modules({ async publish() {} }, legacyWakes).messagePosting.post({
    kind: "chat", context, content: "@legacy-new join this",
  });
  assert.ok(legacyRoot.threadId);
  assert.equal(db.select().from(schema.channelAgentMembers).where(and(
    eq(schema.channelAgentMembers.channelId, channel.id),
    eq(schema.channelAgentMembers.agentId, legacy.id),
  )).get()?.agentId, legacy.id);
  assert.equal(db.select().from(schema.channelAgentMembers).where(and(
    eq(schema.channelAgentMembers.channelId, legacyRoot.threadId!),
    eq(schema.channelAgentMembers.agentId, legacy.id),
  )).get()?.agentId, legacy.id);
  assert.deepEqual(legacyWakes, [legacy.id], "a newly auto-joined legacy Agent is woken on the server-owned thread");

  const mixedOutputId = randomUUID();
  db.insert(schema.messages).values({
    id: mixedOutputId, seq: 10_000, spaceId, channelId: legacyRoot.threadId!, senderType: "agent",
    senderId: observer.id, senderName: observer.name, content: "@legacy-new mixed output", dispatchChainId: mixedOutputId,
    dispatchDepth: 0, producedByTurnId: "turn-crash",
  }).run();
  db.insert(schema.messageMentions).values({ messageId: mixedOutputId, mentionType: "agent", mentionId: legacy.id, mentionName: legacy.name }).run();
  db.insert(schema.dispatchChains).values({
    id: mixedOutputId, spaceId, rootMessageId: mixedOutputId, channelId: legacyRoot.threadId!, maxDepthSeen: 0,
  }).run();
  db.transaction((tx) => {
    const reservation = reserveDispatchWakeInTransaction(tx, {
      spaceId,
      chainId: mixedOutputId,
      dispatchDepth: 0,
      taskMessageId: null,
      messageId: mixedOutputId,
      targetAgentId: legacy.id,
    });
    assert.equal(reservation.allowed, true);
  });
  const mixedWakes: string[] = [];
  const mixedDispatched = await modules({ async publish() {} }, mixedWakes).legacyMentionDispatch.recover(spaceId);
  assert.equal(mixedDispatched, 1);
  assert.deepEqual(mixedWakes, [legacy.id], "mixed output dispatches only the legacy target; v2 remains durable-only");
  assert.equal(db.select().from(schema.dispatchWakes).where(and(
    eq(schema.dispatchWakes.messageId, mixedOutputId),
    eq(schema.dispatchWakes.targetAgentId, legacy.id),
  )).get()?.status, "success");

  const expiredOutputId = randomUUID();
  db.insert(schema.messages).values({
    id: expiredOutputId, seq: 10_001, spaceId, channelId: legacyRoot.threadId!, senderType: "agent",
    senderId: observer.id, senderName: observer.name, content: "@legacy-new expired output", dispatchChainId: expiredOutputId,
    dispatchDepth: 0, producedByTurnId: "turn-expired",
  }).run();
  db.insert(schema.messageMentions).values({ messageId: expiredOutputId, mentionType: "agent", mentionId: legacy.id, mentionName: legacy.name }).run();
  db.insert(schema.dispatchChains).values({
    id: expiredOutputId, spaceId, rootMessageId: expiredOutputId, channelId: legacyRoot.threadId!, maxDepthSeen: 0,
  }).run();
  db.transaction((tx) => {
    assert.equal(reserveDispatchWakeInTransaction(tx, {
      spaceId, chainId: expiredOutputId, dispatchDepth: 0, taskMessageId: null,
      messageId: expiredOutputId, targetAgentId: legacy.id,
    }).allowed, true);
  });
  db.update(schema.channelAgentMembers).set({
    accessKind: "task_scoped",
    taskScope: { taskId: legacyRoot.id },
    accessExpiresAt: new Date(Date.now() - 1),
  }).where(and(
    eq(schema.channelAgentMembers.channelId, legacyRoot.threadId!),
    eq(schema.channelAgentMembers.agentId, legacy.id),
  )).run();
  const expiredWakes: string[] = [];
  assert.equal(await modules({ async publish() {} }, expiredWakes).legacyMentionDispatch.recover(spaceId), 0);
  assert.deepEqual(expiredWakes, [], "expired task-scoped access cannot be recovered into a legacy wake");
  assert.equal(db.select().from(schema.dispatchWakes).where(eq(schema.dispatchWakes.messageId, expiredOutputId)).get(), undefined);
  assert.equal(db.select().from(schema.dispatchChains).where(eq(schema.dispatchChains.id, expiredOutputId)).get()?.wakeCount, 0);

  const revokedOutputId = randomUUID();
  db.update(schema.channelAgentMembers).set({ accessKind: "member", taskScope: null, accessExpiresAt: null }).where(and(
    eq(schema.channelAgentMembers.channelId, legacyRoot.threadId!),
    eq(schema.channelAgentMembers.agentId, legacy.id),
  )).run();
  db.insert(schema.messages).values({
    id: revokedOutputId, seq: 10_002, spaceId, channelId: legacyRoot.threadId!, senderType: "agent",
    senderId: observer.id, senderName: observer.name, content: "@legacy-new revoked output", dispatchChainId: revokedOutputId,
    dispatchDepth: 0, producedByTurnId: "turn-revoked",
  }).run();
  db.insert(schema.messageMentions).values({ messageId: revokedOutputId, mentionType: "agent", mentionId: legacy.id, mentionName: legacy.name }).run();
  db.insert(schema.dispatchChains).values({
    id: revokedOutputId, spaceId, rootMessageId: revokedOutputId, channelId: legacyRoot.threadId!, maxDepthSeen: 0,
  }).run();
  db.transaction((tx) => {
    assert.equal(reserveDispatchWakeInTransaction(tx, {
      spaceId, chainId: revokedOutputId, dispatchDepth: 0, taskMessageId: null,
      messageId: revokedOutputId, targetAgentId: legacy.id,
    }).allowed, true);
  });
  db.delete(schema.channelAgentMembers).where(and(
    eq(schema.channelAgentMembers.channelId, channel.id),
    eq(schema.channelAgentMembers.agentId, legacy.id),
  )).run();
  const revokedWakes: string[] = [];
  assert.equal(await modules({ async publish() {} }, revokedWakes).legacyMentionDispatch.recover(spaceId), 0);
  assert.deepEqual(revokedWakes, [], "ordinary thread recovery rechecks current parent access");
  assert.equal(db.select().from(schema.dispatchWakes).where(eq(schema.dispatchWakes.messageId, revokedOutputId)).get(), undefined);
  assert.equal(db.select().from(schema.dispatchChains).where(eq(schema.dispatchChains.id, revokedOutputId)).get()?.wakeCount, 0);

  const rollbackAgent = db.insert(schema.agents).values({ spaceId, name: "rollback", displayName: "Rollback", runtime: "claude", creatorId: human.id, status: "active" }).returning().get();
  db.insert(schema.agentHarnessState).values({ agentId: rollbackAgent.id, mode: "v2" }).run();
  sqlite.exec(`
    CREATE TRIGGER p_a10_fail_direct_delivery
    BEFORE INSERT ON agent_delivery_items
    WHEN NEW.agent_id = '${rollbackAgent.id}'
    BEGIN SELECT RAISE(ABORT, 'p-a10 direct delivery failure'); END;
  `);
  await assert.rejects(
    modules().messagePosting.post({ kind: "chat", context, content: "@rollback atomic" }),
    /p-a10 direct delivery failure/,
  );
  assert.equal(db.select().from(schema.messages).where(eq(schema.messages.content, "@rollback atomic")).get(), undefined);
  assert.equal(db.select().from(schema.channelAgentMembers).where(and(
    eq(schema.channelAgentMembers.channelId, channel.id),
    eq(schema.channelAgentMembers.agentId, rollbackAgent.id),
  )).get(), undefined);
  const orphanThreads = db.select().from(schema.channels).where(and(
    eq(schema.channels.type, "thread"),
    inArray(schema.channels.parentMessageId, db.select({ id: schema.messages.id }).from(schema.messages).where(eq(schema.messages.content, "@rollback atomic"))),
  )).all();
  assert.equal(orphanThreads.length, 0);
} finally {
  try { sqlite.exec("DROP TRIGGER IF EXISTS p_a10_fail_direct_delivery;"); } catch { /* already closed */ }
  closeAllDatabases();
  unregisterSpace(spaceId);
  rmSync(rootPath, { recursive: true, force: true });
}
