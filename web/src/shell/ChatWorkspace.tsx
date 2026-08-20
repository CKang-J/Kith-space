import { memo, useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useLocation } from "react-router-dom";
import { Chat } from "../views/Chat.tsx";
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
  headerTrailingAction?: ReactNode;
  aggregateDrawer?: ReactNode;
  aggregateDrawerOpen?: boolean;
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
  headerTrailingAction?: ReactNode;
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
  headerTrailingAction,
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
      headerTrailingAction={headerTrailingAction}
    />
  );
}

export const ChatWorkspace = memo(function ChatWorkspace({
  channelId,
  aggregateOpen,
  aggregateAvailable,
  aggregateToggleRef,
  onToggleAggregate,
  onOpenTasks,
  onOpenChannelSettings,
  onNavigateConversation,
  headerTrailingAction,
  aggregateDrawer,
  aggregateDrawerOpen = false,
  settingsDrawer,
  settingsDrawerOpen = false,
  style,
}: ChatWorkspaceProps) {
  const { pathname } = useLocation();
  const aggregateLayerRef = useRef<HTMLDivElement>(null);
  const settingsLayerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    aggregateLayerRef.current?.toggleAttribute("inert", !aggregateDrawerOpen);
  }, [aggregateDrawerOpen]);
  useEffect(() => {
    settingsLayerRef.current?.toggleAttribute("inert", !settingsDrawerOpen);
  }, [settingsDrawerOpen]);
  const openChannelSettings = (channelId: string, trigger?: HTMLButtonElement) => {
    onOpenChannelSettings(channelId, trigger);
  };

  return (
    <section
      className="shell-chat-workspace"
      style={style}
      aria-label="Chat 工作区"
    >
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
            headerTrailingAction={headerTrailingAction}
          />
        </div>
      </section>
      <div
        ref={aggregateLayerRef}
        className="shell-chat-aggregate-layer"
        data-open={aggregateDrawerOpen ? "true" : undefined}
        aria-hidden={!aggregateDrawerOpen}
      >
        <aside
          className="shell-chat-aggregate-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="聚合面板"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="shell-chat-aggregate-drawer__content">{aggregateDrawer}</div>
        </aside>
      </div>
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
});
