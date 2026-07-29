import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const frame = read("../web/src/shell/WorkspaceFrame.tsx");
const splitPane = read("../web/src/shell/WorkspaceSplitPane.tsx");

test("module workspaces use an accessible resizable split without duplicating chat", () => {
  assert.match(frame, /const chatWorkspace = \([\s\S]*?<ChatWorkspace/);
  assert.match(frame, /const tabWorkspace = activeTab && contentModuleId \? \(/);
  assert.match(frame, /<WorkspaceSplitPane chat=\{chatWorkspace\} workspace=\{tabWorkspace\} \/>/);
  assert.match(splitPane, /<ResizablePanelGroup[\s\S]*?orientation="horizontal"/);
  assert.match(splitPane, /defaultSize="38%"/);
  assert.match(splitPane, /minSize=\{320\}/);
  assert.match(splitPane, /maxSize="58%"/);
  assert.match(splitPane, /<ResizableHandle[\s\S]*?aria-label="调整聊天区域与工作区宽度"/);
  assert.match(splitPane, /cursor-col-resize/);
  assert.match(splitPane, /<ResizablePanel id="workspace" minSize=\{360\}/);
});
