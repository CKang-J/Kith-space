import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeAllDatabases } from "../src/db/index.ts";
import { SqliteDispatchState } from "../src/server/dispatchGuard.ts";
import { integrationDatabase } from "./helpers/workspace.ts";

const { db, schema, spaceId } = integrationDatabase("p-a9-wake-reservation-idempotency");

try {
  const [channel] = await db.insert(schema.channels).values({ spaceId, name: "wake-idempotency", type: "channel" }).returning();
  const [message] = await db.insert(schema.messages).values({
    spaceId,
    channelId: channel!.id,
    seq: 1,
    senderType: "system",
    senderName: "system",
    content: "wake",
  }).returning();
  const targetAgentId = "target-agent";
  const state = new SqliteDispatchState(spaceId);
  await state.ensureChain({
    chainId: message!.id,
    rootMessageId: message!.id,
    channelId: channel!.id,
    dispatchDepth: 0,
    taskMessageId: null,
  });

  const [first, concurrentReplay] = await Promise.all([
    state.getOrReserveWake({ chainId: message!.id, dispatchDepth: 0, messageId: message!.id, targetAgentId }),
    state.getOrReserveWake({ chainId: message!.id, dispatchDepth: 0, messageId: message!.id, targetAgentId }),
  ]);
  assert.equal(first.allowed, true);
  assert.equal(concurrentReplay.allowed, true);
  if (!first.allowed || !concurrentReplay.allowed) throw new Error("reservation unexpectedly blocked");
  assert.equal(first.reservationId, concurrentReplay.reservationId);
  assert.equal((await state.spaceStatus()).wakeCount, 1);
  assert.equal((await db.select().from(schema.dispatchWakes).where(eq(schema.dispatchWakes.messageId, message!.id))).length, 1);

  await state.commitWake(first.reservationId, {
    agentId: targetAgentId,
    channelId: channel!.id,
    chainId: message!.id,
    dispatchDepth: 0,
  });
  const admittedUnreadReplay = await state.getOrReserveWake({
    chainId: message!.id,
    dispatchDepth: 0,
    messageId: message!.id,
    targetAgentId,
  });
  assert.equal(admittedUnreadReplay.allowed && admittedUnreadReplay.reservationId, first.reservationId);
  assert.equal((await state.spaceStatus()).wakeCount, 1, "unread replay does not consume a second wake budget");

  await state.releaseWake(first.reservationId);
  assert.equal((await state.spaceStatus()).wakeCount, 1, "an explicit rejection cannot release an already committed wake");

  await state.markWakePending(first.reservationId);
  await state.releaseWake(first.reservationId);
  assert.equal((await state.spaceStatus()).wakeCount, 0, "an expired acknowledged queue item can be reopened and released without leaking budget");
  assert.equal((await db.select().from(schema.dispatchWakes)).length, 0);
} finally {
  closeAllDatabases();
}
