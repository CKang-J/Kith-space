import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INITIAL_WORKSPACE_LAYOUT,
  deriveWorkspaceMode,
  openRouteModule,
  selectWorkspaceModule,
  toggleChat,
  workspaceLayoutForSpace,
  type DockModuleId,
} from "./workspaceLayout.ts";
import { DOCK_MODULES, HOME_DOCK_MODULES, WORKSPACE_MODULES } from "./workspaceModules.tsx";

test("ordinary and Home Docks expose their fixed module sets", () => {
  assert.deepEqual(
    ["chat", ...DOCK_MODULES.map((module) => module.id)],
    ["chat", "inbox", "tasks", "agents", "settings"],
  );
  assert.deepEqual(
    ["chat", ...HOME_DOCK_MODULES.map((module) => module.id)],
    ["chat", "spaces", "inbox", "tasks", "agents", "settings"],
  );
  assert.equal(WORKSPACE_MODULES.find((module) => module.id === "search")?.dock, false);
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

test("selecting a module opens Split from ChatOnly", () => {
  const state = selectWorkspaceModule(INITIAL_WORKSPACE_LAYOUT, "tasks");

  assert.deepEqual(state, { activeModule: "tasks", chatVisible: true });
  assert.equal(deriveWorkspaceMode(state), "split");
});

test("selecting the active module closes it and returns to ChatOnly", () => {
  const split = openRouteModule("tasks", { chatVisible: true });
  const moduleOnly = openRouteModule("tasks", { chatVisible: false });

  assert.deepEqual(selectWorkspaceModule(split, "tasks"), INITIAL_WORKSPACE_LAYOUT);
  assert.deepEqual(selectWorkspaceModule(moduleOnly, "tasks"), INITIAL_WORKSPACE_LAYOUT);
});

test("switching modules preserves Chat visibility", () => {
  const split = openRouteModule("tasks", { chatVisible: true });
  const moduleOnly = openRouteModule("tasks", { chatVisible: false });

  assert.deepEqual(selectWorkspaceModule(split, "inbox"), {
    activeModule: "inbox",
    chatVisible: true,
  });
  assert.deepEqual(selectWorkspaceModule(moduleOnly, "agents"), {
    activeModule: "agents",
    chatVisible: false,
  });
});

test("Chat button is a no-op without a module", () => {
  assert.equal(toggleChat(INITIAL_WORKSPACE_LAYOUT), INITIAL_WORKSPACE_LAYOUT);
});

test("Chat button toggles between Split and ModuleOnly with a module", () => {
  const split = openRouteModule("settings", { chatVisible: true });
  const moduleOnly = toggleChat(split);

  assert.deepEqual(moduleOnly, { activeModule: "settings", chatVisible: false });
  assert.equal(deriveWorkspaceMode(moduleOnly), "module-only");

  const restored = toggleChat(moduleOnly);
  assert.deepEqual(restored, { activeModule: "settings", chatVisible: true });
  assert.equal(deriveWorkspaceMode(restored), "split");
});

test("route initialization explicitly chooses Chat visibility", () => {
  const dockModule: DockModuleId = "settings";
  const split = openRouteModule(dockModule, { chatVisible: true });
  const moduleOnly = openRouteModule("search", { chatVisible: false });

  assert.equal(deriveWorkspaceMode(split), "split");
  assert.equal(deriveWorkspaceMode(moduleOnly), "module-only");
});
