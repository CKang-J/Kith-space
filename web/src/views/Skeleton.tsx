// Loading skeletons mirror the current single-window workspace while data bootstraps or a Space switches.
// Placeholder blocks use a restrained shimmer that is disabled under prefers-reduced-motion in styles.css.
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { ChatMessageItem, MessageHeader } from "./chat-message/ChatMessageItem.tsx";

const WORKSPACE_MODULES = new Set(["inbox", "tasks", "agents", "settings", "search"]);

// One placeholder message row: avatar block plus name and body lines of varied width.
function SkelMsg({ w }: { w: string }) {
  return (
    <ChatMessageItem
      surface="agent"
      className="skel-msg"
      avatar={<div className="skel-box skel-ava" />}
      header={<MessageHeader sender={<div className="skel-box skel-line skel-line-name" />} />}
    >
      <div className="skel-box skel-line" style={{ width: w }} />
    </ChatMessageItem>
  );
}

const MSG_WIDTHS = ["72%", "54%", "83%", "61%", "44%", "77%"];

// Reused by the workspace skeleton and by Chat while a channel's messages load.
export function ChatSkeleton() {
  return (
    <div className="skel-msgs" aria-hidden="true">
      {MSG_WIDTHS.map((w, i) => <SkelMsg key={i} w={w} />)}
    </div>
  );
}

function TopBarSkeleton() {
  return (
    <header className="shell-topbar skel-topbar" aria-hidden="true">
      <div className="skel-box skel-topbar-brand" />
      <div className="skel-box skel-topbar-space" />
      <div className="skel-box skel-topbar-context" />
      <div className="shell-topbar__spacer" />
    </header>
  );
}

function DockSkeleton() {
  return (
    <footer className="shell-dock-zone skel-dock-zone" aria-hidden="true">
      <div className="workspace-dock skel-dock">
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skel-box skel-dock-item" />)}
      </div>
    </footer>
  );
}

function ConversationListSkeleton() {
  return (
    <aside className="shell-work-panel shell-chat-conversations skel-conversations" aria-hidden="true">
      <div className="skel-box skel-panel-title" />
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="skel-box skel-panel-line" style={{ width: `${72 - (i % 3) * 12}%` }} />
      ))}
    </aside>
  );
}

function TraceSkeleton() {
  return (
    <aside className="shell-work-panel shell-chat-trace skel-trace" aria-hidden="true">
      <div className="skel-box skel-panel-title" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="skel-box skel-panel-line" style={{ width: `${80 - i * 9}%` }} />
      ))}
    </aside>
  );
}

function ChatPanelSkeleton({ compact, dock }: { compact: boolean; dock: boolean }) {
  if (compact) {
    return (
      <section className="shell-work-panel shell-chat-workspace shell-chat-workspace--compact skel-chat-compact">
        <header className="shell-chat-compact-tools skel-chat-compact-tools" aria-hidden="true">
          <div className="skel-box skel-compact-action" />
          <div className="skel-box skel-compact-title" />
          <div className="skel-box skel-compact-action" />
        </header>
        <div className="skel-chat-scroll"><ChatSkeleton /></div>
      </section>
    );
  }

  return (
    <section className="shell-chat-workspace shell-chat-workspace--full skel-chat-full">
      <ConversationListSkeleton />
      <section className="shell-work-panel shell-chat-main-card skel-chat-main">
        <div className="skel-chat-head" aria-hidden="true"><div className="skel-box skel-chat-title" /></div>
        <div className="skel-chat-scroll"><ChatSkeleton /></div>
        {dock ? <DockSkeleton /> : null}
      </section>
      <TraceSkeleton />
    </section>
  );
}

function ModulePanelSkeleton({ dock }: { dock: boolean }) {
  return (
    <section className="shell-work-panel shell-module-workspace skel-module-panel">
      <div className="skel-module-content" aria-hidden="true">
        <aside className="skel-module-sidebar">
          <div className="skel-box skel-panel-title" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skel-box skel-panel-line" style={{ width: `${76 - (i % 2) * 15}%` }} />
          ))}
        </aside>
        <div className="skel-module-main">
          <div className="skel-box skel-module-title" />
          <div className="skel-box skel-module-card" />
          <div className="skel-box skel-module-card skel-module-card--short" />
        </div>
      </div>
      {dock ? <DockSkeleton /> : null}
    </section>
  );
}

// A root/channel bootstrap is ChatOnly. A legal module query mirrors Split or ModuleOnly without mounting product data.
export function WorkspaceSkeleton({ chat = false }: { chat?: boolean }) {
  const { t } = useTranslation();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const requestedModule = params.get("module");
  const activeModule = !chat && requestedModule && WORKSPACE_MODULES.has(requestedModule)
    ? requestedModule
    : null;
  const chatVisible = activeModule === null || params.get("chat") !== "0";
  const mode = activeModule === null ? "chat-only" : chatVisible ? "split" : "module-only";

  return (
    <main
      className="shell-workspace-frame skel-workspace"
      data-layout-mode={mode}
      data-visual-mode={mode}
      role="status"
      aria-busy="true"
      aria-label={t("common.loadingWorkspace")}
    >
      <TopBarSkeleton />
      <div className="shell-workspace-canvas skel-workspace-canvas">
        {chatVisible ? <ChatPanelSkeleton compact={mode === "split"} dock={mode === "chat-only"} /> : null}
        {mode === "split" ? <div className="shell-drag-divider skel-divider" aria-hidden="true" /> : null}
        {activeModule ? <ModulePanelSkeleton dock /> : null}
      </div>
    </main>
  );
}
