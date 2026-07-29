import type { ReactNode } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

interface WorkspaceSplitPaneProps {
  chat: ReactNode;
  workspace: ReactNode;
}

export function WorkspaceSplitPane({ chat, workspace }: WorkspaceSplitPaneProps) {
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="min-w-0 flex-1 gap-0 overflow-hidden"
    >
      <ResizablePanel
        id="chat"
        defaultSize="38%"
        minSize={320}
        maxSize="58%"
        className="min-w-0 overflow-hidden"
      >
        <div className="h-full min-w-0 [&>.shell-chat-workspace]:!h-full [&>.shell-chat-workspace]:!w-full [&>.shell-chat-workspace]:!flex-auto [&>.shell-chat-workspace]:!border-r-0">
          {chat}
        </div>
      </ResizablePanel>
      <ResizableHandle
        aria-label="调整聊天区域与工作区宽度"
        className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors duration-150 after:w-2 hover:bg-border focus-visible:bg-ring/40"
      />
      <ResizablePanel id="workspace" minSize={360} className="min-w-0 overflow-hidden">
        <div className="h-full min-w-0 [&>.shell-tab-workspace]:h-full">
          {workspace}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
