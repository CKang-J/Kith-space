import test from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "./prompt.js";

test("system prompt teaches the plan-first confirmation protocol and orchestration return mention", () => {
  const prompt = buildSystemPrompt({
    name: "leader",
    displayName: "Leader",
    agentId: "leader-id",
    serverId: "workspace-id",
    hostname: "test-host",
    os: "test-os",
    workspace: "test-workspace",
  });
  assert.match(prompt, /mode=autopilot/);
  assert.match(prompt, /mode=plan-first/);
  assert.match(prompt, /wait for a human to say “开始”/);
  assert.match(prompt, /do not @mention dev\/tester\/other agents/);
  assert.match(prompt, /do not run `task assign`/);
  assert.match(prompt, /delegated agents to @mention you when reporting/);
  assert.match(prompt, /soft guard/);
});
