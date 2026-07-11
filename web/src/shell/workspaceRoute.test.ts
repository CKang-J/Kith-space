import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mergeWorkspaceSearch,
  parseWorkspaceRoute,
  workspaceLayoutFromRoute,
  workspaceLocationForConversation,
  workspaceLocationForModule,
  workspaceModuleResourceFromSearch,
  workspaceSearchForLayout,
  workspaceSearchForShellState,
} from "./workspaceRoute.ts";

test("parses Chat routes and channel ids", () => {
  assert.deepEqual(parseWorkspaceRoute("/s/kith-space/channel/ch-1"), {
    section: "channel",
    resourceId: "ch-1",
    moduleId: null,
    isChatRoute: true,
    isChannelRoute: true,
  });
  assert.equal(parseWorkspaceRoute("/s/kith-space/saved").isChatRoute, true);
  assert.equal(parseWorkspaceRoute("/s/kith-space/showcase").isChatRoute, true);
});

test("legacy module detail paths no longer activate workspace modules", () => {
  assert.equal(parseWorkspaceRoute("/s/space/agent/agent-1").moduleId, null);
  assert.equal(parseWorkspaceRoute("/s/space/human/user-1").moduleId, null);
  assert.equal(parseWorkspaceRoute("/s/space/computer/machine-1").moduleId, null);
  assert.equal(parseWorkspaceRoute("/s/space/settings/notifications").moduleId, null);
  assert.equal(parseWorkspaceRoute("/s/space/tasks/space").moduleId, null);
});

test("removed Computers URLs and query state fall back to ChatOnly", () => {
  const removedRoute = parseWorkspaceRoute("/s/space/computer/machine-1");
  const channel = parseWorkspaceRoute("/s/space/channel/ch-1");

  assert.deepEqual(workspaceLayoutFromRoute(removedRoute, ""), {
    activeModule: null,
    chatVisible: true,
  });
  assert.deepEqual(workspaceLayoutFromRoute(channel, "?module=computers&chat=0"), {
    activeModule: null,
    chatVisible: true,
  });
});

test("unknown routes do not activate a module", () => {
  assert.deepEqual(parseWorkspaceRoute("/s/space/unknown/value"), {
    section: null,
    resourceId: null,
    moduleId: null,
    isChatRoute: false,
    isChannelRoute: false,
  });
});

test("URL can encode a channel and module at the same time", () => {
  const channel = parseWorkspaceRoute("/s/space/channel/ch-1");

  assert.deepEqual(workspaceLayoutFromRoute(channel, "?module=tasks"), {
    activeModule: "tasks",
    chatVisible: true,
  });
  assert.deepEqual(workspaceLayoutFromRoute(channel, "?module=tasks&chat=0"), {
    activeModule: "tasks",
    chatVisible: false,
  });
  assert.deepEqual(workspaceLayoutFromRoute(channel, "?chat=0"), {
    activeModule: null,
    chatVisible: true,
  });
});

test("module state is accepted only from the query contract", () => {
  const tasks = parseWorkspaceRoute("/s/space/tasks");
  assert.deepEqual(workspaceLayoutFromRoute(tasks, ""), {
    activeModule: null,
    chatVisible: true,
  });
  assert.deepEqual(workspaceLayoutFromRoute(tasks, "?module=tasks&chat=0"), {
    activeModule: "tasks",
    chatVisible: false,
  });
});

test("layout search preserves non-layout conversation state", () => {
  const splitSearch = workspaceSearchForLayout("?thread=thread-1", {
    activeModule: "agents",
    chatVisible: true,
  });
  const moduleOnlySearch = workspaceSearchForLayout(splitSearch, {
    activeModule: "agents",
    chatVisible: false,
  });
  const chatSearch = workspaceSearchForLayout(moduleOnlySearch, {
    activeModule: null,
    chatVisible: true,
  });

  assert.equal(new URLSearchParams(splitSearch).get("module"), "agents");
  assert.equal(new URLSearchParams(moduleOnlySearch).get("chat"), "0");
  assert.equal(new URLSearchParams(chatSearch).get("thread"), "thread-1");
  assert.equal(new URLSearchParams(chatSearch).has("module"), false);
});

test("switching modules removes resource state owned by other modules", () => {
  const agentsSearch = workspaceSearchForLayout(
    "?module=tasks&taskScope=channel-1&agent=agent-old&settings=desktop&chat=0",
    { activeModule: "agents", chatVisible: false },
  );
  const agentsParams = new URLSearchParams(agentsSearch);

  assert.equal(agentsParams.get("module"), "agents");
  assert.equal(agentsParams.get("agent"), "agent-old");
  assert.equal(agentsParams.get("chat"), "0");
  assert.equal(agentsParams.has("taskScope"), false);
  assert.equal(agentsParams.has("settings"), false);

  const chatParams = new URLSearchParams(workspaceSearchForLayout(agentsSearch, {
    activeModule: null,
    chatVisible: true,
  }));
  assert.equal(chatParams.has("agent"), false);
});

