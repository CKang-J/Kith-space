import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeWorkspaceSearch, parseWorkspaceRoute, workspaceLayoutFromRoute, workspaceSearchForLayout } from "./workspaceRoute.ts";

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

test("maps detail routes to their workspace module", () => {
  assert.deepEqual(parseWorkspaceRoute("/s/space/agent/agent-1"), {
    section: "agent",
    resourceId: "agent-1",
    moduleId: "agents",
    isChatRoute: false,
    isChannelRoute: false,
  });
  assert.equal(parseWorkspaceRoute("/s/space/human/user-1").moduleId, null);
  assert.equal(parseWorkspaceRoute("/s/space/computer/machine-1").moduleId, null);
  assert.equal(parseWorkspaceRoute("/s/space/settings/notifications").moduleId, "settings");
  assert.equal(parseWorkspaceRoute("/s/space/tasks/server").moduleId, "tasks");
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

test("legacy module paths remain valid URL entry points", () => {
  const tasks = parseWorkspaceRoute("/s/space/tasks");
  assert.deepEqual(workspaceLayoutFromRoute(tasks, ""), {
    activeModule: "tasks",
    chatVisible: true,
  });
  assert.deepEqual(workspaceLayoutFromRoute(tasks, "?chat=0"), {
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
