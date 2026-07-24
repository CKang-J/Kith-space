import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../src/db/index.ts";
import { kithSpaceHome } from "../src/paths.ts";
import { createMessage } from "../src/server/core.ts";

test("new Human messages explicitly persist eligible/exclude while Agent output remains exclude", async () => {
  const spaceId = randomUUID();
  registerSpace({ id: spaceId, name: "Memory policy", slug: `memory-policy-${spaceId}`,
    rootPath: path.join(kithSpaceHome(), "memory-policy", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    const channel = db.insert(schema.channels).values({ spaceId, name: "policy", type: "channel" }).returning().get();
    const defaultHuman = await createMessage({
      spaceId, channelId: channel.id, senderType: "human", senderId: "human", senderName: "Human", content: "default",
    });
    const excludedHuman = await createMessage({
      spaceId, channelId: channel.id, senderType: "human", senderId: "human", senderName: "Human",
      content: "private for this turn", memoryPolicy: "exclude",
    });
    const agent = await createMessage({
      spaceId, channelId: channel.id, senderType: "agent", senderId: "agent", senderName: "Agent",
      content: "derived", memoryPolicy: "eligible",
    });
    assert.equal(defaultHuman.memoryPolicy, "eligible");
    assert.equal(excludedHuman.memoryPolicy, "exclude");
    assert.equal(agent.memoryPolicy, "exclude");
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});
