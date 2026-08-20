import assert from "node:assert/strict";
import test from "node:test";
import type { TrajGroupItem } from "../web/src/trajBuffer.ts";
import { groupTrajectorySteps } from "../web/src/features/trajectory/trajectoryStepModel.ts";

const tool = (
  toolName: string,
  toolCallId: string,
): Extract<TrajGroupItem, { kind: "tool" }> => ({
  kind: "tool",
  text: "",
  toolName,
  toolCallId,
  toolState: "output-available",
});

test("groupTrajectorySteps groups only adjacent tool calls", () => {
  const steps = groupTrajectorySteps([
    { kind: "thinking", text: "plan" },
    tool("Read", "read-1"),
    tool("Bash", "bash-1"),
    { kind: "text", text: "done" },
    tool("Write", "write-1"),
  ]);

  assert.deepEqual(
    steps.map((step) => (
      step.kind === "tool-group"
        ? { kind: step.kind, tools: step.items.map((item) => item.toolCallId) }
        : { kind: step.kind, item: step.item.kind }
    )),
    [
      { kind: "item", item: "thinking" },
      { kind: "tool-group", tools: ["read-1", "bash-1"] },
      { kind: "item", item: "text" },
      { kind: "item", item: "tool" },
    ],
  );
});

test("groupTrajectorySteps preserves source indexes across grouped calls", () => {
  const steps = groupTrajectorySteps([
    { kind: "status", text: "working" },
    tool("Read", "read-1"),
    tool("Search", "search-1"),
    { kind: "thinking", text: "next" },
  ]);

  assert.deepEqual(steps.map((step) => step.sourceIndex), [0, 1, 3]);
});
