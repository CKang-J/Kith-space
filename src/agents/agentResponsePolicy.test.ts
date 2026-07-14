import test from "node:test";
import assert from "node:assert/strict";
import { applyAgentResponseWakeWatermark, decideAgentResponse } from "./agentResponsePolicy.js";

test("explicit task assignment bypasses a silent channel mode", () => {
  assert.deepEqual(decideAgentResponse({
    channelType: "channel",
    senderType: "human",
    effectiveMode: "silent",
    explicitTaskAssignment: true,
  }), {
    wake: true,
    directive: "required",
    deliveryClass: "direct",
    reason: "explicit_task_assignment",
  });
});

test("direct messages bypass the configured response mode", () => {
  assert.deepEqual(decideAgentResponse({
    channelType: "dm",
    senderType: "human",
    effectiveMode: "silent",
  }), {
    wake: true,
    directive: "required",
    deliveryClass: "direct",
    reason: "direct_message",
  });
});

test("explicit mentions wake active and passive agents but not silent agents", () => {
  for (const effectiveMode of ["active", "mention_only"] as const) {
    assert.deepEqual(decideAgentResponse({
      channelType: "channel",
      senderType: "human",
      effectiveMode,
      mentioned: true,
    }), {
      wake: true,
      directive: "required",
      deliveryClass: "mention",
      reason: "explicit_mention",
    });
  }

  assert.deepEqual(decideAgentResponse({
    channelType: "channel",
    senderType: "human",
    effectiveMode: "silent",
    mentioned: true,
  }), {
    wake: false,
    directive: "observe",
    deliveryClass: "observe",
    reason: "silent_mention",
  });
});

test("a Human follow-up wakes participating active or passive thread agents", () => {
  for (const effectiveMode of ["active", "mention_only"] as const) {
    assert.deepEqual(decideAgentResponse({
      channelType: "thread",
      senderType: "human",
      effectiveMode,
      participatingThreadHumanFollowUp: true,
    }), {
      wake: true,
      directive: "optional",
      deliveryClass: "mention",
      reason: "participating_thread_follow_up",
    });
  }

  assert.deepEqual(decideAgentResponse({
    channelType: "thread",
    senderType: "human",
    effectiveMode: "silent",
    participatingThreadHumanFollowUp: true,
  }), {
    wake: false,
    directive: "observe",
    deliveryClass: "observe",
    reason: "silent_thread_follow_up",
  });
});

test("ordinary Human channel messages only ambient-wake active agents", () => {
  assert.deepEqual(decideAgentResponse({
    channelType: "channel",
    senderType: "human",
    effectiveMode: "active",
  }), {
    wake: true,
    directive: "optional",
    deliveryClass: "ambient",
    reason: "human_ambient_message",
  });

  for (const effectiveMode of ["mention_only", "silent"] as const) {
    assert.deepEqual(decideAgentResponse({
      channelType: "channel",
      senderType: "human",
      effectiveMode,
    }), {
      wake: false,
      directive: "observe",
      deliveryClass: "observe",
      reason: "response_mode_observe",
    });
  }
});

test("ordinary Agent channel messages never ambient-wake other agents", () => {
  for (const effectiveMode of ["active", "mention_only", "silent"] as const) {
    assert.deepEqual(decideAgentResponse({
      channelType: "channel",
      senderType: "agent",
      effectiveMode,
    }), {
      wake: false,
      directive: "observe",
      deliveryClass: "observe",
      reason: "agent_ambient_suppressed",
    });
  }
});

test("wake watermarks downgrade only pre-transition ambient or mention deliveries", () => {
  const ambient = decideAgentResponse({
    channelType: "channel",
    senderType: "human",
    effectiveMode: "active",
  });
  assert.deepEqual(applyAgentResponseWakeWatermark(ambient, 20, {
    ambientWakeAfterSeq: 20,
    mentionWakeAfterSeq: 0,
  }), {
    wake: false,
    directive: "observe",
    deliveryClass: "observe",
    reason: "before_ambient_wake_watermark",
  });

  const mention = decideAgentResponse({
    channelType: "channel",
    senderType: "human",
    effectiveMode: "mention_only",
    mentioned: true,
  });
  assert.deepEqual(applyAgentResponseWakeWatermark(mention, 9, {
    ambientWakeAfterSeq: 0,
    mentionWakeAfterSeq: 10,
  }), {
    wake: false,
    directive: "observe",
    deliveryClass: "observe",
    reason: "before_mention_wake_watermark",
  });

  const direct = decideAgentResponse({
    channelType: "channel",
    senderType: "human",
    effectiveMode: "silent",
    explicitTaskAssignment: true,
  });
  assert.equal(applyAgentResponseWakeWatermark(direct, 1, {
    ambientWakeAfterSeq: 100,
    mentionWakeAfterSeq: 100,
  }), direct);
});
