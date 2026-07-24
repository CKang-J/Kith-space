import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const navigationSources = [
  "./ModuleWorkspace.tsx",
  "../QuickSwitcher.tsx",
  "../views/Chat.tsx",
  "../views/ChatSidebar.tsx",
  "../views/LiveAgentBar.tsx",
  "../views/Members.tsx",
  "../views/misc.tsx",
  "../TaskBoard.tsx",
];

test("workspace UI does not generate legacy module entity paths", () => {
  for (const relativePath of navigationSources) {
    const source = fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.equal(source.includes("/s/${slug}/tasks"), false, relativePath);
    assert.equal(source.includes("/s/${slug}/agent"), false, relativePath);
    assert.equal(source.includes("/s/${slug}/settings"), false, relativePath);
  }
});

test("conversation navigation consumers preserve the active module query", () => {
  const directConversationNavigationSources = [
    "../views/Chat.tsx",
    "../views/LiveAgentBar.tsx",
    "../views/misc.tsx",
    "../TaskBoard.tsx",
  ];
  for (const relativePath of directConversationNavigationSources) {
    const source = fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.match(source, /workspaceLocationForConversation/, relativePath);
    assert.doesNotMatch(source, /nav\(`\/s\/\$\{slug\}\/channel/, relativePath);
  }

  const frame = fs.readFileSync(new URL("./WorkspaceFrame.tsx", import.meta.url), "utf8");
  assert.match(frame, /workspaceSearchForShellState\(location\.search, layoutState\)/);
});

test("opening a content module closes the aggregate panel", () => {
  const frame = fs.readFileSync(new URL("./WorkspaceFrame.tsx", import.meta.url), "utf8");

  assert.match(
    frame,
    /next\.activeModule !== null && next\.activeModule !== "settings"\) setAggregateOpen\(false\);/,
  );
});
