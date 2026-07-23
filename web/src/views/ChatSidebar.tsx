import { LiveAgentBar } from "./LiveAgentBar.tsx";
import { ConversationListContent } from "./ConversationListContent.tsx";
import { useTranslation } from "react-i18next";

interface ChatSidebarProps {
  channelIdOverride?: string;
  preserveSearch?: string;
  onNavigate?(target: string): void;
}

export function ChatSidebar({
  channelIdOverride,
  preserveSearch = "",
  onNavigate,
}: ChatSidebarProps = {}) {
  const { t } = useTranslation();

  return (
    <aside className="sidebar chat-navigation-sidebar">
      <div className="chat-navigation-sidebar__header">
        <h2>{t("nav.messages")}</h2>
      </div>
      <div className="sb-scroll chat-navigation-sidebar__scroll">
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
