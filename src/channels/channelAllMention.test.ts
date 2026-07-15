import assert from "node:assert/strict";
import test from "node:test";
import {
  CHANNEL_ALL_MENTION_TYPE,
  containsChannelAllMention,
  mergeChannelAllMentions,
} from "./channelAllMention.js";

test("channel-all mention recognizes the locale-independent complete token only", () => {
  assert.equal(containsChannelAllMention("请 @all 看一下"), true);
  assert.equal(containsChannelAllMention("@ALL"), true);
  assert.equal(containsChannelAllMention("@alliance"), false);
  assert.equal(containsChannelAllMention("@all_2"), false);
});

test("channel-all mention persists one marker plus a deduplicated recipient snapshot", () => {
  assert.deepEqual(mergeChannelAllMentions(
    [{ type: "agent", id: "agent-1", name: "planner" }],
    [
      { type: "agent", id: "agent-1", name: "planner" },
      { type: "agent", id: "agent-2", name: "reviewer" },
    ],
    "channel-1",
  ), [
    { type: "agent", id: "agent-1", name: "planner" },
    { type: "agent", id: "agent-2", name: "reviewer" },
    { type: CHANNEL_ALL_MENTION_TYPE, id: "channel-1", name: "all" },
  ]);
});
