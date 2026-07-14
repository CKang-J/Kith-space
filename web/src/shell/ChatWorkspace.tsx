import { X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useLocation } from "react-router-dom";
import { Chat } from "../views/Chat.tsx";
import { ChatSidebar } from "../views/ChatSidebar.tsx";
import { Showcase } from "../views/Showcase.tsx";
import { Saved } from "../views/misc.tsx";

interface ChatWorkspaceProps {
  channelId: string | null;
  compact: boolean;
  threadOnly: boolean;
  layoutSearch: string;
  aggregateOpen: boolean;
  aggregateAvailable: boolean;
  aggregateToggleRef: RefObject<HTMLButtonElement>;
  onToggleAggregate(): void;
  onOpenTasks(conversationId: string): void;
  dock?: ReactNode;
  style?: CSSProperties;
}

interface ChatSurfaceProps {
  pathname: string;
  channelId: string | null;
  threadOnly: boolean;
  conversationListOpen: boolean;
  conversationToggleRef: RefObject<HTMLButtonElement>;
  aggregateOpen: boolean;
  aggregateAvailable: boolean;
  aggregateToggleRef: RefObject<HTMLButtonElement>;
  onToggleConversationList(): void;
  onToggleAggregate(): void;
  onOpenTasks(conversationId: string): void;
}

function ChatSurface({
  pathname,
  channelId,
  threadOnly,
  conversationListOpen,
  conversationToggleRef,
  aggregateOpen,
  aggregateAvailable,
  aggregateToggleRef,
  onToggleConversationList,
  onToggleAggregate,
  onOpenTasks,
}: ChatSurfaceProps) {
  if (/\/saved\/?$/.test(pathname)) return <Saved embedded />;
  if (/\/showcase\/?$/.test(pathname)) return <Showcase embedded />;
  return (
    <Chat
      embedded
      channelIdOverride={channelId ?? undefined}
      threadOnly={threadOnly}
      conversationListOpen={conversationListOpen}
      conversationToggleRef={conversationToggleRef}
      aggregateOpen={aggregateOpen}
      aggregateAvailable={aggregateAvailable}
      aggregateToggleRef={aggregateToggleRef}
      onToggleConversationList={onToggleConversationList}
      onToggleAggregate={onToggleAggregate}
      onOpenTasks={onOpenTasks}
    />
  );
}

export function ChatWorkspace({
  channelId,
  compact,
  threadOnly,
  layoutSearch,
  aggregateOpen,
  aggregateAvailable,
  aggregateToggleRef,
  onToggleAggregate,
  onOpenTasks,
  dock,
  style,
}: ChatWorkspaceProps) {
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [conversationsCollapsed, setConversationsCollapsed] = useState(false);
  const conversationsTriggerRef = useRef<HTMLButtonElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const drawerWasOpenRef = useRef(false);

  useEffect(() => setDrawerOpen(false), [pathname, channelId, compact]);
  useEffect(() => {
    if (!drawerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [drawerOpen]);
  useEffect(() => {
    if (drawerOpen) {
      drawerWasOpenRef.current = true;
      const frame = window.requestAnimationFrame(() => drawerCloseRef.current?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
    if (!drawerWasOpenRef.current) return;
    drawerWasOpenRef.current = false;
    if (compact) conversationsTriggerRef.current?.focus();
  }, [compact, drawerOpen]);

  const conversationListOpen = compact ? drawerOpen : !conversationsCollapsed;
  const toggleConversationList = () => {
    if (compact) setDrawerOpen((open) => !open);
    else setConversationsCollapsed((collapsed) => !collapsed);
  };

  return (
    <section
      className={`shell-chat-workspace shell-chat-workspace--${compact ? "compact shell-work-panel" : "full"}`}
      data-conversations-collapsed={!compact && conversationsCollapsed ? "true" : undefined}
      style={style}
      aria-label={compact ? "紧凑 Chat 工作区" : "Chat 工作区"}
    >
      <aside className="shell-work-panel shell-chat-conversations" aria-label="会话列表">
        <ChatSidebar channelIdOverride={channelId ?? undefined} />
      </aside>
      <section className="shell-work-panel shell-chat-main-card" aria-label="当前会话">
        <div className="shell-chat-surface">
          <ChatSurface
            pathname={pathname}
            channelId={channelId}
            threadOnly={threadOnly}
            conversationListOpen={conversationListOpen}
            conversationToggleRef={conversationsTriggerRef}
            aggregateOpen={aggregateOpen}
            aggregateAvailable={aggregateAvailable}
            aggregateToggleRef={aggregateToggleRef}
            onToggleConversationList={toggleConversationList}
            onToggleAggregate={onToggleAggregate}
            onOpenTasks={onOpenTasks}
          />
        </div>
        {dock ? <footer className="shell-dock-zone">{dock}</footer> : null}
      </section>
      {drawerOpen ? (
        <div className="shell-chat-drawer-scrim" role="presentation" onMouseDown={() => setDrawerOpen(false)}>
          <aside
            className="shell-chat-drawer shell-chat-drawer--conversations"
            role="dialog"
            aria-modal="true"
            aria-label="会话抽屉"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button ref={drawerCloseRef} className="shell-chat-drawer__close" type="button" aria-label="关闭会话抽屉" onClick={() => setDrawerOpen(false)}>
              <X size={16} />
            </button>
            <ChatSidebar channelIdOverride={channelId ?? undefined} preserveSearch={layoutSearch} />
          </aside>
        </div>
      ) : null}
    </section>
  );
}
