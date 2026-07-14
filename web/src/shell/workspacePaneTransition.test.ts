import assert from "node:assert/strict";
import test from "node:test";
import {
  workspacePaneTransition,
  workspacePaneWidths,
  workspacePaneWidthsWithAggregate,
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

test("aggregate panel sits between Chat and Module without violating their minimums", () => {
  assert.deepEqual(workspacePaneWidthsWithAggregate(chatOnly, 1440, 0.75, true), {
    chat: 1130,
    divider: 0,
    module: 0,
    aggregate: 300,
    aggregateGap: 10,
    aggregateAvailable: true,
  });
  assert.deepEqual(workspacePaneWidthsWithAggregate(splitTasks, 1440, 0.75, true), {
    chat: 360,
    divider: 10,
    module: 760,
    aggregate: 300,
    aggregateGap: 10,
    aggregateAvailable: true,
  });
  assert.deepEqual(workspacePaneWidthsWithAggregate(tasksOnly, 1440, 0.75, true), {
    chat: 0,
    divider: 0,
    module: 1440,
    aggregate: 0,
    aggregateGap: 0,
    aggregateAvailable: false,
  });
});
