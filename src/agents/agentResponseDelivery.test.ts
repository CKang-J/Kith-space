import test from "node:test";
import assert from "node:assert/strict";
import { decideAgentMessageResponse } from "./agentResponseDelivery.js";

test("explicit task assignments bypass silent mode and wake watermarks", () => {
  assert.deepEqual(decideAgentMessageResponse({
    agentId: "agent-1",
    channelType: "channel",
    senderType: "human",
    effectiveMode: "silent",
    messageSeq: 10,
    taskAssigneeId: "agent-1",
    isTask: true,
    ambientWakeAfterSeq: 100,
    mentionWakeAfterSeq: 100,
  }), {
    wake: true,
    directive: "required",
    deliveryClass: "direct",
    reason: "explicit_task_assignment",
  });
});

test("task-thread system events remain direct for the assigned agent", () => {
  const decision = decideAgentMessageResponse({
    agentId: "agent-1",
    channelType: "thread",
    senderType: "system",
    effectiveMode: "silent",
    messageSeq: 10,
    parentTaskAssigneeId: "agent-1",
  });
  assert.equal(decision.directive, "required");
  assert.equal(decision.reason, "explicit_task_assignment");
});

test("explicit task delivery paths consume the same central decision", () => {
  const decision = decideAgentMessageResponse({
    agentId: "agent-1",
    channelType: "thread",
    senderType: "system",
    effectiveMode: "silent",
    messageSeq: 10,
    explicitTaskAssignment: true,
    ambientWakeAfterSeq: 100,
    mentionWakeAfterSeq: 100,
  });
  assert.equal(decision.wake, true);
  assert.equal(decision.directive, "required");
  assert.equal(decision.reason, "explicit_task_assignment");
});

test("mode enablement never retroactively ambient-wakes old messages", () => {
  assert.deepEqual(decideAgentMessageResponse({
    agentId: "agent-1",
    channelType: "channel",
    senderType: "human",
    effectiveMode: "active",
    messageSeq: 10,
    ambientWakeAfterSeq: 10,
  }), {
    wake: false,
    directive: "observe",
    deliveryClass: "observe",
    reason: "before_ambient_wake_watermark",
  });
});

test("mention and participating-thread wakes use the mention watermark", () => {
  for (const input of [
    { channelType: "channel" as const, mentioned: true },
    { channelType: "thread" as const, mentioned: false },
  ]) {
    const decision = decideAgentMessageResponse({
      agentId: "agent-1",
      senderType: "human",
      effectiveMode: "mention_only",
      messageSeq: 11,
      mentionWakeAfterSeq: 11,
      ...input,
    });
    assert.equal(decision.wake, false);
    assert.equal(decision.reason, "before_mention_wake_watermark");
  }
});

test("newer ambient and mention messages keep their original directives", () => {
  assert.equal(decideAgentMessageResponse({
    agentId: "agent-1",
    channelType: "channel",
    senderType: "human",
    effectiveMode: "active",
    messageSeq: 11,
    ambientWakeAfterSeq: 10,
  }).directive, "optional");
  assert.equal(decideAgentMessageResponse({
    agentId: "agent-1",
    channelType: "channel",
    senderType: "human",
    effectiveMode: "mention_only",
    mentioned: true,
    messageSeq: 11,
    mentionWakeAfterSeq: 10,
  }).directive, "required");
});
