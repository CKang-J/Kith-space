import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";

const WORKSPACE_PANEL_EXIT_MOTION_MS = 200;

interface WorkspaceSplitPaneProps {
  chat: ReactNode;
  workspace: ReactNode | null;
  workspaceOpen: boolean;
}

export function WorkspaceSplitPane({ chat, workspace, workspaceOpen }: WorkspaceSplitPaneProps) {
  const closeTimerRef = useRef<number | null>(null);
  const [renderedWorkspace, setRenderedWorkspace] = useState<ReactNode>(workspace);
  const [workspaceVisible, setWorkspaceVisible] = useState(workspaceOpen);
  const [workspaceResizing, setWorkspaceResizing] = useState(false);

  useEffect(() => {
    if (workspaceOpen) setRenderedWorkspace(workspace);
  }, [workspace, workspaceOpen]);

  useEffect(() => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    if (workspaceOpen) {
      const frame = window.requestAnimationFrame(() => setWorkspaceVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }
    setWorkspaceVisible(false);
    closeTimerRef.current = window.setTimeout(() => {
      setRenderedWorkspace(null);
      closeTimerRef.current = null;
    }, WORKSPACE_PANEL_EXIT_MOTION_MS);
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, [workspaceOpen]);

  useEffect(() => {
    if (!workspaceResizing) return;
    const stopResizing = () => setWorkspaceResizing(false);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);
    return () => {
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };
  }, [workspaceResizing]);

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="shell-workspace-split-pane min-w-0 flex-1 gap-0 overflow-hidden"
      data-workspace-open={workspaceVisible ? "true" : undefined}
      data-workspace-resizing={workspaceResizing ? "true" : undefined}
    >
      <ResizablePanel
        id="chat"
        defaultSize="38%"
        minSize={320}
        maxSize="58%"
        className="min-w-0 overflow-hidden"
      >
        <div className="flex h-full min-w-0 [&>.shell-chat-workspace]:!h-full [&>.shell-chat-workspace]:!min-w-0 [&>.shell-chat-workspace]:!flex-1 [&>.shell-chat-workspace]:!border-r-0">
          {chat}
        </div>
      </ResizablePanel>
      <ResizableHandle
        aria-label="调整聊天区域与工作区宽度"
        disabled={!workspaceVisible}
        onPointerDown={() => setWorkspaceResizing(true)}
        className={cn(
          "shell-workspace-split-handle shrink-0 cursor-col-resize bg-transparent after:w-2 hover:bg-border focus-visible:bg-ring/40",
          workspaceVisible ? "w-1" : "pointer-events-none w-0 opacity-0",
        )}
      />
      <ResizablePanel
        id="workspace"
        minSize={360}
        className="min-w-0 overflow-hidden"
        inert={!workspaceOpen}
        aria-hidden={!workspaceOpen}
      >
        <div className="h-full min-w-0 [&>.shell-tab-workspace]:h-full">
          {renderedWorkspace}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
