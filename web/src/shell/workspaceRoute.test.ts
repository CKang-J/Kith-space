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
  assert.equal(parseWorkspaceRoute("/s/kith-space/showcase").isChatRoute, false);
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

test("retired Showcase paths keep valid module state for client normalization", () => {
  const retired = parseWorkspaceRoute("/s/space/showcase");
  assert.equal(retired.isChatRoute, false);
  assert.deepEqual(workspaceLayoutFromRoute(retired, "?module=tasks&taskScope=channel-1&chat=0"), {
    activeModule: "tasks",
    chatVisible: false,
  });
  assert.equal(
    workspaceSearchForShellState("?module=tasks&taskScope=channel-1&chat=0", { activeModule: "tasks", chatVisible: false }),
    "?module=tasks&chat=0&taskScope=channel-1",
  );
});

test("URL derives one canonical presentation for each module", () => {
  const channel = parseWorkspaceRoute("/s/space/channel/ch-1");

  assert.deepEqual(workspaceLayoutFromRoute(channel, "?module=tasks"), {
    activeModule: "tasks",
    chatVisible: false,
  });
  assert.deepEqual(workspaceLayoutFromRoute(channel, "?module=tasks&chat=0"), {
    activeModule: "tasks",
    chatVisible: false,
  });
  assert.deepEqual(workspaceLayoutFromRoute(channel, "?chat=0"), {
    activeModule: null,
    chatVisible: true,
  });
  assert.deepEqual(workspaceLayoutFromRoute(channel, "?module=spaces"), {
    activeModule: "spaces",
    chatVisible: false,
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

test("layout search preserves non-layout conversation state and canonicalizes module presentation", () => {
  const moduleSearch = workspaceSearchForLayout("?thread=thread-1", {
    activeModule: "agents",
    chatVisible: true,
  });
  const moduleOnlySearch = workspaceSearchForLayout(moduleSearch, {
    activeModule: "agents",
    chatVisible: false,
  });
  const chatSearch = workspaceSearchForLayout(moduleOnlySearch, {
    activeModule: null,
    chatVisible: true,
  });

  assert.equal(new URLSearchParams(moduleSearch).get("module"), "agents");
  assert.equal(new URLSearchParams(moduleSearch).get("chat"), "0");
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

test("module locations preserve the Chat pathname and use the canonical module posture", () => {
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

test("opening content replaces Chat while settings opens over Chat", () => {
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
  assert.equal(tasksUrl.searchParams.get("chat"), "0");
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

test("settings locations preserve the installation-level Memory Advisor resource", () => {
  const target = workspaceLocationForModule("/s/home/channel/all", "", { moduleId: "settings", settings: "advisor" });
  assert.equal(new URL(target, "http://kith-space.local").searchParams.get("settings"), "advisor");
});

test("settings locations preserve model and runtime control-plane resources", () => {
  for (const resource of ["models", "runtimes"]) {
    const target = workspaceLocationForModule(
      "/s/home/channel/all",
      "",
      { moduleId: "settings", settings: resource },
    );
    assert.equal(new URL(target, "http://kith-space.local").searchParams.get("settings"), resource);
  }
});

test("settings locations preserve the appearance resource", () => {
  const target = workspaceLocationForModule(
    "/s/home/channel/all",
    "?module=settings&settings=human",
    { moduleId: "settings", settings: "appearance" },
  );
  assert.equal(new URL(target, "http://kith-space.local").searchParams.get("settings"), "appearance");
});

test("module resources are decoded only for their owning module", () => {
  const search = "?taskScope=channel-1&agent=agent-1&settings=desktop";

  assert.equal(workspaceModuleResourceFromSearch(search, "tasks"), "channel-1");
  assert.equal(workspaceModuleResourceFromSearch(search, "agents"), "agent-1");
  assert.equal(workspaceModuleResourceFromSearch(search, "settings"), "desktop");
  assert.equal(workspaceModuleResourceFromSearch(search, "inbox"), null);
});

test("conversation navigation preserves the active content module", () => {
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
