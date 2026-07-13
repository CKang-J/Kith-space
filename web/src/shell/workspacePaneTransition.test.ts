import assert from "node:assert/strict";
import test from "node:test";
import {
  workspacePaneTransition,
  workspacePaneWidths,
  type WorkspacePaneTransition,
} from "./workspacePaneTransition.ts";
import type { WorkspaceLayoutState } from "./workspaceLayout.ts";

const chatOnly: WorkspaceLayoutState = { activeModule: null, chatVisible: true };
const splitTasks: WorkspaceLayoutState = { activeModule: "tasks", chatVisible: true };
const tasksOnly: WorkspaceLayoutState = { activeModule: "tasks", chatVisible: false };

test("workspace pane transitions follow each pane's physical edge", () => {
  const cases: Array<[WorkspaceLayoutState, WorkspaceLayoutState, WorkspacePaneTransition]> = [
    [chatOnly, splitTasks, "open-module"],
    [splitTasks, chatOnly, "close-module"],
    [splitTasks, tasksOnly, "hide-chat"],
    [tasksOnly, splitTasks, "show-chat"],
  ];

  for (const [previous, next, expected] of cases) {
    assert.equal(workspacePaneTransition(previous, next), expected);
  }
});

test("pane endpoints are the same positions produced by dragging the divider", () => {
  assert.deepEqual(workspacePaneWidths(chatOnly, 1200, 0.75), {
    chat: 1200,
    divider: 0,
    module: 0,
  });
  assert.deepEqual(workspacePaneWidths(splitTasks, 1200, 0.75), {
    chat: 360,
    divider: 10,
    module: 830,
  });
  assert.deepEqual(workspacePaneWidths(tasksOnly, 1200, 0.75), {
    chat: 0,
    divider: 0,
    module: 1200,
  });
});

test("changing module content without changing pane visibility does not replay a layout transition", () => {
  assert.equal(
    workspacePaneTransition(splitTasks, { activeModule: "agents", chatVisible: true }),
    "none",
  );
});
