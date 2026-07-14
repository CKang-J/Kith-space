import { test } from "node:test";
import assert from "node:assert/strict";
import { canAutoJoinMentionedMembers } from "./agentWakePolicy.js";

test("only human-authored mentions auto-join non-members", () => {
  assert.equal(canAutoJoinMentionedMembers("human"), true);
  assert.equal(canAutoJoinMentionedMembers("agent"), false);
  assert.equal(canAutoJoinMentionedMembers("system"), false);
});
