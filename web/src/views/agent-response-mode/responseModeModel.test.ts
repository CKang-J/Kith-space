import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeChannelAgentResponseMode,
  normalizeChannelAgentResponseModes,
  withDefaultResponseMode,
  withResponseModeOverride,
} from "./responseModeModel.ts";

test("channel response mode normalization preserves an explicit override equal to the default", () => {
  assert.deepEqual(normalizeChannelAgentResponseMode({
    id: "agent-1",
    defaultResponseMode: "active",
    responseModeOverride: "active",
    effectiveResponseMode: "active",
    responseModeSource: "channel_override",
  }), {
    agentId: "agent-1",
    defaultResponseMode: "active",
    responseModeOverride: "active",
    effectiveResponseMode: "active",
    responseModeSource: "channel_override",
  });
});

test("channel response mode normalization falls back safely and ignores malformed rows", () => {
  assert.deepEqual(normalizeChannelAgentResponseModes([
    { id: "agent-1", defaultResponseMode: "unknown" },
    { defaultResponseMode: "silent" },
  ]), {
    "agent-1": {
      agentId: "agent-1",
      defaultResponseMode: "active",
      responseModeOverride: null,
      effectiveResponseMode: "active",
      responseModeSource: "agent_default",
    },
  });
});

test("clearing a channel override restores inheritance from the Agent default", () => {
  const current = normalizeChannelAgentResponseMode({
    id: "agent-1",
    defaultResponseMode: "mention_only",
    responseModeOverride: "silent",
  });
  assert.ok(current);
  assert.deepEqual(withResponseModeOverride(current, null), {
    agentId: "agent-1",
    defaultResponseMode: "mention_only",
    responseModeOverride: null,
    effectiveResponseMode: "mention_only",
    responseModeSource: "agent_default",
  });
});

test("changing the Agent default updates inherited channels without erasing explicit overrides", () => {
  const inherited = normalizeChannelAgentResponseMode({
    id: "agent-1",
    defaultResponseMode: "active",
    responseModeOverride: null,
  });
  const overridden = normalizeChannelAgentResponseMode({
    id: "agent-1",
    defaultResponseMode: "active",
    responseModeOverride: "silent",
  });
  assert.ok(inherited);
  assert.ok(overridden);
  assert.deepEqual(withDefaultResponseMode(inherited, "mention_only"), {
    ...inherited,
    defaultResponseMode: "mention_only",
    effectiveResponseMode: "mention_only",
  });
  assert.deepEqual(withDefaultResponseMode(overridden, "mention_only"), {
    ...overridden,
    defaultResponseMode: "mention_only",
    effectiveResponseMode: "silent",
  });
});
