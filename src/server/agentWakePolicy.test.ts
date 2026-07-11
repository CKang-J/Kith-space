import { test } from "node:test";
import assert from "node:assert/strict";
import { canAutoJoinMentionedMembers, isWakeable } from "./agentWakePolicy.js";

test("only human-authored mentions auto-join non-members", () => {
  assert.equal(canAutoJoinMentionedMembers("human"), true);
  assert.equal(canAutoJoinMentionedMembers("agent"), false);
  assert.equal(canAutoJoinMentionedMembers("system"), false);
});

test("DM and explicit mentions wake agents", () => {
  assert.equal(isWakeable({ channelType: "dm", mentioned: false, hasInboxScope: false, senderType: "agent" }), true);
  assert.equal(isWakeable({ channelType: "channel", mentioned: true, hasInboxScope: false, senderType: "agent" }), true);
  assert.equal(isWakeable({ channelType: "thread", mentioned: true, hasInboxScope: false, senderType: "agent" }), true);
});

test("agent-authored ambient channel chatter does not wake peer agents", () => {
  assert.equal(isWakeable({ channelType: "channel", mentioned: false, hasInboxScope: true, senderType: "agent" }), false);
  assert.equal(isWakeable({ channelType: "thread", mentioned: false, hasInboxScope: true, senderType: "agent" }), false);
});

test("orchestration loop wakes leader to dev/tester and explicit reports back to leader", () => {
  const explicitAgentMention = (mentioned: boolean) => isWakeable({
    channelType: "thread",
    mentioned,
    hasInboxScope: true,
    senderType: "agent" as const,
  });
  assert.equal(explicitAgentMention(true), true, "leader @dev wakes dev");
  assert.equal(explicitAgentMention(true), true, "leader @tester wakes tester");
  assert.equal(explicitAgentMention(true), true, "dev @leader report wakes leader");
  assert.equal(explicitAgentMention(false), false, "unmentioned agent chatter does not create a loop");
});

test("human and system ambient messages keep inbox-scope wake behavior", () => {
  assert.equal(isWakeable({ channelType: "channel", mentioned: false, hasInboxScope: true, senderType: "human" }), true);
  assert.equal(isWakeable({ channelType: "channel", mentioned: false, hasInboxScope: true, senderType: "system" }), true);
  assert.equal(isWakeable({ channelType: "channel", mentioned: false, hasInboxScope: false, senderType: "human" }), false);
});
