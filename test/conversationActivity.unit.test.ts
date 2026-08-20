import assert from "node:assert/strict";
import { test } from "node:test";
import {
  conversationActivityUpdateFromSocket,
  removeConversationActivity,
  selectConversationActivity,
  upsertConversationActivity,
  type ConversationActivityBuckets,
} from "../web/src/conversationActivity.ts";

test("conversation activity ignores unscoped workspace-wide status", () => {
  assert.equal(conversationActivityUpdateFromSocket({
    agentId: "agent-1",
    name: "claude-code",
    activity: "thinking",
  }), null);
});

test("conversation activity maps tools to concise user-facing phases without exposing arguments", () => {
  const search = conversationActivityUpdateFromSocket({
    agentId: "agent-1",
    name: "claude-code",
    scope: "scoped",
    channelId: "channel-1",
    streamId: "turn-1",
    entries: [{ kind: "tool", toolName: "WebSearch", toolInput: "private raw query" }],
  }, 100);
  assert.deepEqual(search, {
    surfaceId: "channel-1",
    entry: {
      agentId: "agent-1",
      name: "claude-code",
      phase: "searching",
      streamId: "turn-1",
      updatedAt: 100,
    },
  });

  const taskUpdate = conversationActivityUpdateFromSocket({
    agentId: "agent-1",
    name: "claude-code",
    scope: "scoped",
    channelId: "thread-1",
    streamId: "turn-2",
    entries: [{ kind: "tool", toolName: "Bash", toolInput: "kith-space task update --message-id secret" }],
  }, 200);
  assert.equal(taskUpdate?.surfaceId, "thread-1");
  assert.equal(taskUpdate?.entry.phase, "updating");
  assert.equal(taskUpdate?.entry.toolName, undefined);
});

test("conversation activity keeps a terminal label briefly and cannot clear a newer stream", () => {
  const active = conversationActivityUpdateFromSocket({
    agentId: "agent-1",
    name: "claude-code",
    scope: "scoped",
    channelId: "channel-1",
    streamId: "turn-1",
    activity: "thinking",
  }, 100)!;
  let buckets = upsertConversationActivity({}, active);

  const completed = conversationActivityUpdateFromSocket({
    agentId: "agent-1",
    name: "claude-code",
    scope: "scoped",
    channelId: "channel-1",
    streamId: "turn-1",
    activity: "online",
  }, 200)!;
  buckets = upsertConversationActivity(buckets, completed);
  assert.equal(buckets["channel-1"]?.["agent-1"]?.phase, "completed");
  assert.equal(completed.terminalDelayMs, 1_200);

  const newer = conversationActivityUpdateFromSocket({
    agentId: "agent-1",
    name: "claude-code",
    scope: "scoped",
    channelId: "channel-1",
    streamId: "turn-2",
    activity: "working",
  }, 300)!;
  buckets = upsertConversationActivity(buckets, newer);
  buckets = removeConversationActivity(buckets, "channel-1", "agent-1", "turn-1");
  assert.equal(buckets["channel-1"]?.["agent-1"]?.streamId, "turn-2");
});

test("conversation activity selection favors user action and reports concurrent agents", () => {
  const buckets: ConversationActivityBuckets = {
    "channel-1": {
      "agent-1": { agentId: "agent-1", name: "one", phase: "searching", updatedAt: 300 },
      "agent-2": { agentId: "agent-2", name: "two", phase: "waiting", updatedAt: 200 },
      "agent-3": { agentId: "agent-3", name: "three", phase: "completed", updatedAt: 400 },
    },
  };
  const selected = selectConversationActivity(buckets["channel-1"]);
  assert.equal(selected?.primary.agentId, "agent-2");
  assert.equal(selected?.extraCount, 1);
});
