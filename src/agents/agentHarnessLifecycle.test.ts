import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { kithSpaceHome } from "../paths.js";
import { SessionModule } from "../sessions/sessionModule.js";
import { initializeNewV2Agent, migrateExistingAgentToV2 } from "./agentHarnessLifecycle.js";

test("new supported Agent starts directly in v2 with one required Human-DM introduction delivery", async () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  registerSpace({ id: spaceId, name: "New harness", slug: `new-harness-${spaceId}`, rootPath: path.join(kithSpaceHome(), "new-harness", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "new-agent", displayName: "New Agent", runtime: "claude" }).run();
    const introduction = await initializeNewV2Agent(spaceId, agentId, { humanId: "test-human" });
    assert.equal(introduction.channel.type, "dm");
    assert.equal(new SessionModule(spaceId, db).harnessMode(agentId), "v2");
    const delivery = db.select().from(schema.agentDeliveryItems).where(eq(schema.agentDeliveryItems.agentId, agentId)).get();
    assert.equal(delivery?.messageId, introduction.message.id);
    assert.equal(delivery?.targetSurfaceId, introduction.channel.id);
    assert.equal(delivery?.directive, "required");
    assert.equal(delivery?.reason, "agent_creation_introduction");
    assert.equal(db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).get()?.introducedAt, null);
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});

test("existing Agent cutover backfills only messages after each membership cursor and can resume migrating", () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  registerSpace({ id: spaceId, name: "Cutover", slug: `cutover-${spaceId}`, rootPath: path.join(kithSpaceHome(), "cutover", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "legacy-agent", displayName: "Legacy Agent", runtime: "claude" }).run();
    db.insert(schema.channels).values({ id: channelId, spaceId, name: "cutover", type: "channel" }).run();
    db.insert(schema.channelAgentMembers).values({ channelId, agentId, lastReadSeq: 1 }).run();
    db.insert(schema.messages).values([
      { id: randomUUID(), seq: 1, spaceId, channelId, senderType: "human", senderId: "human", senderName: "Human", content: "already read" },
      { id: randomUUID(), seq: 2, spaceId, channelId, senderType: "human", senderId: "human", senderName: "Human", content: "unread" },
    ]).run();
    new SessionModule(spaceId, db).beginCutover(agentId, { legacyDrained: true, reason: "simulated interrupted cutover" });
    assert.equal(migrateExistingAgentToV2(spaceId, agentId, "resume"), 1);
    assert.equal(db.select().from(schema.agentDeliveryItems).all().length, 1);
    assert.equal(new SessionModule(spaceId, db).harnessMode(agentId), "v2");
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});
