import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EMPTY_WORKSPACE_TAB_STATE,
  WORKSPACE_TABS_STORAGE_VERSION,
  activeWorkspaceTab,
  closeWorkspaceTab,
  openWorkspaceTab,
  removeWorkspaceResourceTab,
  renameWorkspaceResourceTab,
  persistWorkspaceTabState,
  restoreWorkspaceTabState,
  sanitizeWorkspaceTabState,
  workspaceTabId,
  workspaceTabStorageKey,
  type WorkspaceTabStorage,
} from "./workspaceTabs.ts";

class MemoryStorage implements WorkspaceTabStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

test("opens Tasks, Inbox, and an Agent as independently addressable tabs", () => {
  const tasks = openWorkspaceTab(EMPTY_WORKSPACE_TAB_STATE, { moduleId: "tasks", resourceId: "space" });
  const inbox = openWorkspaceTab(tasks, { moduleId: "inbox" });
  const agents = openWorkspaceTab(inbox, { moduleId: "agents", resourceId: "agent-ada", title: "Ada" });

  assert.deepEqual(agents.tabs.map((tab) => tab.id), ["tasks:space", "inbox", "agents:agent-ada"]);
  assert.equal(agents.activeTabId, "agents:agent-ada");
  assert.equal(activeWorkspaceTab(agents)?.title, "Ada");
  assert.equal(workspaceTabId({ moduleId: "agents", resourceId: "agent/ada" }), "agents:agent%2Fada");
});

test("opening an existing module resource focuses it instead of adding a duplicate", () => {
  const initial = openWorkspaceTab(EMPTY_WORKSPACE_TAB_STATE, { moduleId: "tasks", resourceId: "channel-1" });
  const withInbox = openWorkspaceTab(initial, { moduleId: "inbox" });
  const focused = openWorkspaceTab(withInbox, { moduleId: "tasks", resourceId: "channel-1", title: "Channel tasks" });

  assert.deepEqual(focused.tabs.map((tab) => tab.id), ["tasks:channel-1", "inbox"]);
  assert.equal(focused.activeTabId, "tasks:channel-1");
  assert.equal(activeWorkspaceTab(focused)?.title, "Channel tasks");
});

test("two Canvas resources are independent and the same Canvas tab is deduplicated", () => {
  const first = openWorkspaceTab(EMPTY_WORKSPACE_TAB_STATE, { moduleId: "canvas", resourceId: "canvas-a", title: "A" });
  const second = openWorkspaceTab(first, { moduleId: "canvas", resourceId: "canvas-b", title: "B" });
  const focused = openWorkspaceTab(second, { moduleId: "canvas", resourceId: "canvas-a", title: "A renamed" });
  assert.deepEqual(focused.tabs.map((tab) => tab.id), ["canvas:canvas-a", "canvas:canvas-b"]);
  assert.equal(focused.activeTabId, "canvas:canvas-a");
  assert.equal(activeWorkspaceTab(focused)?.title, "A renamed");
});

test("Canvas lifecycle events rename and remove the matching resource tab only", () => {
  const first = openWorkspaceTab(EMPTY_WORKSPACE_TAB_STATE, { moduleId: "canvas", resourceId: "canvas-a", title: "A" });
  const second = openWorkspaceTab(first, { moduleId: "canvas", resourceId: "canvas-b", title: "B" });
  const renamed = renameWorkspaceResourceTab(second, "canvas", "canvas-a", "A durable");
  assert.deepEqual(renamed.tabs.map((tab) => tab.title), ["A durable", "B"]);
  assert.equal(renamed.activeTabId, "canvas:canvas-b", "renaming an inactive resource does not focus it");
  const removed = removeWorkspaceResourceTab(renamed, "canvas", "canvas-b");
  assert.deepEqual(removed.tabs.map((tab) => tab.id), ["canvas:canvas-a"]);
  assert.equal(removed.activeTabId, "canvas:canvas-a");
  assert.deepEqual(removeWorkspaceResourceTab(removed, "canvas", "canvas-b"), removed, "a repeated tombstone is idempotent");
});

