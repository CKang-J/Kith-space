import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { kithSpaceHome } from "../paths.js";
import { SqliteDispatchState } from "./dispatchGuard.js";
import { turnDispatchAdapter } from "./turnDispatchAdapter.js";

function fixture() {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  const messageId = randomUUID();
  const deliveryId = randomUUID();
  registerSpace({ id: spaceId, name: "Turn dispatch", slug: `turn-dispatch-${spaceId}`, rootPath: path.join(kithSpaceHome(), "turn-dispatch", spaceId) });
  const db = dbForSpace(spaceId);
  db.insert(schema.agents).values({ id: agentId, spaceId, name: "dispatch-agent", displayName: "Dispatch Agent", status: "active" }).run();
  db.insert(schema.channels).values({ id: channelId, spaceId, name: "dispatch", type: "channel" }).run();
  db.insert(schema.channelAgentMembers).values({ channelId, agentId, lastReadSeq: 0 }).run();
  db.insert(schema.agentHarnessState).values({ agentId, mode: "v2" }).run();
  db.insert(schema.messages).values({ id: messageId, seq: 1, spaceId, channelId, senderType: "human", senderId: "human", senderName: "Human", content: "work" }).run();
  db.insert(schema.agentDeliveryItems).values({
    id: deliveryId,
    spaceId,
    agentId,
    messageId,
    sourceChannelId: channelId,
    sourceSeq: 1,
    cursorOwnerChannelId: channelId,
    targetSurfaceKind: "channel",
    targetSurfaceId: channelId,
    directive: "required",
    reason: "mention",
    policySnapshot: {},
    disposition: "pending",
  }).run();
  return { spaceId, agentId, channelId, messageId, deliveryId, db };
}

test("v2 dispatch reservation is stable per delivery and commits the existing wake budget", async () => {
  const f = fixture();
  try {
    await turnDispatchAdapter.preparePending(f.spaceId);
    await turnDispatchAdapter.preparePending(f.spaceId);
    const delivery = f.db.select().from(schema.agentDeliveryItems).where(eq(schema.agentDeliveryItems.id, f.deliveryId)).get()!;
    assert.ok(delivery.dispatchWakeId);
    assert.equal(f.db.select().from(schema.dispatchWakes).all().length, 1);
    assert.equal(f.db.select().from(schema.dispatchChains).where(eq(schema.dispatchChains.id, f.messageId)).get()?.wakeCount, 1);

    const sessionId = randomUUID();
    const turnId = randomUUID();
    f.db.insert(schema.runtimeSessions).values({ id: sessionId, spaceId: f.spaceId, agentId: f.agentId, surfaceKind: "channel", surfaceId: f.channelId, sessionGeneration: 1, runtime: "claude", runtimeConfigFingerprint: "config", adapterVersion: "test", workspaceRootFingerprint: "root" }).run();
    f.db.insert(schema.agentTurns).values({ id: turnId, runtimeSessionId: sessionId, sessionGeneration: 1, spaceId: f.spaceId, agentId: f.agentId, effectiveDirective: "required" }).run();
    f.db.update(schema.agentDeliveryItems).set({ disposition: "bound", turnId }).where(eq(schema.agentDeliveryItems.id, f.deliveryId)).run();
    await turnDispatchAdapter.commitTurn(f.spaceId, turnId);
    assert.equal(f.db.select().from(schema.dispatchWakes).where(eq(schema.dispatchWakes.id, delivery.dispatchWakeId!)).get()?.status, "success");
    assert.equal(f.db.select().from(schema.dispatchContexts).where(eq(schema.dispatchContexts.agentId, f.agentId)).get()?.channelId, f.channelId);
  } finally {
    closeSpaceDb(f.spaceId);
    unregisterSpace(f.spaceId);
  }
});

test("a durable delivery blocked by emergency stop settles without starting a turn", async () => {
  const f = fixture();
  try {
    await new SqliteDispatchState(f.spaceId).stopSpace("test stop");
    await turnDispatchAdapter.preparePending(f.spaceId);
    const delivery = f.db.select().from(schema.agentDeliveryItems).where(eq(schema.agentDeliveryItems.id, f.deliveryId)).get()!;
    assert.equal(delivery.disposition, "dispatch_blocked");
    assert.equal(delivery.reason, "dispatch_space_stopped");
    assert.equal(f.db.select().from(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.agentId, f.agentId)).get()?.lastReadSeq, 1);
    assert.equal(f.db.select().from(schema.agentTurns).all().length, 0);
  } finally {
    closeSpaceDb(f.spaceId);
    unregisterSpace(f.spaceId);
  }
});
