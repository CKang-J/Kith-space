import assert from "node:assert/strict";
import test from "node:test";
import {
  containsChannelAllMention,
  matchesChannelAllMentionQuery,
} from "./composerChannelAllMention.ts";

test("Composer recognizes only the complete locale-independent channel-all token", () => {
  assert.equal(containsChannelAllMention("@all 请确认"), true);
  assert.equal(containsChannelAllMention("@ALL"), true);
  assert.equal(containsChannelAllMention("@alliance"), false);
});

test("channel-all candidate stays first-matchable while typing its canonical name", () => {
  assert.equal(matchesChannelAllMentionQuery(""), true);
  assert.equal(matchesChannelAllMentionQuery("a"), true);
  assert.equal(matchesChannelAllMentionQuery("ALL"), true);
  assert.equal(matchesChannelAllMentionQuery("everyone"), false);
});
