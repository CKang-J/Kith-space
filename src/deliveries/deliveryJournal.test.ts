import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { kithSpaceHome } from "../paths.js";
import { DeliveryJournal } from "./deliveryJournal.js";

test("message and v2 delivery rollback atomically", () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  const messageId = randomUUID();
  registerSpace({ id: spaceId, name: "Delivery", slug: `delivery-${spaceId}`, rootPath: path.join(kithSpaceHome(), "delivery", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "delivery-agent", displayName: "Delivery Agent", status: "active" }).run();
    db.insert(schema.channels).values({ id: channelId, spaceId, name: "delivery", type: "channel" }).run();
    db.insert(schema.channelAgentMembers).values({ channelId, agentId, lastReadSeq: 0 }).run();
    db.insert(schema.agentHarnessState).values({ agentId, mode: "v2" }).run();
    const journal = new DeliveryJournal();
    assert.throws(() => db.transaction((tx) => {
      const message = tx.insert(schema.messages).values({ id: messageId, seq: 1, spaceId, channelId, senderType: "human", senderId: "human", senderName: "Human", content: "@delivery-agent hello" }).returning().get();
      journal.persistMessageInTransaction(tx, {
        spaceId,
        channel: tx.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get()!,
        message,
        senderType: "human",
        senderId: "human",
        candidateAgentIds: [agentId],
        mentions: [{ type: "agent", id: agentId, name: "delivery-agent" }],
      });
      throw new Error("kill after delivery insert");
    }), /kill after delivery insert/);
    assert.equal(db.select().from(schema.messages).where(eq(schema.messages.id, messageId)).get(), undefined);
    assert.equal(db.select().from(schema.agentDeliveryItems).all().length, 0);
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});

test("pure observe is terminal without starting a turn and advances only the contiguous source frontier", () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  registerSpace({ id: spaceId, name: "Observe", slug: `observe-${spaceId}`, rootPath: path.join(kithSpaceHome(), "observe", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "observe-agent", displayName: "Observe Agent", status: "active" }).run();
    const channel = db.insert(schema.channels).values({ id: channelId, spaceId, name: "observe", type: "channel" }).returning().get();
    db.insert(schema.channelAgentMembers).values({ channelId, agentId, lastReadSeq: 0 }).run();
    db.insert(schema.agentHarnessState).values({ agentId, mode: "v2" }).run();
    const journal = new DeliveryJournal();
    db.transaction((tx) => {
      const message = tx.insert(schema.messages).values({ id: randomUUID(), seq: 1, spaceId, channelId, senderType: "agent", senderId: agentId, senderName: "Observe Agent", content: "self output" }).returning().get();
      journal.persistMessageInTransaction(tx, { spaceId, channel, message, senderType: "agent", senderId: agentId, candidateAgentIds: [agentId], mentions: [] });
    });
    assert.equal(db.select().from(schema.agentDeliveryItems).all()[0]?.disposition, "observed");
    assert.equal(db.select().from(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.agentId, agentId)).get()?.lastReadSeq, 1);
    assert.equal(db.select().from(schema.agentTurns).all().length, 0);
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});

test("a task assignee wake can coexist with terminal observe rows for other v2 members", () => {
  const spaceId = randomUUID();
  const assigneeId = randomUUID();
  const observerId = randomUUID();
  const channelId = randomUUID();
  registerSpace({ id: spaceId, name: "Task delivery", slug: `task-delivery-${spaceId}`, rootPath: path.join(kithSpaceHome(), "task-delivery", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values([
      { id: assigneeId, spaceId, name: "assignee", displayName: "Assignee", status: "active" },
      { id: observerId, spaceId, name: "observer", displayName: "Observer", status: "active" },
    ]).run();
    const channel = db.insert(schema.channels).values({ id: channelId, spaceId, name: "tasks", type: "channel" }).returning().get();
    db.insert(schema.channelAgentMembers).values([
      { channelId, agentId: assigneeId, lastReadSeq: 0 },
      { channelId, agentId: observerId, lastReadSeq: 0 },
    ]).run();
    db.insert(schema.agentHarnessState).values([{ agentId: assigneeId, mode: "v2" }, { agentId: observerId, mode: "v2" }]).run();
    const journal = new DeliveryJournal();
    db.transaction((tx) => {
      const message = tx.insert(schema.messages).values({
        id: randomUUID(), seq: 1, spaceId, channelId, senderType: "human", senderId: "human", senderName: "Human",
        content: "assigned task", taskStatus: "open", taskAssigneeType: "agent", taskAssigneeId: assigneeId,
      }).returning().get();
      journal.persistMessageInTransaction(tx, {
        spaceId, channel, message, senderType: "human", senderId: "human", candidateAgentIds: [assigneeId], mentions: [], explicitTaskAgentId: assigneeId,
      });
      journal.persistMessageInTransaction(tx, {
        spaceId, channel, message, senderType: "human", senderId: "human", candidateAgentIds: [observerId], mentions: [], forceObserveAgentIds: [observerId],
      });
    });
    const rows = db.select().from(schema.agentDeliveryItems).all();
    assert.equal(rows.find((row) => row.agentId === assigneeId)?.directive, "required");
    assert.equal(rows.find((row) => row.agentId === observerId)?.disposition, "observed");
    assert.equal(db.select().from(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.agentId, observerId)).get()?.lastReadSeq, 1);
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});
