import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveAgentWorkspacePaths } from "../src/agents/agentWorkspacePaths.ts";

test("agent workspace paths keep business files, Agent Memory, and runtime state separate", () => {
  const workspaceRoot = path.resolve("D:/projects/example-space");
  const runtimeStateRoot = path.resolve("D:/app-data/runtime");
  const paths = resolveAgentWorkspacePaths({
    agentId: "agent-1",
    spaceId: "space-1",
    workspaceRoot,
  }, runtimeStateRoot);

  assert.deepEqual(paths, {
    workspaceRoot,
    agentMemoryDir: path.join(workspaceRoot, ".kith", "agents", "agent-1"),
    runtimeStateDir: path.join(runtimeStateRoot, "space-1", "agent-1"),
  });
  assert.throws(
    () => resolveAgentWorkspacePaths({ agentId: "agent-1", spaceId: "space-1", workspaceRoot: "" }, runtimeStateRoot),
    /requires agentId, spaceId, and workspaceRoot/,
  );
});

test("agent workspace paths reject ids that can escape their owned containers", () => {
  const workspaceRoot = path.resolve("D:/projects/example-space");
  const runtimeStateRoot = path.resolve("D:/app-data/runtime");
  const badIds = ["..", "../escape", "..\\escape", "/absolute", "C:\\absolute", "space/child", "space\\child"];

  for (const badId of badIds) {
    assert.throws(
      () => resolveAgentWorkspacePaths({ agentId: badId, spaceId: "space-1", workspaceRoot }, runtimeStateRoot),
      /safe path segment/,
      `agentId ${badId} must be rejected`,
    );
    assert.throws(
      () => resolveAgentWorkspacePaths({ agentId: "agent-1", spaceId: badId, workspaceRoot }, runtimeStateRoot),
      /safe path segment/,
      `spaceId ${badId} must be rejected`,
    );
  }
});