test("closing the active tab focuses the next tab, then the previous tab", () => {
  const tasks = openWorkspaceTab(EMPTY_WORKSPACE_TAB_STATE, { moduleId: "tasks", resourceId: "space" });
  const inbox = openWorkspaceTab(tasks, { moduleId: "inbox" });
  const agents = openWorkspaceTab(inbox, { moduleId: "agents", resourceId: "agent-ada" });
  const inboxFocused = openWorkspaceTab(agents, { moduleId: "inbox" });
  const afterInboxClose = closeWorkspaceTab(inboxFocused, "inbox");
  const afterAgentClose = closeWorkspaceTab(afterInboxClose, "agents:agent-ada");
  const afterLastClose = closeWorkspaceTab(afterAgentClose, "tasks:space");

  assert.deepEqual(afterInboxClose.tabs.map((tab) => tab.id), ["tasks:space", "agents:agent-ada"]);
  assert.equal(afterInboxClose.activeTabId, "agents:agent-ada");
  assert.equal(afterAgentClose.activeTabId, "tasks:space");
  assert.deepEqual(afterLastClose, EMPTY_WORKSPACE_TAB_STATE);
});

test("sanitizes stale persisted tabs and restores a valid active tab", () => {
  const sanitized = sanitizeWorkspaceTabState({
    tabs: [
      { id: "ignored", moduleId: "tasks", resourceId: "space", title: " Space tasks " },
      { id: "duplicate", moduleId: "tasks", resourceId: "space" },
      { id: "settings", moduleId: "settings" },
      { id: "bad-resource", moduleId: "agents", resourceId: 4 },
      { id: "inbox", moduleId: "inbox" },
    ],
    activeTabId: "missing",
  });

  assert.deepEqual(sanitized, {
    tabs: [
      { id: "tasks:space", moduleId: "tasks", resourceId: "space", title: "Space tasks" },
      { id: "inbox", moduleId: "inbox", resourceId: null, title: null },
    ],
    activeTabId: "inbox",
  });
});

test("corrupt and incompatible localStorage payloads restore as an empty workspace", () => {
  const storage = new MemoryStorage();
  const spaceId = "space-a";
  storage.setItem(workspaceTabStorageKey(spaceId), "not-json");
  assert.deepEqual(restoreWorkspaceTabState(storage, spaceId), EMPTY_WORKSPACE_TAB_STATE);

  storage.setItem(workspaceTabStorageKey(spaceId), JSON.stringify({
    version: WORKSPACE_TABS_STORAGE_VERSION + 1,
    state: { tabs: [{ moduleId: "inbox" }], activeTabId: "inbox" },
  }));
  assert.deepEqual(restoreWorkspaceTabState(storage, spaceId), EMPTY_WORKSPACE_TAB_STATE);
});

test("persisted tab groups are isolated by Space", () => {
  const storage = new MemoryStorage();
  const spaceATabs = openWorkspaceTab(EMPTY_WORKSPACE_TAB_STATE, { moduleId: "tasks", resourceId: "space" });
  const spaceBTabs = openWorkspaceTab(EMPTY_WORKSPACE_TAB_STATE, { moduleId: "inbox" });

  persistWorkspaceTabState(storage, "space-a", spaceATabs);
  assert.deepEqual(restoreWorkspaceTabState(storage, "space-b"), EMPTY_WORKSPACE_TAB_STATE);
  persistWorkspaceTabState(storage, "space-b", spaceBTabs);

  assert.equal(activeWorkspaceTab(restoreWorkspaceTabState(storage, "space-a"))?.id, "tasks:space");
  assert.equal(activeWorkspaceTab(restoreWorkspaceTabState(storage, "space-b"))?.id, "inbox");
  assert.notEqual(workspaceTabStorageKey("space-a"), workspaceTabStorageKey("space-b"));
});
