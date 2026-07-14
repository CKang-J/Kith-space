import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTrajectoryScope, type TrajectoryConversationLookup } from "./trajectoryScope.js";

function lookupFixture(): TrajectoryConversationLookup {
  const channels = new Map([
    ["channel-a", { id: "channel-a", type: "channel", parentMessageId: null }],
    ["thread-a", { id: "thread-a", type: "thread", parentMessageId: "message-a" }],
  ]);
  const messages = new Map([["message-a", "channel-a"]]);
  return {
    async channelById(id) { return channels.get(id) ?? null; },
    async messageChannelId(id) { return messages.get(id) ?? null; },
  };
}

test("direct channel trajectory resolves to the same base conversation", async () => {
  assert.deepEqual(await normalizeTrajectoryScope(
    { scope: "scoped", channelId: "channel-a", streamId: "stream-a" },
    lookupFixture(),
  ), {
    scope: "scoped",
    channelId: "channel-a",
    conversationId: "channel-a",
    streamId: "stream-a",
  });
});

test("thread trajectory keeps the target channel and resolves its parent conversation", async () => {
  assert.deepEqual(await normalizeTrajectoryScope(
    { scope: "scoped", channelId: "thread-a", streamId: "stream-a" },
    lookupFixture(),
  ), {
    scope: "scoped",
    channelId: "thread-a",
    conversationId: "channel-a",
    streamId: "stream-a",
  });
});

test("unscoped and ambiguous events never gain a conversation", async () => {
  assert.deepEqual(await normalizeTrajectoryScope({ scope: "unscoped" }, lookupFixture()), { scope: "unscoped" });
  assert.deepEqual(await normalizeTrajectoryScope({ scope: "ambiguous", channelId: "channel-a" }, lookupFixture()), { scope: "ambiguous" });
});
