import test from "node:test";
import assert from "node:assert/strict";
import { TaskOperationError } from "./taskTypes.js";
import { taskAssigneeFromMentions } from "./taskMentionAssignment.js";

const agent = (id: string) => ({ type: "agent" as const, id });

test("a Human channel task with one unique Agent mention resolves that assignee", () => {
  assert.equal(taskAssigneeFromMentions({
    asTask: true,
    senderType: "human",
    channelType: "channel",
    mentions: [agent("agent-1"), agent("agent-1")],
  }), "agent-1");
});

test("a Human channel task without an Agent mention stays unassigned", () => {
  assert.equal(taskAssigneeFromMentions({
    asTask: true,
    senderType: "human",
    channelType: "private",
    mentions: [{ type: "human", id: "human-1" }],
  }), null);
});

test("multiple Agent targets are rejected before persistence", () => {
  assert.throws(() => taskAssigneeFromMentions({
    asTask: true,
    senderType: "human",
    channelType: "channel",
    mentions: [agent("agent-1"), agent("agent-2")],
  }), (error) => error instanceof TaskOperationError && error.code === "INVALID_ARGUMENT");
});

test("DM tasks and Agent-authored tasks do not infer assignees from prose mentions", () => {
  assert.equal(taskAssigneeFromMentions({ asTask: true, senderType: "human", channelType: "dm", mentions: [agent("agent-1")] }), null);
  assert.equal(taskAssigneeFromMentions({ asTask: true, senderType: "agent", channelType: "channel", mentions: [agent("agent-1")] }), null);
});