test("module locations preserve the Chat pathname and current layout posture", () => {
  const target = workspaceLocationForModule(
    "/s/space/channel/channel-1",
    "?module=tasks&taskScope=channel-2&chat=0&thread=thread-1",
    { moduleId: "agents", agent: "agent-1" },
  );
  const url = new URL(target, "http://kith-space.local");

  assert.equal(url.pathname, "/s/space/channel/channel-1");
  assert.equal(url.searchParams.get("module"), "agents");
  assert.equal(url.searchParams.get("agent"), "agent-1");
  assert.equal(url.searchParams.get("chat"), "0");
  assert.equal(url.searchParams.get("thread"), "thread-1");
  assert.equal(url.searchParams.has("taskScope"), false);
});

test("opening a module from Chat creates Split and selects its resource", () => {
  const tasksTarget = workspaceLocationForModule(
    "/s/space/channel/channel-1",
    "?msg=message-1",
    { moduleId: "tasks", taskScope: "space" },
  );
  const settingsTarget = workspaceLocationForModule(
    "/s/space/channel/channel-1",
    tasksTarget.slice(tasksTarget.indexOf("?")),
    { moduleId: "settings", settings: "human" },
  );
  const tasksUrl = new URL(tasksTarget, "http://kith-space.local");
  const settingsUrl = new URL(settingsTarget, "http://kith-space.local");

  assert.equal(tasksUrl.searchParams.get("module"), "tasks");
  assert.equal(tasksUrl.searchParams.get("taskScope"), "space");
  assert.equal(tasksUrl.searchParams.has("chat"), false);
  assert.equal(settingsUrl.searchParams.get("settings"), "human");
  assert.equal(settingsUrl.searchParams.has("taskScope"), false);
});

test("settings locations normalize retired and unknown resources to Human", () => {
  for (const resource of ["account", "unknown"]) {
    const target = workspaceLocationForModule(
      "/s/space/channel/channel-1",
      "?module=settings",
      { moduleId: "settings", settings: resource },
    );
    assert.equal(new URL(target, "http://kith-space.local").searchParams.get("settings"), "human");
  }
});

test("module resources are decoded only for their owning module", () => {
  const search = "?taskScope=channel-1&agent=agent-1&settings=desktop";

  assert.equal(workspaceModuleResourceFromSearch(search, "tasks"), "channel-1");
  assert.equal(workspaceModuleResourceFromSearch(search, "agents"), "agent-1");
  assert.equal(workspaceModuleResourceFromSearch(search, "settings"), "desktop");
  assert.equal(workspaceModuleResourceFromSearch(search, "inbox"), null);
});

test("conversation navigation keeps an open module in Split", () => {
  const target = mergeWorkspaceSearch(
    "/s/space/channel/ch-2?msg=message-1",
    "?module=tasks",
  );
  const search = target.slice(target.indexOf("?"));

  assert.equal(target.startsWith("/s/space/channel/ch-2?"), true);
  assert.equal(new URLSearchParams(search).get("msg"), "message-1");
  assert.equal(new URLSearchParams(search).get("module"), "tasks");
});

test("conversation changes keep shell state but discard old message focus", () => {
  const search = workspaceSearchForShellState(
    "?module=agents&agent=agent-1&agentTab=activity&thread=thread-1&msg=message-1&chat=0",
    { activeModule: "agents", chatVisible: false },
  );
  const params = new URLSearchParams(search);
  assert.equal(params.get("module"), "agents");
  assert.equal(params.get("agent"), "agent-1");
  assert.equal(params.get("agentTab"), "activity");
  assert.equal(params.get("chat"), "0");
  assert.equal(params.has("thread"), false);
  assert.equal(params.has("msg"), false);
});

test("conversation locations keep the active module resource and replace message focus", () => {
  const target = workspaceLocationForConversation(
    "/s/space/channel/ch-2?msg=message-2",
    "/s/space/channel/ch-1",
    "?module=tasks&taskScope=channel-1&thread=thread-1&msg=message-1&chat=0",
  );
  const url = new URL(target, "http://kith-space.local");

  assert.equal(url.pathname, "/s/space/channel/ch-2");
  assert.equal(url.searchParams.get("msg"), "message-2");
  assert.equal(url.searchParams.get("module"), "tasks");
  assert.equal(url.searchParams.get("taskScope"), "channel-1");
  assert.equal(url.searchParams.get("chat"), "0");
  assert.equal(url.searchParams.has("thread"), false);
});
