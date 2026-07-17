import assert from "node:assert/strict";
import test from "node:test";
import {
  CHANNEL_ALL_MENTION_NAME as serverMentionName,
  containsChannelAllMention as serverContainsChannelAllMention,
} from "../src/channels/channelAllMention.ts";
import {
  CHANNEL_ALL_MENTION_NAME as composerMentionName,
  containsChannelAllMention as composerContainsChannelAllMention,
} from "../web/src/views/composerChannelAllMention.ts";

test("server and Composer share the locale-independent @all contract", () => {
  assert.equal(serverMentionName, "all");
  assert.equal(composerMentionName, serverMentionName);
  for (const content of ["@all", "@ALL please review", "@alliance", "@everyone"]) {
    assert.equal(composerContainsChannelAllMention(content), serverContainsChannelAllMention(content));
  }
  assert.equal(serverContainsChannelAllMention("@everyone"), false, "localized labels must not become protocol tokens");
});
