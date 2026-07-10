import { Activity, MessagesSquare, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Chat } from "../views/Chat.tsx";
import { ChatSidebar } from "../views/ChatSidebar.tsx";
import { LiveTrace } from "../views/LiveTrace.tsx";
import { Showcase } from "../views/Showcase.tsx";
import { Saved } from "../views/misc.tsx";

type ChatDrawer = "conversations" | "trace" | null;

interface ChatWorkspaceProps {
  channelId: string | null;
  compact: boolean;
  layoutSearch: string;
  dock?: ReactNode;
}

function ChatSurface({ pathname, channelId }: { pathname: string; channelId: string | null }) {
  if (/\/saved\/?$/.test(pathname)) return <Saved embedded />;
  if (/\/showcase\/?$/.test(pathname)) return <Showcase embedded />;
  return <Chat embedded channelIdOverride={channelId ?? undefined} />;
}

export function ChatWorkspace({ channelId, compact, layoutSearch, dock }: ChatWorkspaceProps) {
  const { pathname } = useLocation();
  const [drawer, setDrawer] = useState<ChatDrawer>(null);
  const conversationsTriggerRef = useRef<HTMLButtonElement>(null);
  const traceTriggerRef = useRef<HTMLButtonElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const lastDrawerRef = useRef<Exclude<ChatDrawer, null>>("conversations");
  const drawerWasOpenRef = useRef(false);
  const toggleDrawer = (next: Exclude<ChatDrawer, null>) => {
    lastDrawerRef.current = next;
    setDrawer((current) => current === next ? null : next);
  };

  useEffect(() => setDrawer(null), [pathname, channelId, compact]);
  useEffect(() => {
    if (!drawer) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawer(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [drawer]);
  useEffect(() => {
    if (drawer) {
      drawerWasOpenRef.current = true;
      const frame = window.requestAnimationFrame(() => drawerCloseRef.current?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
    if (!drawerWasOpenRef.current) return;
    drawerWasOpenRef.current = false;
    if (!compact) return;
    const trigger = lastDrawerRef.current === "conversations" ? conversationsTriggerRef : traceTriggerRef;
    trigger.current?.focus();
  }, [compact, drawer]);

  if (!compact) {
    return (
      <section className="shell-chat-workspace shell-chat-workspace--full" aria-label="Chat 工作区">
        <aside className="shell-work-panel shell-chat-conversations" aria-label="会话列表">
          <ChatSidebar channelIdOverride={channelId ?? undefined} />
        </aside>
        <section className="shell-work-panel shell-chat-main-card" aria-label="当前会话">
          <div className="shell-chat-surface">
            <ChatSurface pathname={pathname} channelId={channelId} />
          </div>
          {dock ? <footer className="shell-dock-zone">{dock}</footer> : null}
        </section>
        <aside className="shell-work-panel shell-chat-trace" aria-label="实时轨迹">
          <LiveTrace />
        </aside>
      </section>
    );
  }

  return (
    <section className="shell-work-panel shell-chat-workspace shell-chat-workspace--compact" aria-label="紧凑 Chat 工作区">
      <header className="shell-chat-compact-tools">
        <button
          ref={conversationsTriggerRef}
          type="button"
          className={drawer === "conversations" ? "is-active" : ""}
          aria-pressed={drawer === "conversations"}
          onClick={() => toggleDrawer("conversations")}
        >
          <MessagesSquare size={16} />
          <span>会话</span>
        </button>
        <span className="shell-chat-compact-tools__title">Chat</span>
        <button
          ref={traceTriggerRef}
          type="button"
          className={drawer === "trace" ? "is-active" : ""}
          aria-pressed={drawer === "trace"}
          onClick={() => toggleDrawer("trace")}
        >
          <Activity size={16} />
          <span>轨迹</span>
        </button>
      </header>
      <div className="shell-chat-surface">
        <ChatSurface pathname={pathname} channelId={channelId} />
      </div>
      {drawer ? (
        <div className="shell-chat-drawer-scrim" role="presentation" onMouseDown={() => setDrawer(null)}>
          <aside
            className={`shell-chat-drawer shell-chat-drawer--${drawer}`}
            role="dialog"
            aria-modal="true"
            aria-label={drawer === "conversations" ? "会话抽屉" : "实时轨迹抽屉"}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button ref={drawerCloseRef} className="shell-chat-drawer__close" type="button" aria-label="关闭抽屉" onClick={() => setDrawer(null)}>
              <X size={16} />
            </button>
            {drawer === "conversations" ? (
              <ChatSidebar channelIdOverride={channelId ?? undefined} preserveSearch={layoutSearch} />
            ) : (
              <div className="shell-chat-drawer__trace"><LiveTrace /></div>
            )}
          </aside>
        </div>
      ) : null}
    </section>
  );
}
