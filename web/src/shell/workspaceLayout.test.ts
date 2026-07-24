import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INITIAL_WORKSPACE_LAYOUT,
  deriveWorkspaceMode,
  openRouteModule,
  selectWorkspaceModule,
  workspaceLayoutForSpace,
  type SidebarModuleId,
} from "./workspaceLayout.ts";
import { HOME_SIDEBAR_MODULES, SIDEBAR_MODULES, WORKSPACE_MODULES } from "./workspaceModules.tsx";

test("ordinary and Home sidebars expose their fixed module sets", () => {
  assert.deepEqual(
    SIDEBAR_MODULES.map((module) => module.id),
    ["inbox", "tasks", "agents", "settings"],
  );
  assert.deepEqual(
    HOME_SIDEBAR_MODULES.map((module) => module.id),
    ["spaces", "inbox", "tasks", "agents", "settings"],
  );
  assert.equal(WORKSPACE_MODULES.find((module) => module.id === "search")?.sidebar, false);
});

test("Spaces layout is valid only inside stable Home", () => {
  const spaces = openRouteModule("spaces", { chatVisible: true });
  assert.equal(workspaceLayoutForSpace(spaces, true), spaces);
  assert.equal(workspaceLayoutForSpace(spaces, false), INITIAL_WORKSPACE_LAYOUT);
});

test("initial layout is ChatOnly", () => {
  assert.deepEqual(INITIAL_WORKSPACE_LAYOUT, {
    activeModule: null,
    chatVisible: true,
  });
  assert.equal(deriveWorkspaceMode(INITIAL_WORKSPACE_LAYOUT), "chat-only");
});

test("selecting a content module replaces Chat", () => {
  const state = selectWorkspaceModule(INITIAL_WORKSPACE_LAYOUT, "tasks");

  assert.deepEqual(state, { activeModule: "tasks", chatVisible: false });
  assert.equal(deriveWorkspaceMode(state), "module-only");
});

test("selecting the active module closes it and returns to ChatOnly", () => {
  const split = openRouteModule("tasks", { chatVisible: true });
  const moduleOnly = openRouteModule("tasks", { chatVisible: false });

  assert.deepEqual(selectWorkspaceModule(split, "tasks"), INITIAL_WORKSPACE_LAYOUT);
  assert.deepEqual(selectWorkspaceModule(moduleOnly, "tasks"), INITIAL_WORKSPACE_LAYOUT);
});

test("switching content modules keeps Chat replaced", () => {
  const split = openRouteModule("tasks", { chatVisible: true });
  const moduleOnly = openRouteModule("tasks", { chatVisible: false });

  assert.deepEqual(selectWorkspaceModule(split, "inbox"), {
    activeModule: "inbox",
    chatVisible: false,
  });
  assert.deepEqual(selectWorkspaceModule(moduleOnly, "agents"), {
    activeModule: "agents",
    chatVisible: false,
  });
});

test("settings keeps Chat visible because it is presented as a modal", () => {
  const state = selectWorkspaceModule(INITIAL_WORKSPACE_LAYOUT, "settings");
  assert.deepEqual(state, { activeModule: "settings", chatVisible: true });
  assert.equal(deriveWorkspaceMode(state), "chat-only");
});

test("route initialization explicitly chooses Chat visibility", () => {
  const sidebarModule: SidebarModuleId = "settings";
  const settings = openRouteModule(sidebarModule, { chatVisible: true });
  const moduleOnly = openRouteModule("search", { chatVisible: false });

  assert.equal(deriveWorkspaceMode(settings), "chat-only");
  assert.equal(deriveWorkspaceMode(moduleOnly), "module-only");
});
