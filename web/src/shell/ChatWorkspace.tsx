import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useLocation } from "react-router-dom";
import { Chat } from "../views/Chat.tsx";
import { ChatSidebar } from "../views/ChatSidebar.tsx";
import { Saved } from "../views/misc.tsx";

interface ChatWorkspaceProps {
  channelId: string | null;
  aggregateOpen: boolean;
  aggregateAvailable: boolean;
  aggregateToggleRef: RefObject<HTMLButtonElement | null>;
  onToggleAggregate(): void;
  onOpenTasks(conversationId: string): void;
  onOpenChannelSettings(channelId: string, trigger?: HTMLButtonElement): void;
  onNavigateConversation(target: string): void;
  settingsDrawer?: ReactNode;
  settingsDrawerOpen?: boolean;
  style?: CSSProperties;
}

interface ChatSurfaceProps {
  pathname: string;
  channelId: string | null;
  aggregateOpen: boolean;
  aggregateAvailable: boolean;
  aggregateToggleRef: RefObject<HTMLButtonElement | null>;
  onToggleAggregate(): void;
  onOpenTasks(conversationId: string): void;
  onOpenChannelSettings(channelId: string, trigger?: HTMLButtonElement): void;
  onNavigateConversation(target: string): void;
}

function ChatSurface({
  pathname,
  channelId,
  aggregateOpen,
  aggregateAvailable,
  aggregateToggleRef,
  onToggleAggregate,
  onOpenTasks,
  onOpenChannelSettings,
  onNavigateConversation,
}: ChatSurfaceProps) {
  if (/\/saved\/?$/.test(pathname)) return <Saved embedded />;
  return (
    <Chat
      embedded
      channelIdOverride={channelId ?? undefined}
      threadOnly={false}
      conversationListOpen
      aggregateOpen={aggregateOpen}
      aggregateAvailable={aggregateAvailable}
      aggregateToggleRef={aggregateToggleRef}
      onToggleAggregate={onToggleAggregate}
      onOpenTasks={onOpenTasks}
      onOpenChannelSettings={onOpenChannelSettings}
      onNavigateConversation={onNavigateConversation}
    />
  );
}

export function ChatWorkspace({
  channelId,
  aggregateOpen,
  aggregateAvailable,
  aggregateToggleRef,
  onToggleAggregate,
  onOpenTasks,
  onOpenChannelSettings,
  onNavigateConversation,
  settingsDrawer,
  settingsDrawerOpen = false,
  style,
}: ChatWorkspaceProps) {
  const { pathname } = useLocation();
  const settingsLayerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    settingsLayerRef.current?.toggleAttribute("inert", !settingsDrawerOpen);
  }, [settingsDrawerOpen]);
  const openChannelSettings = (channelId: string, trigger?: HTMLButtonElement) => {
    onOpenChannelSettings(channelId, trigger);
  };

  return (
    <section
      className="shell-chat-workspace shell-chat-workspace--full"
      style={style}
      aria-label="Chat 工作区"
    >
      <div className="shell-work-panel shell-chat-conversations" aria-label="会话列表">
        <ChatSidebar channelIdOverride={channelId ?? undefined} onNavigate={onNavigateConversation} />
      </div>
      <section className="shell-work-panel shell-primary-workspace-card shell-chat-main-card" aria-label="当前会话">
        <div className="shell-chat-surface">
          <ChatSurface
            pathname={pathname}
            channelId={channelId}
            aggregateOpen={aggregateOpen}
            aggregateAvailable={aggregateAvailable}
            aggregateToggleRef={aggregateToggleRef}
            onToggleAggregate={onToggleAggregate}
            onOpenTasks={onOpenTasks}
            onOpenChannelSettings={openChannelSettings}
            onNavigateConversation={onNavigateConversation}
          />
        </div>
      </section>
      <div
        ref={settingsLayerRef}
        className="shell-chat-settings-layer"
        data-open={settingsDrawerOpen ? "true" : undefined}
        aria-hidden={!settingsDrawerOpen}
      >
        <aside
          className="shell-chat-settings-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="频道设置"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="shell-chat-settings-drawer__content">{settingsDrawer}</div>
        </aside>
      </div>
    </section>
  );
}
