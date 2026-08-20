import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const frame = read("../web/src/shell/WorkspaceFrame.tsx");
const splitPane = read("../web/src/shell/WorkspaceSplitPane.tsx");
const shellCss = read("../web/src/shell/shell.css");

test("module workspaces use an accessible resizable split without duplicating chat", () => {
  assert.match(frame, /const chatWorkspace = \([\s\S]*?<ChatWorkspace/);
  assert.match(frame, /const tabWorkspace = activeTab && contentModuleId \? \(/);
  assert.match(frame, /<WorkspaceSplitPane[\s\S]*?workspace=\{tabWorkspace\}[\s\S]*?workspaceOpen=\{!!tabWorkspace\}/);
  assert.match(splitPane, /<ResizablePanelGroup[\s\S]*?orientation="horizontal"/);
  assert.match(splitPane, /defaultSize="38%"/);
  assert.match(splitPane, /minSize=\{320\}/);
  assert.match(splitPane, /maxSize="58%"/);
  assert.match(splitPane, /const \[workspaceVisible, setWorkspaceVisible\] = useState\(workspaceOpen\)/);
  assert.match(splitPane, /const \[workspaceResizing, setWorkspaceResizing\] = useState\(false\)/);
  assert.match(splitPane, /window\.addEventListener\("pointerup", stopResizing\)/);
  assert.match(splitPane, /requestAnimationFrame\(\(\) => setWorkspaceVisible\(true\)\)/);
  assert.match(splitPane, /data-workspace-open=\{workspaceVisible \? "true" : undefined\}/);
  assert.match(splitPane, /data-workspace-resizing=\{workspaceResizing \? "true" : undefined\}/);
  assert.match(splitPane, /WORKSPACE_PANEL_EXIT_MOTION_MS = 200/);
  assert.match(splitPane, /shell-workspace-split-handle/);
  assert.match(splitPane, /setRenderedWorkspace\(null\)/);
  assert.match(splitPane, /inert=\{!workspaceOpen\}/);
  assert.match(splitPane, /<ResizableHandle[\s\S]*?aria-label="调整聊天区域与工作区宽度"/);
  assert.match(splitPane, /onPointerDown=\{\(\) => setWorkspaceResizing\(true\)\}/);
  assert.match(splitPane, /cursor-col-resize/);
  assert.match(splitPane, /<ResizablePanel[\s\S]*?id="workspace"[\s\S]*?minSize=\{360\}/);
  assert.match(shellCss, /--shell-workspace-enter-motion-duration: 400ms/);
  assert.match(shellCss, /--shell-workspace-exit-motion-duration: 200ms/);
  assert.match(shellCss, /\.shell-workspace-split-pane\[data-workspace-resizing="true"\][\s\S]*?transition: none/);
  assert.doesNotMatch(shellCss, /shell-workspace-panel-content|clip-path: inset\(0 100% 0 0\)/);
});
