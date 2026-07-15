// Static, read-only Showcase page — four real-looking collaboration sessions rendered entirely
// client-side from web/src/showcaseData.ts. Zero API, zero live agents, zero DB channel: the demo
// is built into the frontend so every visitor sees it identically.
//
// Form mirrors the real product (Chat.tsx): the channel shows one human "task" anchor per case with a
// task badge + attachment + a "💬 N replies" topic summary; clicking it opens the case's thread in a
// right-side panel (the agents' collaboration = how that task got done). Nothing is flattened.
//
// Reuses the Chat message presentation (ChatMessageItem / MessageHeader / .mbody / .msg-meta /
// .task-pill / .message-topic-preview / .thread-panel / Avatar / MessageContent). Agent avatars/names are
// intentionally NON-clickable and trigger no profile/API: the old DB-channel showcase leaked host details and
// skills on avatar click, so this static page never makes an avatar interactive. Thread open/close is pure
// useState over static data — never openThread/startThread (those hit the server).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, CheckCircle2, X } from "lucide-react";
import { Avatar } from "../Avatar.tsx";
import { Lightbox } from "../Lightbox.tsx";
import { MessageContent } from "../messageRender.tsx";
import { ChatSidebar } from "./ChatSidebar.tsx";
import { IconFile, IconDownload } from "../icons.tsx";
import { ST_LABEL } from "../TaskBoard.tsx";
import { AGENTS, CASES, type ShowcaseAttachment, type ShowcaseCase, type ShowcaseLine, type ShowcaseTask } from "../showcaseData.ts";
import { ChatMessageItem, MessageHeader } from "./chat-message/ChatMessageItem.tsx";
import { MessageTopicPreview } from "./chat-message/MessageTopicPreview.tsx";
import { surfaceForSender } from "./chat-message/messagePresentation.ts";
import type { ThreadMeta } from "../threadUnread.ts";

// Internal token links (@mention / #channel / task #N) are inert on this static page: with empty
// mentions/channels the markdown renderer leaves them as plain text, and nav() is a no-op.
const noNav = () => {};

// Short role label from the demo displayName ("Pat (PM)" → "PM"); full description goes in the tooltip.
function roleOf(name: string): { role: string; title: string } {
  const a = AGENTS[name];
  if (!a) return { role: "", title: "" };
  const m = a.displayName.match(/\(([^)]+)\)/);
  return { role: m ? m[1]! : "", title: a.description };
}

// One attachment under a case anchor: image → clickable thumbnail (opens the in-app Lightbox, like Chat —
// never a new-tab navigation to the raw asset) + download card; csv (any file) → download card.
function ShowcaseAtt({ att }: { att: ShowcaseAttachment }) {
  const [lb, setLb] = useState(false);
  return (
    <div className="msg-atts">
      {att.kind === "image" && (
        <>
          <button className="msg-att-img" title={att.filename} onClick={() => setLb(true)}>
            <img src={att.href} alt={att.filename} loading="lazy" />
          </button>
          {lb && <Lightbox src={att.href} alt={att.filename} onClose={() => setLb(false)} />}
        </>
      )}
      <a className="msg-att" href={att.href} download={att.filename}>
        <IconFile size={14} />
        <span className="grow">{att.filename}</span>
        <IconDownload size={14} />
      </a>
    </div>
  );
}

