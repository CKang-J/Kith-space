import assert from "node:assert/strict";
import test from "node:test";
import { uniqueMentionedAgentIds } from "./composerTaskMentions.ts";

const agents = [
  { id: "agent-1", name: "planner" },
  { id: "agent-2", name: "开发者" },
];

test("task mention parsing counts duplicate mentions of one Agent only once", () => {
  assert.deepEqual(uniqueMentionedAgentIds("@planner 请处理，完成后告诉 @planner", agents), ["agent-1"]);
});

test("task mention parsing finds multiple unique Agents and ignores unknown names", () => {
  assert.deepEqual(uniqueMentionedAgentIds("@Planner 和 @开发者 一起看，@unknown 不存在", agents), ["agent-1", "agent-2"]);
});
