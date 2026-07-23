import type { ReactNode } from "react";
import { LiveAgentBar } from "./LiveAgentBar.tsx";
import { ConversationListContent } from "./ConversationListContent.tsx";

interface ChatSidebarProps {
  channelIdOverride?: string;
  preserveSearch?: string;
  onNavigate?(target: string): void;
  moduleNavigation?: ReactNode;
}

export function ChatSidebar({
  channelIdOverride,
  preserveSearch = "",
  onNavigate,
  moduleNavigation,
}: ChatSidebarProps = {}) {
  return (
    <aside className="sidebar chat-navigation-sidebar">
      <div className="sb-scroll">
        {moduleNavigation}
        <ConversationListContent
          channelIdOverride={channelIdOverride}
          preserveSearch={preserveSearch}
          onNavigate={onNavigate}
        />
      </div>
      <LiveAgentBar />
    </aside>
  );
}

export { CreateChannelModal, channelCreateErrorMsg } from "./ConversationListContent.tsx";