// One message row — anchor (you) or a thread line (agent | you). Mirrors ChatMessageItem but with a
// non-clickable avatar/name and no live status/toolbar. Task metadata and the topic summary only render
// on the channel anchor (where task / onOpenThread are passed), matching Chat's .msg-meta.
function ShowcaseMsg({ line, task, attachment, replyLines, onOpenThread }: {
  line: ShowcaseLine;
  task?: ShowcaseTask | null;
  attachment?: ShowcaseAttachment;
  replyLines?: ShowcaseLine[];
  onOpenThread?: () => void;
}) {
  const { t } = useTranslation();
  const isYou = line.agent === null;
  const senderName = isYou ? "you" : line.agent!;
  const { role, title } = isYou ? { role: "", title: "" } : roleOf(senderName);
  const topicMeta: ThreadMeta | null = onOpenThread && replyLines ? {
    threadChannelId: "showcase",
    replyCount: replyLines.length,
    previews: replyLines.slice(-3).map((reply, index) => ({
      id: `showcase-${replyLines.length - Math.min(replyLines.length, 3) + index}`,
      senderType: reply.agent === null ? "human" : "agent",
      senderId: reply.agent,
      senderName: reply.agent ?? "you",
      content: reply.content,
      createdAt: "",
    })),
  } : null;
  return (
    <ChatMessageItem
      surface="showcase"
      tone={surfaceForSender(isYou ? "human" : "agent")}
      avatar={<span className="msg-av"><Avatar seed={senderName} size={32} /></span>}
      header={<MessageHeader
        sender={<span className="who" title={title || undefined}>{senderName}</span>}
        badge={role ? <span className="showcase-role" title={title}>{role}</span> : <span className="member-badge">{t("chat.humanKind")}</span>}
      />}
    >
        {!!line.content && <div className="mbody"><MessageContent content={line.content} mentions={[]} channels={[]} nav={noNav} /></div>}
        {attachment && <ShowcaseAtt att={attachment} />}
        {task && (
          <div className="msg-meta">
              <span className="task-pill st-done" style={{ cursor: "default" }}>
                <CheckCircle2 size={11} /> #{task.number} {t(ST_LABEL[task.status] ?? task.status)}
              </span>
          </div>
        )}
        {topicMeta && onOpenThread && <MessageTopicPreview meta={topicMeta} onOpen={onOpenThread} />}
    </ChatMessageItem>
  );
}

// Read-only thread panel — mirrors Chat's ThreadPanel structure (thread-head + thread-parent + thread-sep +
// replies) but with NO composer (a static page can't reply): the footer is the read-only notice instead.
function ShowcaseThread({ c, onClose }: { c: ShowcaseCase; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <aside className="thread-panel showcase-thread">
      <div className="thread-head">
        <span className="grow">{t("chat.thread")}</span>
        <button className="tp-close" onClick={onClose} title={t("chat.close")}><X size={15} /></button>
      </div>
      <div className="scroll">
        <div className="thread-parent">
          <ShowcaseMsg line={{ agent: null, content: c.anchor }} attachment={c.attachment} />
        </div>
        <div className="thread-sep">{t("chat.replyCount", { count: c.lines.length })}</div>
        {c.lines.map((line, j) => <ShowcaseMsg key={j} line={line} />)}
      </div>
      <div className="showcase-readonly"><Eye size={14} />{t("chat.showcaseReadOnly")}</div>
    </aside>
  );
}

export function Showcase({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  // Index of the case whose thread panel is open (null = closed). Pure local state over static data — no API.
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const openCase = openIdx != null ? CASES[openIdx] : null;
  return (
    <>
      {!embedded && <ChatSidebar />}
      {/* Flex row: the channel column + (when a pill is clicked) the thread panel. The showcase route is not
          a /channel path, so the app shell never gets has-traj's 4th grid column — this wrapper IS the single
          grid cell and lays its own "main + thread" columns out, so a closed thread leaves no empty strip. */}
      <div className="showcase-shell">
        <main className="content-col">
          <div className="head chat-head">
            <h1><Eye size={16} style={{ verticalAlign: "-3px", opacity: 0.7 }} /> {t("showcase.title")}</h1>
            <small>{t("showcase.subtitle")}</small>
          </div>
          <div className="scroll ch-view-enter">
            {CASES.map((c, i) => (
              // A case = its human "task" anchor (carrying the task badge, attachment, and topic summary).
              // The collaboration transcript lives behind the pill — not flattened here. Cases after the first
              // get a hairline top divider.
              <section key={i} className={"showcase-case" + (openIdx === i ? " open" : "")} style={i > 0 ? { marginTop: 4, paddingTop: 18, borderTop: "1px solid var(--hair)" } : undefined}>
                <ShowcaseMsg
                  line={{ agent: null, content: c.anchor }}
                  task={c.task}
                  attachment={c.attachment}
                  replyLines={c.lines}
                  onOpenThread={() => setOpenIdx(i)}
                />
              </section>
            ))}
          </div>
          <div className="showcase-readonly"><Eye size={14} />{t("chat.showcaseReadOnly")}</div>
        </main>
        {openCase && <ShowcaseThread c={openCase} onClose={() => setOpenIdx(null)} />}
      </div>
    </>
  );
}
