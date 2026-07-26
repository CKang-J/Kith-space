// Unit test for claudeRuntime.buildClaudeArgs — the pure argv builder extracted from start().
// Covers the "use local default" contract: when model/effort are absent, NEITHER --model NOR --effort
// is passed, so the claude CLI falls back to ~/.claude settings. Also covers #65's half-finished
// effort pass-through (UI offered it; runtime never sent it).
// Run: npx tsx --test src/daemon/claudeRuntime.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildClaudeArgs, claudePromptFile } from "./claudeRuntime.js";
import { createClaudeTrajectoryState, parseClaudeTrajectoryEvent } from "./claudeTrajectory.js";

const BASE = (promptFlag: string[] = ["--append-system-prompt", "SP"]) =>
  buildClaudeArgs({ promptFileFlag: promptFlag });

test("Claude system prompt file lives in runtime state, not the Space root", () => {
  const runtimeStateDir = path.resolve("D:/app-data/runtime/space-1/agent-1");
  assert.equal(
    claudePromptFile({ cwd: path.resolve("D:/spaces/project"), runtimeStateDir }),
    path.join(runtimeStateDir, "claude-system-prompt.md"),
  );
});

function has(args: string[], flag: string): boolean { return args.includes(flag); }
function valAfter(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined;
}

test("no model, no effort → CLI uses local default (neither --model nor --effort passed)", () => {
  const args = BASE();
  assert.equal(has(args, "--model"), false, "must not pass --model when model is unset");
  assert.equal(has(args, "--effort"), false, "must not pass --effort when effort is unset");
  assert.equal(has(args, "--resume"), false);
  // baseline flags still present
  assert.equal(valAfter(args, "--output-format"), "stream-json");
  assert.equal(valAfter(args, "--permission-mode"), "bypassPermissions");
  assert.ok(has(args, "--verbose"));
});

test("model only → --model passed, no --effort", () => {
  const args = buildClaudeArgs({ promptFileFlag: ["--append-system-prompt", "SP"], model: "sonnet" });
  assert.equal(valAfter(args, "--model"), "sonnet");
  assert.equal(has(args, "--effort"), false);
});

test("effort only → --effort passed, no --model (the #65 fix)", () => {
  const args = buildClaudeArgs({ promptFileFlag: ["--append-system-prompt", "SP"], reasoningEffort: "high" });
  assert.equal(valAfter(args, "--effort"), "high");
  assert.equal(has(args, "--model"), false);
});

test("model + effort + sessionId → all three passed; --resume last", () => {
  const args = buildClaudeArgs({
    promptFileFlag: ["--append-system-prompt-file", "/p.md"], model: "opus", reasoningEffort: "xhigh", sessionId: "abc-123",
  });
  assert.equal(valAfter(args, "--model"), "opus");
  assert.equal(valAfter(args, "--effort"), "xhigh");
  assert.equal(valAfter(args, "--resume"), "abc-123");
});

test("effort allow-list rejects bogus values (injection guard)", () => {
  const args = buildClaudeArgs({ promptFileFlag: ["--append-system-prompt", "SP"], reasoningEffort: "rm -rf /" });
  assert.equal(has(args, "--effort"), false, "non-allow-listed effort must be dropped");
});

test("effort='max' boundary value passes through", () => {
  const args = buildClaudeArgs({ promptFileFlag: ["--append-system-prompt", "SP"], reasoningEffort: "max" });
  assert.equal(valAfter(args, "--effort"), "max");
});

test("Harness v2 injects only the generated kith-core MCP config", () => {
  const args = buildClaudeArgs({ promptFileFlag: ["--append-system-prompt", "SP"], mcpConfigFile: "/runtime/kith-core.json" });
  assert.equal(valAfter(args, "--mcp-config"), "/runtime/kith-core.json");
  assert.equal(has(args, "--strict-mcp-config"), true);
});

test("spawn errors are handled so a missing claude CLI does not crash the daemon", () => {
  const src = fs.readFileSync(new URL("./claudeRuntime.ts", import.meta.url), "utf8");
  assert.match(src, /proc\.on\("error",/, "claude runtime must listen for child_process spawn errors");
  assert.match(src, /cb\.log\.error\("claude spawn failed"/, "spawn failures should be logged for operators");
  assert.match(src, /cb\.onActivity\("offline", "claude not found"\)/, "missing claude CLI should surface as offline activity");
  assert.match(src, /finish\(1\)/, "spawn failure should terminate only this runtime session");
});

test("Claude trajectory preserves complete thinking and correlates tool input with output", () => {
  const state = createClaudeTrajectoryState();
  assert.deepEqual(parseClaudeTrajectoryEvent({
    type: "assistant",
    message: { content: [
      { type: "thinking", thinking: "I should inspect the current state before changing it." },
      { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "printf 'TRACE_OK\\n'" } },
    ] },
  }, state), [
    { kind: "thinking", text: "I should inspect the current state before changing it." },
    {
      kind: "tool",
      eventKind: "tool_started",
      toolCallId: "tool-1",
      toolName: "Bash",
      toolInput: "{\n  \"command\": \"printf 'TRACE_OK\\\\n'\"\n}",
    },
  ]);

  assert.deepEqual(parseClaudeTrajectoryEvent({
    type: "user",
    message: { content: [
      { type: "tool_result", tool_use_id: "tool-1", content: [{ type: "text", text: "TRACE_OK\n" }] },
    ] },
  }, state), [{
    kind: "tool",
    eventKind: "tool_completed",
    toolCallId: "tool-1",
    toolName: "Bash",
    toolOutput: "TRACE_OK\n",
  }]);
});

test("Claude trajectory retains failed tool output", () => {
  const state = createClaudeTrajectoryState();
  parseClaudeTrajectoryEvent({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "tool-fail", name: "Read", input: { file_path: "/missing" } }] },
  }, state);
  assert.deepEqual(parseClaudeTrajectoryEvent({
    type: "user",
    message: { content: [
      { type: "tool_result", tool_use_id: "tool-fail", is_error: true, content: "File does not exist" },
    ] },
  }, state), [{
    kind: "tool",
    eventKind: "tool_failed",
    toolCallId: "tool-fail",
    toolName: "Read",
    toolOutput: "File does not exist",
  }]);
});
