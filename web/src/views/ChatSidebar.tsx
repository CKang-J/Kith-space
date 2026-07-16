import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
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

export function ConversationDrawerSidebar({
  channelIdOverride,
  preserveSearch = "",
  onNavigate,
}: Omit<ChatSidebarProps, "moduleNavigation"> = {}) {
  const { t } = useTranslation();

  return (
    <aside className="sidebar conversation-drawer-sidebar">
      <div className="sb-scroll">
        <div className="sb-title">{t("nav.channel")}</div>
        <ConversationListContent
          channelIdOverride={channelIdOverride}
          preserveSearch={preserveSearch}
          onNavigate={onNavigate}
        />
      </div>
    </aside>
  );
}

export { CreateChannelModal, channelCreateErrorMsg } from "./ConversationListContent.tsx";
