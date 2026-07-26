import test from "node:test";
import assert from "node:assert/strict";
import {
  activityRowsToTrajectory,
  conversationActivityRowsToTrajectory,
} from "../web/src/features/trajectory/trajectoryActivityModel.ts";
import { groupTraj, mergeTrajectoryHistory } from "../web/src/trajBuffer.ts";

test("activity history reconstructs a correlated expandable tool call", () => {
  const items = activityRowsToTrajectory([
    {
      timestamp: 10,
      entry: {
        kind: "tool_started",
        detail: "call-1",
        toolName: "bash",
        toolInput: "{\"command\":\"pwd\"}",
      },
    },
    {
      timestamp: 20,
      entry: {
        kind: "tool_completed",
        detail: "call-1",
        toolName: "bash",
        text: "/tmp/project",
      },
    },
  ], { agentId: "agent", name: "Pi" });

  const groups = groupTraj(items);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.items.length, 1);
  const tool = groups[0]!.items[0]!;
  assert.equal(tool.kind, "tool");
  if (tool.kind === "tool") {
    assert.equal(tool.toolCallId, "call-1");
    assert.equal(tool.toolState, "output-available");
    assert.equal(tool.toolOutput, "/tmp/project");
    assert.equal(tool.createdAt, 10);
  }
});

test("activity history keeps visible reasoning and assistant text as distinct rows", () => {
  const groups = groupTraj(activityRowsToTrajectory([
    { timestamp: 10, entry: { kind: "thinking_summary", text: "先分析" } },
    { timestamp: 20, entry: { kind: "text_preview", text: "结论" } },
  ], { agentId: "agent", name: "Pi" }));

  assert.deepEqual(groups[0]!.items.map((item) => item.kind), ["thinking", "text"]);
});

test("activity history derives stable group boundaries from turn starts", () => {
  const groups = groupTraj(activityRowsToTrajectory([
    { timestamp: 10, entry: { kind: "turn_started", activity: "working" } },
    { timestamp: 20, entry: { kind: "text_preview", text: "第一轮" } },
    { timestamp: 30, entry: { kind: "turn_completed", activity: "online" } },
    { timestamp: 40, entry: { kind: "turn_started", activity: "working" } },
    { timestamp: 50, entry: { kind: "text_preview", text: "第二轮" } },
  ], { agentId: "agent", name: "Pi" }));

  assert.equal(groups.length, 2);
  assert.notEqual(groups[0]!.streamId, groups[1]!.streamId);
});

test("realtime activity preserves server turn stream ids without needing a turn-start row", () => {
  const groups = groupTraj(activityRowsToTrajectory([
    { streamId: "turn-a", timestamp: 10, entry: { kind: "text_preview", text: "第一轮" } },
    { streamId: "turn-b", timestamp: 20, entry: { kind: "text_preview", text: "第二轮" } },
  ], { agentId: "agent", name: "Pi" }));

  assert.deepEqual(groups.map((group) => group.streamId), ["turn-a", "turn-b"]);
});

test("activity history carries its conversation source into the turn group", () => {
  const source = {
    kind: "channel" as const,
    channelId: "channel-a",
    conversationId: "channel-a",
    name: "all",
    parentMessageId: null,
    parentPreview: null,
    unavailable: false,
  };
  const groups = groupTraj(activityRowsToTrajectory([
    {
      streamId: "turn-a",
      source,
      timestamp: 10,
      entry: { kind: "text_preview", text: "结论" },
    },
  ], { agentId: "agent", name: "Pi" }));

  assert.deepEqual(groups[0]!.source, source);
});

test("conversation activity history preserves each agent identity and turn boundary", () => {
  const groups = groupTraj(conversationActivityRowsToTrajectory([
    {
      agentId: "agent-a",
      name: "Pi",
      timestamp: 10,
      entry: { kind: "turn_started", activity: "working" },
    },
    {
      agentId: "agent-a",
      name: "Pi",
      timestamp: 20,
      entry: { kind: "text_preview", text: "Pi 的结论" },
    },
    {
      agentId: "agent-b",
      name: "claude-code",
      timestamp: 30,
      entry: { kind: "text_preview", text: "Claude 的结论" },
    },
  ]));

  assert.deepEqual(groups.map((group) => group.name), ["Pi", "claude-code"]);
  assert.equal(groups[0]!.items[1]?.kind, "text");
});

test("persisted and live trajectory overlap is rendered only once", () => {
  const persisted = [{
    agentId: "agent",
    name: "Pi",
    streamId: "turn-1",
    kind: "thinking" as const,
    eventKind: "thinking_summary",
    text: "先分析",
  }];
  const live = [
    { ...persisted[0], createdAt: 20 },
    {
      agentId: "agent",
      name: "Pi",
      streamId: "turn-1",
      kind: "text" as const,
      eventKind: "text_preview",
      text: "再回答",
      createdAt: 30,
    },
  ];

  assert.deepEqual(
    mergeTrajectoryHistory(persisted, live).map((item) => item.text),
    ["先分析", "再回答"],
  );
});
