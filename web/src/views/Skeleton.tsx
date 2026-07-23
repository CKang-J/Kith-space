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

function SidebarContextSkeleton() {
  return (
    <div className="skel-sidebar-context">
      <div className="skel-box skel-sidebar-context-brand" />
      <div className="skel-box skel-sidebar-context-space" />
      <div className="skel-box skel-sidebar-context-current" />
    </div>
  );
}

function ConversationListSkeleton() {
  return (
    <aside className="shell-work-panel shell-chat-conversations skel-conversations" aria-hidden="true">
      <SidebarContextSkeleton />
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

function ChatPanelSkeleton() {
  return (
    <section className="shell-chat-workspace shell-chat-workspace--full skel-chat-full">
      <ConversationListSkeleton />
      <section className="shell-work-panel shell-primary-workspace-card shell-chat-main-card skel-chat-main">
        <div className="skel-chat-head" aria-hidden="true"><div className="skel-box skel-chat-title" /></div>
        <div className="skel-chat-scroll"><ChatSkeleton /></div>
      </section>
      <TraceSkeleton />
    </section>
  );
}

function ModulePanelSkeleton() {
  return (
    <section className="shell-work-panel shell-primary-workspace-card shell-module-workspace skel-module-panel">
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
    </section>
  );
}

// A root/channel bootstrap mirrors the persistent sidebar plus either Chat or one selected module.
export function WorkspaceSkeleton({ chat = false }: { chat?: boolean }) {
  const { t } = useTranslation();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const requestedModule = params.get("module");
  const activeModule = !chat && requestedModule && WORKSPACE_MODULES.has(requestedModule)
    ? requestedModule
    : null;
  const contentModule = activeModule && activeModule !== "settings" ? activeModule : null;
  const mode = contentModule ? "module-only" : "chat-only";

  return (
    <main
      className="shell-workspace-frame skel-workspace"
      data-layout-mode={mode}
      data-visual-mode={mode}
      role="status"
      aria-busy="true"
      aria-label={t("common.loadingWorkspace")}
    >
      <div className="shell-workspace-canvas skel-workspace-canvas">
        {contentModule ? <ConversationListSkeleton /> : null}
        {contentModule ? <ModulePanelSkeleton /> : <ChatPanelSkeleton />}
      </div>
    </main>
  );
}
