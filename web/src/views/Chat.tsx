import { useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useLocation, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { useStore, type Msg, type Att } from "../store.tsx";
import { fmtMessageTime, fmtMessageTimestamp, isSameLocalDay, fmtDateDivider } from "../format";
import { PAGE_SIZE, appendWithCap, nextScrollState } from "../lib/msgPaging";
import { AGENT_REPLY_PREVIEW_TYPE, AGENT_REPLY_STREAM_TICK_MS, absorbPersistedAgentMessagePreview, applyAgentReplyPreview, dropAgentReplyPreviewForThreadReply, dropAgentReplyPreviewsForMessage, hasStreamingAgentReplyPreview, renderKeyForMessage, tickAgentReplyPreviews, type AgentReplyEvent, type AgentReplyPreviewMsg } from "../lib/agentReplyPreview";
import { MessageContent } from "../messageRender.tsx";
import { nextThreadMeta, type ThreadMeta } from "../threadUnread";
import { Smile, X, ExternalLink, CheckCircle2, MessageCircle, MoreHorizontal, Link2, Clipboard, Bookmark, CheckSquare, Circle, Play, Eye, Ban, ArrowDown, Bell, BellOff, Archive, MessagesSquare, ListTodo, PanelsTopLeft, Hash } from "lucide-react";
// Task badge per message row: icon changes with task status; color tokens from DESIGN.md (see .task-pill.st-* styles)
const TASK_ICON: Record<string, typeof Circle> = { todo: Circle, in_progress: Play, in_review: Eye, done: CheckCircle2, closed: Ban };
import { Avatar, resolveAvatar } from "../Avatar.tsx";
import { agentStatusLabel } from "../agentStatus.ts";
import { AttachmentCard } from "../components/AttachmentCard.tsx";
import { ST_LABEL } from "../TaskBoard.tsx";
import { taskStatusOptions } from "../taskStatusPolicy.ts";
import { PaneEmpty } from "../PaneEmpty.tsx";
import { ChatSkeleton } from "./Skeleton.tsx";
import { CreateAgentModal } from "./Members.tsx";
import { ChatSidebar, CreateChannelModal, channelCreateErrorMsg } from "./ChatSidebar.tsx";
import { Composer, type ComposerHandle } from "./Composer.tsx";
import { LiveTrace } from "./LiveTrace.tsx";
import { useEscClose } from "../ConfirmModal.tsx";
import { useToast } from "../toast.tsx";
import { workspaceLocationForConversation, workspaceLocationForModule } from "../shell/workspaceRoute.ts";
import { VerticalDragDivider } from "../components/VerticalDragDivider.tsx";
import { defaultThreadPaneWidth, threadPaneConstraints } from "./chatPaneLayout.ts";
import { useChannelAgentResponseModes } from "./agent-response-mode/useChannelAgentResponseModes.ts";
import { ChatMessageItem, MessageHeader, MessageToolbar } from "./chat-message/ChatMessageItem.tsx";
import { DeletedAgentName } from "./chat-message/DeletedAgentName.tsx";
import { AgentMessageCard, type AgentMessageCardAnchor } from "./chat-message/AgentMessageCard.tsx";
import { AgentMentionName } from "./chat-message/AgentMentionName.tsx";
import { HumanMessageCard } from "./chat-message/HumanMessageCard.tsx";
import { MessageTopicPreview } from "./chat-message/MessageTopicPreview.tsx";
import { shouldGroupMessage } from "./chat-message/messageGrouping.ts";
import { surfaceForSender } from "./chat-message/messagePresentation.ts";
import { fetchThreadMetadata } from "./chat-message/threadPreviewApi.ts";
import { buildMessageImageGallery, isSingleImageMessage } from "./chat-message/messageImageGallery.ts";
import type { LightboxImage } from "../Lightbox.tsx";

const fmtSize = (n?: number) => (!n ? "" : n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB");
export const BACK_TO_BOTTOM_SCROLL_MS = 800;
export const MESSAGE_ENTER_PIN_MS = 1000;
export const backToBottomEase = (t: number) => 1 - Math.pow(1 - t, 3);

export function animateBackToBottom(el: Pick<HTMLDivElement, "scrollTop" | "scrollHeight">, done?: () => void) {
  const start = el.scrollTop;
  const target = el.scrollHeight;
  const delta = target - start;
  if (!delta) { done?.(); return; }
  const startTime = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - startTime) / BACK_TO_BOTTOM_SCROLL_MS);
    el.scrollTop = start + delta * backToBottomEase(t);
    if (t < 1) requestAnimationFrame(step);
    else { el.scrollTop = target; done?.(); }
  };
  requestAnimationFrame(step);
}

function AgentReplyPreviewBody({ m }: { m: Msg }) {
  const { t } = useTranslation();
  const preview = m as AgentReplyPreviewMsg;
  const done = !!preview.streamDone && !preview.streamError;
  if (!preview.streamError && !done && !preview.streamThinkingVisible) return null;
  return (
    <div className={"mbody agent-reply-placeholder" + (preview.streamError ? " error" : done ? " done" : "")} aria-live="polite">
      {preview.streamError ? t("chat.agentReplyError") : done ? t("chat.agentThinkingDone") : t("chat.agentThinking")}
    </div>
  );
}
export function keepPinnedToBottomDuringEnter(el: Pick<HTMLDivElement, "scrollTop" | "scrollHeight">, shouldContinue: () => boolean, durationMs = MESSAGE_ENTER_PIN_MS) {
  const startTime = performance.now();
  const pin = () => { el.scrollTop = el.scrollHeight; };
  pin();
  const step = (now: number) => {
    if (!shouldContinue()) return;
    pin();
    if (now - startTime < durationMs) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Message and Composer attachments share the same responsive card. Images open the common viewer;
// every other type keeps a direct file link without introducing a second visual treatment.
function AttCard({ a, url, gallery }: { a: Att; url: string; gallery: readonly LightboxImage[] }) {
  const image = !!a.mimeType?.startsWith("image/");
  return <AttachmentCard filename={a.filename} mimeType={a.mimeType} imageSrc={image ? url : undefined} imageId={image ? a.id : undefined} imageGallery={image ? gallery : undefined} href={image ? undefined : url} sizeLabel={fmtSize(a.sizeBytes)} />;
}

// Message emoji reactions: chip shows emoji×count (highlighted if the current user reacted), click to toggle; hovering the add button reveals a quick picker
const QUICK_EMOJIS = ["👍", "✅", "❤️", "😂", "🎉", "👀", "🚀", "🙏"];
function Reactions({ m, mine, onReact, readOnly = false }: { m: Msg; mine: string; onReact: (emoji: string, remove: boolean) => void; readOnly?: boolean }) {
  const rs = m.reactions || [];
  if (!rs.length) return null;
  return (
    <div className="msg-rx">
      {rs.map((r) => {
        const did = !!mine && r.reactorIds?.includes(mine);
        const names = (r.reactorNames || []).filter(Boolean).join(", "); // who reacted — shown in a custom hover tooltip (native title is slow/unstyled/missing on touch)
        return <button key={r.emoji} className={"rx-chip" + (did ? " on" : "")} disabled={readOnly} onClick={() => onReact(r.emoji, !!did)}>{r.emoji} {r.count}{names ? <span className="rx-tip" role="tooltip">{names}</span> : null}</button>;
      })}
    </div>
  );
}

function ReactionToolbarButton({ onReact }: { onReact: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="toolbar-reaction-wrap">
      <button type="button" title={i18n.t("chat.addReaction")} aria-label={i18n.t("chat.addReaction")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)}><Smile size={15} /></button>
      {open ? <span className="rx-pop" role="menu" onMouseLeave={() => setOpen(false)}>{QUICK_EMOJIS.map((emoji) => <button type="button" role="menuitem" key={emoji} title={emoji} onClick={() => { onReact(emoji); setOpen(false); }}>{emoji}</button>)}</span> : null}
    </span>
  );
}

function MessageContextMenu({
  m,
  x,
  y,
  link,
  readOnly,
  saved,
  onClose,
  onReact,
  onOpenThread,
  onToggleSave,
  onConvertTask,
}: {
  m: Msg;
  x: number;
  y: number;
  link: string;
  readOnly: boolean;
  saved: boolean;
  onClose: () => void;
  onReact: (emoji: string) => void;
  onOpenThread?: () => void;
  onToggleSave: () => void;
  onConvertTask?: () => void;
}) {
  const { t } = useTranslation();
  const copy = (text: string) => { navigator.clipboard?.writeText(text).catch(() => {}); onClose(); };
  return (
    <div className="ctx-backdrop" onClick={onClose} onContextMenu={(event) => { event.preventDefault(); onClose(); }}>
      <div className="ctx-menu" style={{ left: Math.min(x, window.innerWidth - 230), top: Math.min(y, window.innerHeight - 320) }} onClick={(event) => event.stopPropagation()}>
        {!readOnly ? <div className="ctx-rx">{QUICK_EMOJIS.slice(0, 6).map((emoji) => <button key={emoji} title={emoji} onClick={() => { onReact(emoji); onClose(); }}>{emoji}</button>)}</div> : null}
        <button className="ctx-item" onClick={() => copy(m.content)}><Clipboard size={14} /> {t("chat.copyMarkdown")}</button>
        <button className="ctx-item" onClick={() => copy(link)}><Link2 size={14} /> {t("chat.copyLink")}</button>
        {onOpenThread ? <button className="ctx-item" onClick={() => { onOpenThread(); onClose(); }}><MessageCircle size={14} /> {t("chat.openThread")}</button> : null}
        {!readOnly ? <button className="ctx-item" onClick={() => { onToggleSave(); onClose(); }}><Bookmark size={14} fill={saved ? "currentColor" : "none"} /> {saved ? t("chat.unsave") : t("chat.saveMessage")}</button> : null}
        {!readOnly && onConvertTask ? <button className="ctx-item" onClick={() => { onClose(); onConvertTask(); }}><CheckSquare size={14} /> {t("chat.convertToTask")}</button> : null}
      </div>
    </div>
  );
}

// Action card: a proposal card sent by an agent. User clicks it → a pre-filled creation dialog opens → resource is created on behalf of the user → markExecuted is called.
function ActionCardMsg({
  m,
  readOnly = false,
  onOpenAgentCard,
  onMentionAgent,
}: {
  m: Msg;
  readOnly?: boolean;
  onOpenAgentCard(agentId: string, trigger: HTMLButtonElement): void;
  onMentionAgent(agentName: string): void;
}) {
  const { t } = useTranslation();
  const { createChannel, markActionExecuted, slug, agents, attachmentUrl } = useStore();
  const toast = useToast();
  const nav = useNavigate();
  const routeLocation = useLocation();
  const navigateConversation = (target: string) => nav(workspaceLocationForConversation(
    target,
    routeLocation.pathname,
    routeLocation.search,
  ));
  const [open, setOpen] = useState(false);
  const agent = m.senderId ? agents.find((candidate) => candidate.id === m.senderId) : undefined;
  const live = agent ? ((agent.activity && agent.activity !== "offline" ? agent.activity : agent.status) || "offline") : "offline";
  const meta = m.actionMetadata!;
  const a = meta.action;
  const executed = meta.state === "executed";
  const isChan = a.type === "channel:create";
  const title = isChan
    ? <>{t(a.visibility === "private" ? "chat.createPrivateChannel" : "chat.createPublicChannel", { name: a.name })}</>
    : <>{t("chat.createAgent", { name: a.name })}</>;
  return (
    <>
      <ChatMessageItem
        id={"m-" + m.id}
        surface="action"
        className="action-card-msg"
        avatar={agent && m.senderId
          ? <button type="button" className="msg-av clickable" aria-label={t("chat.openAgentCard", { name: m.senderName })} aria-haspopup="dialog" onClick={(event) => onOpenAgentCard(m.senderId!, event.currentTarget)}><Avatar seed={m.senderName} url={resolveAvatar(agent.avatarUrl, attachmentUrl)} size={32} />{live !== "offline" ? <span className={`av-status ${live}`} /> : null}</button>
          : <span className="msg-av"><Avatar seed={m.senderName} url={resolveAvatar(agent?.avatarUrl, attachmentUrl)} size={32} /></span>}
        header={<MessageHeader
          sender={agent
            ? <AgentMentionName displayName={m.senderName} mentionName={agent.name} disabled={readOnly} onMention={onMentionAgent} />
            : <span className="who">{m.senderName}</span>}
          badge={<span className="member-badge">{t("chat.proposed")}</span>}
          timestamp={fmtMessageTimestamp(m.createdAt)}
        />}
      >
        <div className="action-card">
          <div className="ac-title">{title}</div>
          {a.description ? <div className="ac-detail"><span className="ac-k">{t("chat.description")}</span> {a.description}</div> : null}
          {executed
            ? <div className="ac-done"><CheckCircle2 size={13} /> {t("chat.executedBy", { name: meta.executedByUserName || t("chat.someone") })}</div>
            : readOnly ? null : <button className="ac-btn" onClick={() => setOpen(true)}>{isChan ? t("chat.createChannel") : t("chat.createAgentBtn")}</button>}
        </div>
      </ChatMessageItem>
      {open && !readOnly && isChan && (
        <CreateChannelModal
          prefill={{ name: a.name, description: a.description ?? "", visibility: a.visibility, agentIds: a.initialAgents ?? [] }}
          submitLabel={t("chat.createChannel")} onClose={() => setOpen(false)}
          onCreate={async (opts) => {
            const r = await createChannel(opts);
            if (r?.id) { setOpen(false); await markActionExecuted(m.id, { kind: "channel", id: r.id, name: opts.name }); navigateConversation(`/s/${slug}/channel/${r.id}`); }
            else toast.error(channelCreateErrorMsg(t, r?.error)); // keep the modal open so the user can fix the name and retry
          }}
        />
      )}
      {open && !readOnly && !isChan && (
        <CreateAgentModal
          prefill={{ name: a.name, description: a.description ?? "" }} onClose={() => setOpen(false)}
          onCreated={async (r) => { await markActionExecuted(m.id, { kind: "agent", id: r.id, name: r.name }); }}
        />
      )}
    </>
  );
}

interface ChatShellControls {
  conversationListOpen?: boolean;
  conversationToggleRef?: RefObject<HTMLButtonElement>;
  aggregateOpen?: boolean;
  aggregateAvailable?: boolean;
  aggregateToggleRef?: RefObject<HTMLButtonElement>;
  onToggleConversationList?(): void;
  onToggleAggregate?(): void;
  onOpenTasks?(conversationId: string): void;
  onOpenChannelSettings?(channelId: string, trigger?: HTMLButtonElement): void;
  onNavigateConversation?(target: string): void;
}
interface ChatProps extends ChatShellControls {
  embedded?: boolean;
  channelIdOverride?: string;
  threadOnly?: boolean;
}

export function Chat({
  embedded = false,
  channelIdOverride,
  threadOnly = false,
  conversationListOpen = true,
  conversationToggleRef,
  aggregateOpen = false,
  aggregateAvailable = true,
  aggregateToggleRef,
  onToggleConversationList,
  onToggleAggregate,
  onOpenTasks,
  onOpenChannelSettings,
  onNavigateConversation,
}: ChatProps) {
  const { t } = useTranslation();
  const { api, reload, channels, archivedChannels, dms, unread, agents, slug, me, onEvent, subscribeChannel, markRead, attachmentUrl, react, openThread, openAgentDM, savedIds, saveMsg, unsaveMsg, agentPanelReq, clearAgentPanelReq } = useStore();
  const toast = useToast();
  const avFor = (u?: string | null) => resolveAvatar(u, attachmentUrl);
  const senderAvatar = (m: Msg) => avFor(m.senderType === "agent" ? agents.find((agent) => agent.id === m.senderId)?.avatarUrl : undefined);
  const { channelId: routeChannelId } = useParams();
  const channelId = channelIdOverride ?? routeChannelId;
  const nav = useNavigate();
  const routeLocation = useLocation();
  const navigateConversation = (target: string, options?: { replace?: boolean }) => {
    const location = workspaceLocationForConversation(target, routeLocation.pathname, routeLocation.search);
    if (onNavigateConversation && !options?.replace) return onNavigateConversation(location);
    nav(location, options);
  };
  const [taskMenu, setTaskMenu] = useState<string | null>(null); // task badge status menu: id of the currently open message (clicking the badge changes status, does not open thread)
  const [agentCard, setAgentCard] = useState<{ id: string; anchor: AgentMessageCardAnchor; trigger: HTMLElement } | null>(null);
  const [humanCard, setHumanCard] = useState<{ name: string; avatarUrl: string | null; anchor: AgentMessageCardAnchor; trigger: HTMLElement } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ m: Msg; x: number; y: number } | null>(null); // right-clicking a message opens the context action menu
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const messageImageGallery = useMemo(() => buildMessageImageGallery(msgs, attachmentUrl), [attachmentUrl, msgs]);
  const [loaded, setLoaded] = useState(false); // first fetch for the current channel done — gates the empty-channel state so it never flashes mid-load
  const [loadError, setLoadError] = useState(false); // first fetch failed — exits the skeleton into a retryable error state
  const [sub, setSub] = useState("");
  const [thread, setThread] = useState<{ channelId: string; parent: Msg; followed: boolean } | null>(null); // currently open thread panel
  const [threadWidth, setThreadWidth] = useState<number | null>(null);
  const [chatSurfaceWidth, setChatSurfaceWidth] = useState(() => typeof window === "undefined" ? 1000 : window.innerWidth);
  const chatMainRef = useRef<HTMLElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const [threadMeta, setThreadMeta] = useState<Record<string, ThreadMeta>>({}); // parent message id → thread metadata and latest reply previews
  const [unreadThreads, setUnreadThreads] = useState<{ threadChannelId: string; parentMessageId: string; parentChannelId: string; unreadCount: number }[]>([]); // unread that lives in this channel's threads (invisible in the main timeline) → "jump to unread thread" bar
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true); // tracks whether the scroll position is at the bottom; new messages auto-scroll only when already at the bottom, preserving history browsing
  const forceBottomPinRef = useRef(false); // own sends + agent previews should return the viewport to the live tail even if overlay height made atBottom stale
  const [showJump, setShowJump] = useState(false); // when not at the bottom, show the "Back to bottom" jump button
  const showJumpRef = useRef(false);
  useLayoutEffect(() => {
    if (threadOnly) return;
    const surface = chatMainRef.current?.parentElement;
    if (!surface) return;
    const updateWidth = () => setChatSurfaceWidth(surface.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [threadOnly]);
  const threadConstraints = threadPaneConstraints(
    chatSurfaceWidth,
    threadWidth ?? defaultThreadPaneWidth(chatSurfaceWidth),
  );
  const scrollingToBottomRef = useRef(false); // suppress jump-button flicker while the 0.8s smooth scroll is in progress
  const [hasMore, setHasMore] = useState(false); // older messages remain before the loaded window → drives scroll-to-top "load more"
  const loadingOlderRef = useRef(false); // de-dupes concurrent "load older" fetches while one is in flight
  const prependRestoreRef = useRef<number | null>(null); // scrollHeight captured before a prepend; restored after so the viewport doesn't jump
  const trimmedRef = useRef(false); // a live-tail trim dropped the oldest in-memory messages → mark hasMore so they stay re-fetchable
  // Message enter animation tracking: id → stagger index (0–7) for messages that arrived via socket (true new).
  // Historical loads (initial fetch, loadOlder) never touch this map, so they never get the enter class.
  const newMsgOrderRef = useRef(new Map<string, number>());
  const burstCountRef = useRef(0); // how many messages have arrived in the current burst window
  const burstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // resets burstCount after 600ms silence
  const cur = [...channels, ...archivedChannels, ...dms].find((c) => c.id === channelId) || channels.find((c) => c.name === "all") || channels[0];
  const isArchived = !!cur && archivedChannels.some((channel) => channel.id === cur.id);
  const conversationReadOnly = isArchived;
  const [restoringArchived, setRestoringArchived] = useState(false);
  const messageChannels = [...channels, ...archivedChannels];

  const restoreArchivedChannel = async () => {
    if (!cur || !isArchived || restoringArchived) return;
    setRestoringArchived(true);
    try {
      const result = await api("POST", `/api/channels/${encodeURIComponent(cur.id)}/unarchive`);
      if (result?.error) throw new Error(String(result.error));
      await reload();
      toast.info(t("channelSettings.restoreSuccess"));
    } catch {
      toast.error(t("channelSettings.operationFailed"));
    } finally {
      setRestoringArchived(false);
    }
  };
  const curIdRef = useRef<string | undefined>(undefined);
  curIdRef.current = cur?.id; // latest channel id for async guards: a loadOlder that resolves after a channel switch must drop its stale-channel result (no cross-channel prepend / hasMore clobber)
  const isDm = !!dms.find((d) => d.id === cur?.id);
  const dmPeer = dms.find((d) => d.id === cur?.id);
  const dmAgent = dmPeer?.peerType === "agent" ? agents.find((a) => a.id === dmPeer.peerId) : undefined; // DM peer agent → used for the live status indicator in the header
  const responseModeChannelId = !isDm && cur?.type !== "thread" ? cur?.id : thread?.parent.channelId;
  const responseModeReadOnly = conversationReadOnly;
  const channelResponseModes = useChannelAgentResponseModes(responseModeChannelId, !!responseModeChannelId && !isDm);
  const [sp, setSp] = useSearchParams();
  const msgParam = sp.get("msg"); // when present, scroll to and highlight the specified message id
  const threadParam = sp.get("thread"); // auto-open a thread panel (from inbox, in-message thread link, or cross-page link); value is the parent message id (full or 8-char short) or channelId:shortid
  const threadMsgParam = sp.get("threadMsg"); // optional reply target inside the opened topic
  const openAgentProfile = (agent: string, agentTab?: string) => nav(workspaceLocationForModule(
    routeLocation.pathname,
    routeLocation.search,
    { moduleId: "agents", agent, agentTab },
  ));
  const openHumanSettings = () => nav(workspaceLocationForModule(
    routeLocation.pathname,
    routeLocation.search,
    { moduleId: "settings", settings: "human" },
  ));
  const openMessageAgentCard = (agentId: string, trigger: HTMLElement) => {
    const rect = trigger.getBoundingClientRect();
    const anchor = { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
    setHumanCard(null);
    setAgentCard((current) => current?.trigger === trigger ? null : { id: agentId, anchor, trigger });
  };
  const openMessageHumanCard = (name: string, avatarUrl: string | null, trigger: HTMLElement) => {
    const rect = trigger.getBoundingClientRect();
    const anchor = { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
    setAgentCard(null);
    setHumanCard((current) => current?.trigger === trigger ? null : { name, avatarUrl, anchor, trigger });
  };
  const messageAgent = async (agentId: string) => {
    const directChannelId = await openAgentDM(agentId);
    if (!directChannelId) throw new Error("agent_dm_unavailable");
    navigateConversation(`/s/${slug}/channel/${directChannelId}`);
  };
  const mentionAgent = (agentName: string) => composerRef.current?.mentionAgent(agentName);

  useEffect(() => {
    if (!sp.has("chatTab")) return;
    const next = new URLSearchParams(sp);
    next.delete("chatTab");
    setSp(next, { replace: true });
  }, [setSp, sp]);

  useEffect(() => { setAgentCard(null); setHumanCard(null); }, [cur?.id]);

  // Channel-scoped state (loaded messages + load gate + has-more) belongs to one channel. When the
  // channel changes, reset it *synchronously during render* (React's "adjust state when a prop changes"
  // pattern) rather than in the effect below — effects run after paint, so resetting there leaves one
  // painted frame (and the whole skeleton phase) showing the previous channel's messages. Resetting here
  // makes the new channel paint its skeleton immediately, never the prior channel's stale list.
  const [shownChannelId, setShownChannelId] = useState(cur?.id);
  if (cur?.id !== shownChannelId) {
    setShownChannelId(cur?.id);
    setMsgs([]);
    setLoaded(false);
    setLoadError(false);
    setHasMore(false);
  }

  useEffect(() => {
    if (!routeChannelId && !channelIdOverride && cur) navigateConversation(`/s/${slug}/channel/${cur.id}`, { replace: true });
  }, [routeChannelId, channelIdOverride, cur, slug, routeLocation.pathname, routeLocation.search, nav]);
  const loadCurrentMessages = async () => {
    if (!cur) return;
    const chId = cur.id;
    setLoaded(false);
    setLoadError(false);
    try {
      const d = await api("GET", `/api/messages/channel/${chId}?limit=${PAGE_SIZE}`);
      if (curIdRef.current !== chId) return;
      const ms: Msg[] = d.messages || [];
      setMsgs(ms);
      setHasMore(!!d.hasMore);
      markRead(chId);
      const ids = ms.map((m) => m.id);
      if (ids.length) {
        try { setThreadMeta(await fetchThreadMetadata(api, chId, ids)); }
        catch { setThreadMeta({}); }
      } else setThreadMeta({});
    } catch {
      if (curIdRef.current !== chId) return;
      setMsgs([]);
      setThreadMeta({});
      setHasMore(false);
      setLoadError(true);
    } finally {
      if (curIdRef.current === chId) setLoaded(true);
    }
  };
  useEffect(() => { if (!cur) return; setThread(null); setThreadWidth(null); loadingOlderRef.current = false; prependRestoreRef.current = null; subscribeChannel(cur.id); void loadCurrentMessages(); }, [cur?.id]);
  // Surface unread that lives in this channel's threads (folded away, invisible in the main timeline → "滑不到").
  // Re-runs when the channel's badge changes: entry, a new thread reply bumping it, or opening a thread clearing it.
  useEffect(() => {
    if (!cur || isArchived || cur.type === "dm" || cur.type === "thread") { setUnreadThreads([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await api("GET", "/api/channels/threads/followed");
        if (cancelled) return;
        setUnreadThreads((r?.threads || []).filter((th: any) => th.parentChannelId === cur.id && th.unreadCount > 0 && th.parentMessageId)
          .map((th: any) => ({ threadChannelId: th.threadChannelId, parentMessageId: th.parentMessageId, parentChannelId: th.parentChannelId, unreadCount: th.unreadCount })));
      } catch { if (!cancelled) setUnreadThreads([]); }
    })();
    return () => { cancelled = true; };
  }, [cur?.id, isArchived, unread[cur?.id ?? ""]]);
  // LiveAgentBar opens the canonical Agents module on its Activity tab and consumes the request once.
  useEffect(() => {
    if (!agentPanelReq) return;
    openAgentProfile(agentPanelReq, "activity");
    clearAgentPanelReq();
    // eslint-disable-next-line
  }, [agentPanelReq]);
  useEffect(() => onEvent((e) => {
    if (e.type === "message" && e.channelId === cur?.id) { if (e.message.senderType === "human" && e.message.senderId === me?.id) forceBottomPinRef.current = true; setMsgs((m) => { const preview = absorbPersistedAgentMessagePreview(m, e.message); if (preview.consumed) { forceBottomPinRef.current = true; newMsgOrderRef.current.delete(e.message.id); return preview.messages; } const idx = Math.min(burstCountRef.current, 7); newMsgOrderRef.current.set(e.message.id, idx); burstCountRef.current += 1; if (burstTimerRef.current) clearTimeout(burstTimerRef.current); burstTimerRef.current = setTimeout(() => { burstCountRef.current = 0; burstTimerRef.current = null; }, 600); const { next, trimmed } = appendWithCap(dropAgentReplyPreviewsForMessage(m, e.message), e.message, atBottomRef.current && !loadingOlderRef.current); if (trimmed) trimmedRef.current = true; return next; }); markRead(cur.id); } // don't trim mid-pagination: a trim's setHasMore(true) would race the in-flight loadOlder's setHasMore — suppressing it closes the window (the next message trims instead)
    else if (e.type === "message:updated" && e.message) setMsgs((m) => m.map((x) => (x.id === e.message.id ? { ...x, ...e.message } : x))); // sync reactions and task fields
    else if (e.type === "agent:deleted" && e.id) {
      setMsgs((current) => current.map((message) => message.senderId === e.id ? { ...message, senderDeleted: true } : message));
      setThread((current) => {
        if (!current || current.parent.senderId !== e.id) return current;
        return { ...current, parent: { ...current.parent, senderDeleted: true } };
      });
      setThreadMeta((current) => Object.fromEntries(Object.entries(current).map(([messageId, meta]) => [messageId, {
        ...meta,
        previews: meta.previews?.map((preview) => preview.senderId === e.id ? { ...preview, senderDeleted: true } : preview),
      }])));
    }
    else if (e.type === "agent:reply" && e.channelId === cur?.id) { forceBottomPinRef.current = true; setMsgs((m) => applyAgentReplyPreview(m, e as AgentReplyEvent, agents.find((a) => a.id === e.agentId))); }
    else if (e.type === "thread:updated" && e.parentMessageId) {
      setMsgs((m) => dropAgentReplyPreviewForThreadReply(m, {
        parentMessageId: e.parentMessageId,
        senderId: e.senderId,
        senderType: e.senderType,
        replyCount: e.replyCount,
      }));
      setThreadMeta((tm) => ({ // live reply count update; unreadCount is approximated from the replyCount delta (the authoritative value is corrected on channel switch via GET)
        ...tm,
        [e.parentMessageId]: nextThreadMeta(tm[e.parentMessageId], { threadChannelId: e.threadChannelId, replyCount: e.replyCount, senderId: e.senderId }, me?.id),
      }));
      const chId = cur?.id;
      if (chId) void fetchThreadMetadata(api, chId, [e.parentMessageId]).then((fresh) => {
        if (curIdRef.current !== chId || !fresh[e.parentMessageId]) return;
        setThreadMeta((current) => ({ ...current, [e.parentMessageId]: fresh[e.parentMessageId]! }));
      }).catch(() => {});
    }
  }), [cur?.id, agents, me?.id]);
  const streamingPreviewActive = hasStreamingAgentReplyPreview(msgs);
  useEffect(() => {
    if (!streamingPreviewActive) return;
    const timer = window.setInterval(() => {
      setMsgs((m) => {
        const tick = tickAgentReplyPreviews(m);
        if (tick.changed) forceBottomPinRef.current = true;
        return tick.changed ? tick.messages : m;
      });
    }, AGENT_REPLY_STREAM_TICK_MS);
    return () => window.clearInterval(timer);
  }, [streamingPreviewActive]);
  useEffect(() => { const el = scrollRef.current; if (!el || msgParam) return; const force = forceBottomPinRef.current; if (force) { forceBottomPinRef.current = false; atBottomRef.current = true; setJumpVisible(false); } if (force || atBottomRef.current) keepPinnedToBottomDuringEnter(el, () => !msgParam && (force || atBottomRef.current)); }, [msgs, msgParam]); // auto-scroll when already pinned; own sends and agent previews force the live tail so users do not drag the scrollbar manually
  // Keep the viewport anchored across an older-page prepend: restore scrollTop before paint. Runs before the auto-scroll effect above, which is a no-op here anyway (a prepend only happens while scrolled up, so atBottomRef is false).
  useLayoutEffect(() => { const el = scrollRef.current; if (el && prependRestoreRef.current != null) { el.scrollTop = el.scrollHeight - prependRestoreRef.current; prependRestoreRef.current = null; } }, [msgs]);
  useEffect(() => { if (trimmedRef.current) { trimmedRef.current = false; setHasMore(true); } }, [msgs]); // a live-tail trim opened a gap at the top → older messages stay re-fetchable
  const setJumpVisible = (visible: boolean) => { showJumpRef.current = visible; setShowJump(visible); };
  useEffect(() => { atBottomRef.current = true; setJumpVisible(false); newMsgOrderRef.current.clear(); burstCountRef.current = 0; }, [cur?.id]); // reset bottom-pin state + new-msg enter animation tracking on channel switch
  const toBottom = () => {
    const el = scrollRef.current;
    if (!el) { atBottomRef.current = true; setJumpVisible(false); return; }
    scrollingToBottomRef.current = true;
    setJumpVisible(false);
    animateBackToBottom(el, () => { scrollingToBottomRef.current = false; atBottomRef.current = true; setJumpVisible(false); });
  };
  // Fetch the previous (older) page via the `before` keyset cursor and prepend it; guarded so concurrent scroll events can't fire duplicate loads.
  const loadOlder = async () => {
    if (!cur || loadingOlderRef.current || !hasMore || !msgs.length) return;
    const chId = cur.id; // pin the channel this fetch belongs to
    loadingOlderRef.current = true;
    try {
      const d = await api("GET", `/api/messages/channel/${chId}?limit=${PAGE_SIZE}&before=${msgs[0]!.seq}`);
      if (curIdRef.current !== chId) return; // channel switched mid-fetch → drop the stale result (finally still clears the in-flight flag)
      const older: Msg[] = d.messages || [];
      if (older.length) {
        const el = scrollRef.current;
        prependRestoreRef.current = el ? el.scrollHeight : null;
        setMsgs((m) => [...older, ...m]);
        try {
          const olderThreadMeta = await fetchThreadMetadata(api, chId, older.map((message) => message.id));
          if (curIdRef.current === chId) setThreadMeta((current) => ({ ...olderThreadMeta, ...current }));
        } catch { /* message history remains usable when optional thread previews fail */ }
      } // capture height right before prepend; layout effect restores after
      setHasMore(!!d.hasMore);
    } catch { /* transient — the next scroll-to-top retries */ } finally { loadingOlderRef.current = false; }
  };
  const onScroll = () => { const el = scrollRef.current; if (!el) return; if (el.scrollTop < 80 && hasMore && !loadingOlderRef.current) void loadOlder(); const st = nextScrollState(el, showJumpRef.current); atBottomRef.current = st.atBottom; if (!scrollingToBottomRef.current && st.changed) setJumpVisible(st.showJump); };
  // highlightedMsgRef guards the flash to once per target. The deps below include `msgs`, so without it every
  // incoming live message (msgs changes) would re-run this while ?msg= is still in the URL and re-flash the
  // inbox-clicked message on each new message. Re-armed on channel switch so re-opening the same target flashes again.
  const highlightedMsgRef = useRef<string | null>(null);
  useEffect(() => { highlightedMsgRef.current = null; }, [cur?.id]);
  useEffect(() => { // scroll to and highlight the target message for ~2s when msgParam is set (once per target)
    if (!msgParam) return;
    if (highlightedMsgRef.current === msgParam) return; // already flashed this target — ignore msgs/live-update re-runs
    const el = document.getElementById("m-" + msgParam);
    if (el) { highlightedMsgRef.current = msgParam; el.scrollIntoView({ block: "center" }); el.classList.add("msg-hl"); setTimeout(() => el.classList.remove("msg-hl"), 2200); } // no cleanup-cancel: the removal must outlive re-renders, else a re-render cancels the timer and the highlight sticks
    else if (hasMore && !loadingOlderRef.current) void loadOlder(); // target outside the loaded window → page older history (re-runs on each prepend via the msgs dep) until it appears or the channel start is reached
  }, [msgParam, msgs, hasMore]);
  useEffect(() => { // ?thread= opens or switches the topic panel after finding its parent message (full id or 8-char short id) in the loaded list
    if (!threadParam || !msgs.length) return;
    const short = threadParam.includes(":") ? threadParam.split(":").pop()! : threadParam;
    if (thread && (thread.parent.id === threadParam || thread.parent.id.startsWith(short))) return;
    const m = msgs.find((x) => x.id === threadParam || x.id.startsWith(short));
    if (m) startThread(m);
    else if (hasMore && !loadingOlderRef.current) void loadOlder(); // parent outside the loaded window → page older history until it appears or the channel start is reached
    // eslint-disable-next-line
  }, [threadParam, msgs, hasMore, threadMeta, conversationReadOnly]);

  const startThread = async (m: Msg) => { if (!cur) return; const meta = threadMeta[m.id]; if (conversationReadOnly && !meta?.threadChannelId) return; const tid = meta?.threadChannelId || await openThread(cur.id, m.id); if (tid) { const followed = meta?.followed ?? true; setThreadWidth(null); setThread({ channelId: tid, parent: m, followed }); setThreadMeta((tm) => (tm[m.id] ? { ...tm, [m.id]: { ...tm[m.id]!, unreadCount: 0 } } : tm)); markRead(tid); } }; // read-only conversations can open existing topics but never create a new one
  const closeThread = () => {
    setThread(null);
    setThreadWidth(null);
    if (!sp.has("thread")) return;
    const next = new URLSearchParams(sp);
    next.delete("thread");
    next.delete("threadMsg");
    setSp(next, { replace: true });
  };
  // "Jump to unread thread" bar: open a thread whose parent message may not be in the loaded page — fetch the parent
  // by id (it isn't on screen to pass through startThread), open the panel, mark it read, and drop it from the bar.
  const openUnreadThread = async (item: { threadChannelId: string; parentMessageId: string }) => {
    if (!cur) return;
    try {
      const parent = (await api("GET", `/api/messages/${item.parentMessageId}`))?.message as Msg | undefined;
      if (!parent) return;
      setThreadWidth(null);
      setThread({ channelId: item.threadChannelId, parent, followed: true });
      setThreadMeta((tm) => (tm[parent.id] ? { ...tm, [parent.id]: { ...tm[parent.id]!, unreadCount: 0 } } : tm));
      markRead(item.threadChannelId);
      setUnreadThreads((list) => list.filter((th) => th.threadChannelId !== item.threadChannelId));
    } catch { /* parent fetch failed (deleted / no access) — leave the bar untouched */ }
  };
  // Returns the display name of the task assignee, used by the task pill
  const taskAssignee = (m: Msg) => { if (!m.taskAssigneeId) return ""; const a = agents.find((x) => x.id === m.taskAssigneeId); if (a) return " @" + (a.displayName || a.name); return m.taskAssigneeId === me?.id ? " @" + me.name : ""; };
  // Handles task status change / claim from the task badge; socket message:updated event refreshes the message automatically
  const doTask = async (m: Msg, action: string, body?: unknown) => { try { await api("PATCH", `/api/tasks/${m.id}/${action}`, body); } catch { /* will self-correct on next reload */ } };
  const copyMarkdown = (content: string) => { navigator.clipboard?.writeText(content).catch(() => {}); };
  const agentLiveState = (a?: (typeof agents)[number]) => {
    if (!a) return "offline";
    const activity = a.activity && a.activity !== "offline" ? a.activity : "";
    const status = a.status && a.status !== "offline" ? a.status : "";
    return activity || status || "offline";
  };
  // Routes inline token clicks (@mention / #channel / thread / task #N) inside MessageContent
  const navToken = async (type: string, args: string[], trigger?: HTMLElement) => {
    if (type === "agent") return trigger ? openMessageAgentCard(args[0]!, trigger) : openAgentProfile(args[0]!);
    if (type === "human") return trigger ? openMessageHumanCard(me?.name || "Human", null, trigger) : openHumanSettings();
    if (type === "channel") return navigateConversation(`/s/${slug}/channel/${args[0]}`);
    if (type === "thread") return navigateConversation(`/s/${slug}/channel/${args[0]}?thread=${args[0]}:${args[1]}`);
    if (type === "task") {
      const num = Number(args[0]);
      const local = msgs.find((x) => x.taskNumber === num);
      if (local && cur) return navigateConversation(`/s/${slug}/channel/${cur.id}?msg=${local.id}`);
      try { const r = await api("GET", "/api/tasks/space"); const tk = (r?.tasks ?? r ?? []).find((x: any) => x.taskNumber === num); if (tk) navigateConversation(`/s/${slug}/channel/${tk.channelId}?msg=${tk.id}`); } catch { /* */ }
    }
  };

  const openCurrentTasks = () => {
    if (!cur) return;
    if (onOpenTasks) return onOpenTasks(cur.id);
    nav(workspaceLocationForModule(
      routeLocation.pathname,
      routeLocation.search,
      { moduleId: "tasks", taskScope: cur.id },
      { chatVisible: true },
    ));
  };

  const renderConversationListControl = () => onToggleConversationList ? (
    <button
      ref={conversationToggleRef}
      type="button"
      className="chat-head-icon-btn"
      title={conversationListOpen ? "收起对话列表" : "展开对话列表"}
      aria-label={conversationListOpen ? "收起对话列表" : "展开对话列表"}
      aria-pressed={conversationListOpen}
      onClick={onToggleConversationList}
    >
      <MessagesSquare size={17} />
    </button>
  ) : null;

  const renderAggregateControl = () => onToggleAggregate ? (
    <button
      ref={aggregateToggleRef}
      type="button"
      className="chat-head-icon-btn"
      title={aggregateAvailable ? (aggregateOpen ? "收起聚合面板" : "展开聚合面板") : "当前宽度不足，无法展开聚合面板"}
      aria-label={aggregateAvailable ? (aggregateOpen ? "收起聚合面板" : "展开聚合面板") : "当前宽度不足，无法展开聚合面板"}
      aria-pressed={aggregateOpen}
      disabled={!aggregateAvailable && !aggregateOpen}
      onClick={onToggleAggregate}
    >
      <PanelsTopLeft size={17} />
    </button>
  ) : null;

  const renderConversationActions = () => cur ? (
    <div className="chat-head-actions">
      {dmAgent ? (
        <button
          type="button"
          className="chat-agent-profile-btn chat-head-icon-btn"
          title={t("chat.openAgentProfile")}
          aria-label={t("chat.openAgentProfile")}
          onClick={() => openAgentProfile(dmAgent.id)}
        >
          <ExternalLink size={16} />
        </button>
      ) : null}
      <button type="button" className="chat-head-icon-btn" title={t("nav.tasks")} aria-label={t("nav.tasks")} onClick={openCurrentTasks}>
        <ListTodo size={17} />
      </button>
      {renderAggregateControl()}
      {!isDm && onOpenChannelSettings ? (
        <button type="button" className="chat-head-icon-btn" title={t("chat.channelSettings")} aria-label={t("chat.channelSettings")} onClick={(event) => onOpenChannelSettings(cur.id, event.currentTarget)}>
          <MoreHorizontal size={17} />
        </button>
      ) : null}
    </div>
  ) : null;


  return (
    <>
      {!embedded && <ChatSidebar />}
      {!thread || !threadOnly ? <main ref={chatMainRef} className={"content-col" + (isArchived ? " archived-readonly" : "")}>
        <div className="head chat-head">
          <div className="chat-head__rail">
            {renderConversationListControl()}
            <h1 className={isDm ? "chat-head__dm-title" : "chat-head__channel-title"}>
              {isDm
                ? <>{dmAgent ? <Avatar seed={dmAgent.name} url={avFor(dmAgent.avatarUrl)} size={24} /> : null}{cur?.name || ""}</>
                : <><Hash size={18} className="channel-row-icon" aria-hidden="true" />{cur?.name || "…"}</>}
            </h1>
            {dmAgent
              ? <span className="head-status"><span className={"dot " + agentLiveState(dmAgent)} aria-hidden="true" />{agentStatusLabel(t, agentLiveState(dmAgent))}</span>
              : <small>{sub || cur?.description || ""}</small>}
            {renderConversationActions()}
          </div>
        </div>
        <>
            {isArchived ? (
              <div className="archived-channel-banner" role="status">
                <Archive size={15} />
                <span className="grow">{t("channelSettings.archivedReadOnly")}</span>
                <button type="button" disabled={restoringArchived} onClick={restoreArchivedChannel}>
                  {t(restoringArchived ? "channelSettings.restoring" : "channelSettings.restoreChannel")}
                </button>
              </div>
            ) : null}
            {unreadThreads.length > 0 && (
              <button className="unread-threads-bar" onClick={() => openUnreadThread(unreadThreads[0]!)}>
                <MessageCircle size={14} />
                <span className="utb-label">{t("chat.unreadThreads", { count: unreadThreads.reduce((s, th) => s + th.unreadCount, 0) })}</span>
                <span className="utb-cta">{t("chat.viewUnreadThread")}</span>
              </button>
            )}
            <div key={cur?.id} className={"scroll ch-view-enter" + (unreadThreads.length > 0 ? " scroll-fade-top" : "")} ref={scrollRef} onScroll={onScroll}>
              {!loaded && <ChatSkeleton />}
              {loaded && loadError && <PaneEmpty icon={<MessageCircle size={30} />} title={t("chat.loadFailedTitle")} sub={<><span>{t("chat.loadFailedBody")}</span><button className="joinbtn" onClick={loadCurrentMessages}>{t("chat.retryLoad")}</button></>} />}
              {loaded && !loadError && !msgs.length && <PaneEmpty icon={<MessageCircle size={30} />} title={t("chat.channelEmpty")} />}
              {loaded && !loadError && msgs.map((m, mIdx) => {
                const ag = m.senderType === "agent" && m.senderId ? agents.find((a) => a.id === m.senderId) : undefined; // used for role description and avatar status dot
                const deletedAgent = m.senderType === "agent" && m.senderDeleted;
                const agLive = agentLiveState(ag);
                const tm = threadMeta[m.id];
                const hasInlineMeta = !!m.taskStatus || !!m.reactions?.length;
                const isAgentReplyPreview = m.messageType === AGENT_REPLY_PREVIEW_TYPE;
                const agentReplyPreview = isAgentReplyPreview ? m as AgentReplyPreviewMsg : undefined;
                if (agentReplyPreview && !agentReplyPreview.streamVisible) return null;
                const prevMsg = msgs[mIdx - 1];
                const nextMsg = msgs[mIdx + 1];
                const continuation = shouldGroupMessage(prevMsg, m);
                const hasContinuation = shouldGroupMessage(m, nextMsg);
                const dateDivider: ReactNode = m.createdAt && !isSameLocalDay(m.createdAt, prevMsg?.createdAt)
                  ? <div className="date-divider"><span className="date-divider-label">{fmtDateDivider(m.createdAt, i18n.language, t("chat.dateToday"), t("chat.dateYesterday"))}</span></div>
                  : null;
                // action card (agent proposal card) → rendered by dedicated ActionCardMsg component
                if (m.messageType === "action" && m.actionMetadata?.kind === "action-card") return <Fragment key={m.id}>{dateDivider}<ActionCardMsg m={m} readOnly={conversationReadOnly} onOpenAgentCard={openMessageAgentCard} onMentionAgent={mentionAgent} /></Fragment>;
                // system messages (task lifecycle events, etc.) → centered grey bar (no avatar, no full message block)
                // If the system message has thread replies, render a thread pill below the bar so it stays reachable.
                if (m.senderType === "system") return (
                  <Fragment key={m.id}>
                    {dateDivider}
                    <div className="msg-sys" id={"m-" + m.id}>
                      <MessageContent content={m.content} mentions={m.mentions || []} channels={messageChannels} nav={navToken} />
                      {tm?.replyCount ? <button className="thread-pill" onClick={() => startThread(m)}><MessageCircle size={12} /> {t("chat.replyCount", { count: tm.replyCount })}</button> : null}
                    </div>
                  </Fragment>
                );
                const messageTone = surfaceForSender(m.senderType === "agent" ? "agent" : "human");
                const staggerIdx = newMsgOrderRef.current.get(m.id);
                const isNewMsg = staggerIdx !== undefined;
                const shouldEnter = isNewMsg || !!agentReplyPreview;
                const avatar = deletedAgent
                  ? <span className="msg-av"><Avatar seed={m.senderName} size={32} /></span>
                  : ag
                  ? <button type="button" className="msg-av clickable" aria-label={t("chat.openAgentCard", { name: m.senderName })} aria-haspopup="dialog" onClick={(event) => openMessageAgentCard(m.senderId!, event.currentTarget)}><Avatar seed={m.senderName} url={senderAvatar(m)} size={32} />{agLive !== "offline" && <span className={"av-status " + agLive} />}</button>
                  : m.senderId
                    ? <button type="button" className="msg-av clickable" aria-label={t("chat.openHumanCard", { name: m.senderName })} aria-haspopup="dialog" onClick={(event) => openMessageHumanCard(m.senderName, senderAvatar(m), event.currentTarget)}><Avatar seed={m.senderName} url={senderAvatar(m)} size={32} /></button>
                    : <span className="msg-av"><Avatar seed={m.senderName} url={senderAvatar(m)} size={32} /></span>;
                const sender = deletedAgent
                  ? <DeletedAgentName displayName={m.senderName} />
                  : ag
                  ? <AgentMentionName displayName={m.senderName} mentionName={ag.name} disabled={conversationReadOnly} onMention={mentionAgent} />
                  : m.senderId
                    ? <span className="who">{m.senderName}</span>
                    : <span className="who">{m.senderName}</span>;
                return (
                <Fragment key={renderKeyForMessage(m)}>
                  {dateDivider}
                  <ChatMessageItem
                    id={"m-" + m.id}
                    surface={messageTone}
                    className={[
                      shouldEnter ? "msg-enter" : "",
                      continuation ? "chat-message--continuation" : "",
                      hasContinuation ? "chat-message--has-continuation" : "",
                    ].filter(Boolean).join(" ")}
                    style={isNewMsg ? { "--msg-delay": `${staggerIdx * 60}ms` } as CSSProperties : undefined}
                    onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ m, x: e.clientX, y: e.clientY }); }}
                    avatar={continuation ? null : avatar}
                    continuationTimestamp={continuation ? fmtMessageTime(m.createdAt) : null}
                    header={continuation ? null : <MessageHeader
                      sender={sender}
                      timestamp={fmtMessageTimestamp(m.createdAt)}
                    />}
                    toolbar={<MessageToolbar>
                      {!conversationReadOnly ? <ReactionToolbarButton onReact={(emoji) => react(m.id, emoji, false)} /> : null}
                      {!conversationReadOnly || tm?.threadChannelId ? <button title={t("chat.openThread")} aria-label={t("chat.openThread")} onClick={() => startThread(m)}><MessageCircle size={15} /></button> : null}
                      <button title={t("chat.copyMarkdown")} aria-label={t("chat.copyMarkdown")} onClick={() => copyMarkdown(m.content)}><Clipboard size={15} /></button>
                      <button title={t("chat.more")} aria-label={t("chat.more")} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setCtxMenu({ m, x: r.right - 212, y: r.bottom + 4 }); }}><MoreHorizontal size={15} /></button>
                    </MessageToolbar>}
                  >
                    {isAgentReplyPreview && !m.content
                      ? <AgentReplyPreviewBody m={m} />
                      : !!m.content && <div className="mbody"><MessageContent content={m.content} mentions={m.mentions || []} channels={messageChannels} nav={navToken} /></div>}
                    {!!m.attachments?.length && <div className={`msg-atts attachment-list${isSingleImageMessage(m.attachments) ? " attachment-list--single-image" : ""}`}>{m.attachments.map((a) => <AttCard key={a.id} a={a} url={attachmentUrl(a.id)} gallery={messageImageGallery} />)}</div>}
                    {hasInlineMeta ? <div className="msg-meta">
                        {m.taskStatus && (() => {
                          const TI = TASK_ICON[m.taskStatus] || Circle;
                          const readOnlyTask = isArchived;
                          const claimable = !readOnlyTask && !m.taskAssigneeId && m.taskStatus === "todo";
                          const opts = taskStatusOptions();
                          const open = !readOnlyTask && taskMenu === m.id;
                          return (
                            <span className="task-pill-wrap">
                              {/* clicking the badge changes status; in read-only conversations it is plain metadata */}
                              {readOnlyTask
                                ? <span className={"task-pill is-readonly st-" + m.taskStatus}><TI size={11} /> #{m.taskNumber} {t(ST_LABEL[m.taskStatus] ?? m.taskStatus)}{taskAssignee(m)}</span>
                                : <button className={"task-pill st-" + m.taskStatus} onClick={(e) => { e.stopPropagation(); setTaskMenu(open ? null : m.id); }} title={t("chat.taskChangeStatus", { number: m.taskNumber })}><TI size={11} /> #{m.taskNumber} {t(ST_LABEL[m.taskStatus] ?? m.taskStatus)}{taskAssignee(m)}</button>}
                              {open && <div className="st-menu" onMouseLeave={() => setTaskMenu(null)}>
                                {claimable && <button onClick={() => { setTaskMenu(null); doTask(m, "claim"); }}>{t("chat.claim")}</button>}
                                {opts.map((s) => <button key={s} className={s === m.taskStatus ? "on" : ""} onClick={() => { setTaskMenu(null); if (s !== m.taskStatus) doTask(m, "status", { status: s }); }}><span className={"st-dot st-" + s} />{t(ST_LABEL[s])}</button>)}
                              </div>}
                            </span>
                          );
                        })()}
                        {m.reactions?.length ? <Reactions m={m} mine={me?.id ?? ""} readOnly={conversationReadOnly} onReact={(emoji, remove) => react(m.id, emoji, remove)} /> : null}
                      </div> : null}
                    {tm?.replyCount ? <MessageTopicPreview
                      meta={tm}
                      onOpen={() => startThread(m)}
                      avatarUrlFor={(reply) => reply.senderType === "agent"
                        ? avFor(agents.find((agent) => agent.id === reply.senderId)?.avatarUrl)
                        : undefined}
                    /> : null}
                  </ChatMessageItem>
                </Fragment>
                );
              })}
            </div>
            {showJump && <button className="jump-bottom" onClick={toBottom}><ArrowDown size={14} /> {t("chat.backToBottom")}</button>}
            {isArchived
              ? null
              : <Composer
                  ref={composerRef}
                  channelId={cur?.id ?? ""}
                  placeholder={isDm ? t("chat.dmPlaceholder", { name: cur?.name }) : t("chat.channelPlaceholder")}
                  allowAsTask
                  allowChannelAllMention={!isDm}
                  validateChannelTaskMentions={!isDm}
                  dmAgent={isDm ? dmAgent : undefined}
                />}
          </>
      </main> : null}
      {thread
        ? <>
            {!threadOnly ? (
              <VerticalDragDivider
                className="chat-thread-divider"
                ariaLabel="调整对话与话题宽度"
                value={threadConstraints.width}
                min={threadConstraints.min}
                max={threadConstraints.max}
                onChange={setThreadWidth}
              />
            ) : null}
            <ThreadPanel
              channelId={thread.channelId}
              parent={thread.parent}
              solo={threadOnly}
              style={threadOnly ? undefined : { width: threadConstraints.width, flexBasis: threadConstraints.width }}
              followed={thread.followed}
              readOnly={conversationReadOnly}
              headerLeading={threadOnly ? renderConversationListControl() : undefined}
              headerActions={threadOnly ? renderConversationActions() : undefined}
              onFollowChange={(followed) => {
                setThread((current) => current ? { ...current, followed } : current);
                setThreadMeta((current) => ({
                  ...current,
                  [thread.parent.id]: {
                    threadChannelId: thread.channelId,
                    replyCount: current[thread.parent.id]?.replyCount ?? 0,
                    unreadCount: current[thread.parent.id]?.unreadCount,
                    followed,
                  },
                }));
              }}
              onClose={closeThread}
              onOpenAgent={openAgentProfile}
              onOpenAgentCard={openMessageAgentCard}
              onOpenHumanCard={openMessageHumanCard}
              allowChannelAllMention={!isDm}
              focusMessageId={threadMsgParam}
            />
          </>
        : !embedded && <aside className="traj-col"><LiveTrace conversationId={cur?.id} /></aside>}
      {ctxMenu && (() => {
        const m = ctxMenu.m;
        const close = () => setCtxMenu(null);
        const link = `${location.origin}/s/${slug}/channel/${m.channelId}?msg=${m.id}`;
        return (
          <MessageContextMenu
            m={m}
            x={ctxMenu.x}
            y={ctxMenu.y}
            link={link}
            readOnly={conversationReadOnly}
            saved={savedIds.has(m.id)}
            onClose={close}
            onReact={(emoji) => react(m.id, emoji, false)}
            onOpenThread={!conversationReadOnly || threadMeta[m.id]?.threadChannelId ? () => startThread(m) : undefined}
            onToggleSave={() => { savedIds.has(m.id) ? unsaveMsg(m.id) : saveMsg(m.id); }}
            onConvertTask={() => { void api("POST", "/api/tasks/convert-message", { messageId: m.id }); }}
          />
        );
      })()}
      {agentCard && (() => {
        const a = agents.find((candidate) => candidate.id === agentCard.id);
        if (!a) return null;
        return (
          <AgentMessageCard
            agent={a}
            avatarUrl={avFor(a.avatarUrl)}
            anchor={agentCard.anchor}
            trigger={agentCard.trigger}
            member={channelResponseModes.modes[a.id]}
            readOnly={responseModeReadOnly}
            onClose={() => setAgentCard(null)}
            onMessage={() => messageAgent(a.id)}
            onChangeChannelMode={(value) => channelResponseModes.setResponseModeOverride(a.id, value)}
          />
        );
      })()}
      {humanCard ? (
        <HumanMessageCard
          name={humanCard.name}
          avatarUrl={humanCard.avatarUrl}
          anchor={humanCard.anchor}
          trigger={humanCard.trigger}
          onClose={() => setHumanCard(null)}
        />
      ) : null}
    </>
  );
}

// Thread panel: right-side overlay showing the parent message, its replies, and a reply composer.
function ThreadPanel({ channelId, parent, followed, readOnly = false, solo = false, style, headerLeading, headerActions, onClose, onFollowChange, onOpenAgent, onOpenAgentCard, onOpenHumanCard, allowChannelAllMention, focusMessageId }: { channelId: string; parent: Msg; followed: boolean; readOnly?: boolean; solo?: boolean; style?: CSSProperties; headerLeading?: ReactNode; headerActions?: ReactNode; onClose: () => void; onFollowChange: (followed: boolean) => void; onOpenAgent: (id: string) => void; onOpenAgentCard: (agentId: string, trigger: HTMLElement) => void; onOpenHumanCard: (name: string, avatarUrl: string | null, trigger: HTMLElement) => void; allowChannelAllMention: boolean; focusMessageId?: string | null }) {
  const { t } = useTranslation();
  const { api, onEvent, subscribeChannel, attachmentUrl, me, react, agents, channels, archivedChannels, slug, savedIds, saveMsg, unsaveMsg } = useStore();
  const senderAvatar = (m: Msg) => resolveAvatar(m.senderType === "agent" ? agents.find((agent) => agent.id === m.senderId)?.avatarUrl : undefined, attachmentUrl);
  const nav = useNavigate();
  const routeLocation = useLocation();
  const navigateConversation = (target: string) => nav(workspaceLocationForConversation(
    target,
    routeLocation.pathname,
    routeLocation.search,
  ));
  const openHumanSettings = () => nav(workspaceLocationForModule(
    routeLocation.pathname,
    routeLocation.search,
    { moduleId: "settings", settings: "human" },
  ));
  const navToken = async (type: string, args: string[], trigger?: HTMLElement) => {
    if (type === "agent") return trigger ? onOpenAgentCard(args[0]!, trigger) : onOpenAgent(args[0]!);
    if (type === "human") return trigger ? onOpenHumanCard(me?.name || "Human", null, trigger) : openHumanSettings();
    if (type === "channel") return navigateConversation(`/s/${slug}/channel/${args[0]}`);
    if (type === "thread") return navigateConversation(`/s/${slug}/channel/${args[0]}?thread=${args[0]}:${args[1]}`);
    if (type === "task") { try { const r = await api("GET", "/api/tasks/space"); const tk = (r?.tasks ?? r ?? []).find((x: any) => x.taskNumber === Number(args[0])); if (tk) navigateConversation(`/s/${slug}/channel/${tk.channelId}?msg=${tk.id}`); } catch { /* */ } }
  };
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const threadImageGallery = useMemo(() => buildMessageImageGallery([parent, ...msgs], attachmentUrl), [attachmentUrl, msgs, parent]);
  const [followPending, setFollowPending] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ m: Msg; x: number; y: number } | null>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const highlightedReplyRef = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    setMsgs([]);
    subscribeChannel(channelId);
    void (async () => {
      const d = await api("GET", `/api/messages/channel/${channelId}?limit=200`);
      if (active) setMsgs(d.messages || []);
    })();
    return () => { active = false; };
  }, [channelId]); // join the thread room so replies arrive live (openThread/startThread do not make the socket a room member on their own)
  useEffect(() => onEvent((e) => {
    if (e.type === "message" && e.channelId === channelId) setMsgs((m) => {
      const preview = absorbPersistedAgentMessagePreview(m, e.message);
      if (preview.consumed) return preview.messages;
      return [...dropAgentReplyPreviewsForMessage(m, e.message), e.message];
    });
    else if (e.type === "message:updated" && e.message?.channelId === channelId) setMsgs((m) => m.map((x) => (x.id === e.message.id ? { ...x, ...e.message } : x)));
    else if (e.type === "agent:deleted" && e.id) setMsgs((current) => current.map((message) => message.senderId === e.id
      ? { ...message, senderDeleted: true }
      : message));
    else if (e.type === "agent:reply" && e.channelId === channelId) setMsgs((m) => applyAgentReplyPreview(m, e as AgentReplyEvent, agents.find((a) => a.id === e.agentId)));
  }), [channelId, agents]);
  const streamingPreviewActive = hasStreamingAgentReplyPreview(msgs);
  useEffect(() => {
    if (!streamingPreviewActive) return;
    const timer = window.setInterval(() => {
      setMsgs((m) => {
        const tick = tickAgentReplyPreviews(m);
        return tick.changed ? tick.messages : m;
      });
    }, AGENT_REPLY_STREAM_TICK_MS);
    return () => window.clearInterval(timer);
  }, [streamingPreviewActive]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs]);
  useEffect(() => { highlightedReplyRef.current = null; }, [channelId]);
  useEffect(() => {
    if (!focusMessageId || highlightedReplyRef.current === focusMessageId) return;
    const element = document.getElementById(`m-${focusMessageId}`);
    if (!element) return;
    highlightedReplyRef.current = focusMessageId;
    element.scrollIntoView({ block: "center" });
    element.classList.add("msg-hl");
    window.setTimeout(() => element.classList.remove("msg-hl"), 2200);
  }, [focusMessageId, msgs]);
  const toggleFollow = async () => {
    if (followPending) return;
    const next = !followed;
    setFollowPending(true);
    try {
      await api("POST", `/api/channels/threads/${next ? "follow" : "unfollow"}`, { threadChannelId: channelId });
      onFollowChange(next);
    } finally {
      setFollowPending(false);
    }
  };
  const row = (m: Msg, dateDivider?: ReactNode, continuation = false, hasContinuation = false) => {
    if (m.senderType === "system") return <Fragment key={m.id}>{dateDivider}<div className="msg-sys" id={"m-" + m.id}>{m.content}</div></Fragment>; // system messages render as a banner with no avatar
    const ag = m.senderType === "agent" && m.senderId ? agents.find((a) => a.id === m.senderId) : undefined;
    const deletedAgent = m.senderType === "agent" && m.senderDeleted;
    const live = ag ? ((ag.activity && ag.activity !== "offline" ? ag.activity : ag.status) || "offline") : "offline";
    const isAgentReplyPreview = m.messageType === AGENT_REPLY_PREVIEW_TYPE;
    const agentReplyPreview = isAgentReplyPreview ? m as AgentReplyPreviewMsg : undefined;
    if (agentReplyPreview && !agentReplyPreview.streamVisible) return null;
    return (
    <Fragment key={renderKeyForMessage(m)}>
      {dateDivider}
      <ChatMessageItem
        id={"m-" + m.id}
        surface="thread"
        tone={surfaceForSender(m.senderType === "agent" ? "agent" : "human")}
        className={[
          agentReplyPreview ? "msg-enter" : "",
          continuation ? "chat-message--continuation" : "",
          hasContinuation ? "chat-message--has-continuation" : "",
        ].filter(Boolean).join(" ")}
        onContextMenu={(event) => { event.preventDefault(); setCtxMenu({ m, x: event.clientX, y: event.clientY }); }}
        avatar={continuation ? null : deletedAgent
          ? <span className="msg-av"><Avatar seed={m.senderName} size={32} /></span>
          : ag
          ? <button type="button" className="msg-av clickable" aria-label={t("chat.openAgentCard", { name: m.senderName })} aria-haspopup="dialog" onClick={(event) => onOpenAgentCard(m.senderId!, event.currentTarget)}><Avatar seed={m.senderName} url={senderAvatar(m)} size={32} />{live !== "offline" && <span className={"av-status " + live} />}</button>
          : m.senderId
            ? <button type="button" className="msg-av clickable" aria-label={t("chat.openHumanCard", { name: m.senderName })} aria-haspopup="dialog" onClick={(event) => onOpenHumanCard(m.senderName, senderAvatar(m), event.currentTarget)}><Avatar seed={m.senderName} url={senderAvatar(m)} size={32} /></button>
            : <span className="msg-av"><Avatar seed={m.senderName} url={senderAvatar(m)} size={32} /></span>}
        continuationTimestamp={continuation ? fmtMessageTime(m.createdAt) : null}
        header={continuation ? null : <MessageHeader
          sender={deletedAgent
            ? <DeletedAgentName displayName={m.senderName} />
            : ag
            ? <AgentMentionName displayName={m.senderName} mentionName={ag.name} disabled={readOnly} onMention={(agentName) => composerRef.current?.mentionAgent(agentName)} />
            : m.senderId
              ? <span className="who">{m.senderName}</span>
              : <span className="who">{m.senderName}</span>}
          timestamp={fmtMessageTimestamp(m.createdAt)}
        />}
        toolbar={<MessageToolbar>
          {!readOnly ? <ReactionToolbarButton onReact={(emoji) => react(m.id, emoji, false)} /> : null}
          <button title={t("chat.copyMarkdown")} aria-label={t("chat.copyMarkdown")} onClick={() => { navigator.clipboard?.writeText(m.content).catch(() => {}); }}><Clipboard size={15} /></button>
          <button title={t("chat.more")} aria-label={t("chat.more")} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setCtxMenu({ m, x: rect.right - 212, y: rect.bottom + 4 }); }}><MoreHorizontal size={15} /></button>
        </MessageToolbar>}
      >
        {isAgentReplyPreview && !m.content
          ? <AgentReplyPreviewBody m={m} />
          : !!m.content && <div className="mbody"><MessageContent content={m.content} mentions={m.mentions || []} channels={[...channels, ...archivedChannels]} nav={navToken} /></div>}
        {!!m.attachments?.length && <div className={`msg-atts attachment-list${isSingleImageMessage(m.attachments) ? " attachment-list--single-image" : ""}`}>{m.attachments.map((a) => <AttCard key={a.id} a={a} url={attachmentUrl(a.id)} gallery={threadImageGallery} />)}</div>}
        <Reactions m={m} mine={me?.id ?? ""} readOnly={readOnly} onReact={(emoji, remove) => react(m.id, emoji, remove)} />
      </ChatMessageItem>
    </Fragment>
    );
  };
  return (
    <aside className={`thread-panel${solo ? " thread-panel--solo" : ""}`} style={style}>
      <div className="thread-head">{headerLeading}<span className="grow">{t("chat.thread")}</span>{headerActions}
        {!readOnly ? <button className="tp-link" title={t("chat.markDone")} onClick={async () => { await api("POST", "/api/channels/threads/done", { threadChannelId: channelId }); onClose(); }}><CheckCircle2 size={14} /></button> : null}
        {!readOnly ? <button className="tp-link" title={followed ? t("chat.unfollowThread") : t("chat.followThread")} aria-label={followed ? t("chat.unfollowThread") : t("chat.followThread")} aria-pressed={followed} disabled={followPending} onClick={toggleFollow}>{followed ? <Bell size={14} /> : <BellOff size={14} />}</button> : null}
        <button className="tp-link" onClick={() => navigateConversation(`/s/${slug}/channel/${parent.channelId}?msg=${parent.id}`)} title={t("chat.viewInChannel")}><ExternalLink size={14} /></button>
        <button className="tp-close" onClick={onClose} title={t("chat.close")}><X size={15} /></button></div>
      <div className="scroll" ref={scrollRef}>
        <div className="thread-parent">{row(parent)}</div>
        <div className="thread-sep">{t("chat.replyCount", { count: msgs.length })}</div>
        {msgs.map((m, i) => {
          const prevMsg = msgs[i - 1];
          const nextMsg = msgs[i + 1];
          const continuation = shouldGroupMessage(prevMsg, m);
          const hasContinuation = shouldGroupMessage(m, nextMsg);
          const dateDivider: ReactNode = m.createdAt && !isSameLocalDay(m.createdAt, prevMsg?.createdAt)
            ? <div className="date-divider"><span className="date-divider-label">{fmtDateDivider(m.createdAt, i18n.language, t("chat.dateToday"), t("chat.dateYesterday"))}</span></div>
            : null;
          return row(m, dateDivider, continuation, hasContinuation);
        })}
      </div>
      {readOnly
        ? <div className="conversation-readonly"><Archive size={14} />{t("channelSettings.archivedReadOnly")}</div>
        : <Composer ref={composerRef} channelId={channelId} placeholder={t("chat.threadReplyPlaceholder")} allowChannelAllMention={allowChannelAllMention} className="thread-composer" />}
      {ctxMenu ? <MessageContextMenu
        m={ctxMenu.m}
        x={ctxMenu.x}
        y={ctxMenu.y}
        link={`${location.origin}/s/${slug}/channel/${parent.channelId}?thread=${parent.id}&msg=${ctxMenu.m.id}`}
        readOnly={readOnly}
        saved={savedIds.has(ctxMenu.m.id)}
        onClose={() => setCtxMenu(null)}
        onReact={(emoji) => react(ctxMenu.m.id, emoji, false)}
        onToggleSave={() => { savedIds.has(ctxMenu.m.id) ? unsaveMsg(ctxMenu.m.id) : saveMsg(ctxMenu.m.id); }}
        onConvertTask={() => { void api("POST", "/api/tasks/convert-message", { messageId: ctxMenu.m.id }); }}
      /> : null}
    </aside>
  );
}
/* Removed direct channel-member modal; member management lives in channel settings.

        <h3># {channelName} · {t("chat.membersCount", { count: members.length })}</h3>
        <div className="sec">{t("common.agents")} <span className="cnt">{members.length}</span></div>
        {members.map((a) => (
          <div key={a.id} className="item"><Avatar seed={a.name} url={avFor(a.avatarUrl)} size={22} /><span className="grow">{a.displayName || a.name}</span><span className={"dot " + (a.activity || a.status)} />{!readOnly ? <button className="joinbtn" onClick={() => remove(a.id)}>{t("chat.remove")}</button> : null}</div>
        ))}
        {!readOnly && addable.length > 0 && <>
          <div className="sec sec-sub">{t("chat.addAgent")}</div>
          {addable.map((a) => (
            <div key={a.id} className="item ghost"><Avatar seed={a.name} url={avFor(a.avatarUrl)} size={22} /><span className="grow">{a.displayName || a.name}</span><button className="joinbtn" onClick={() => add(a.id)}>{t("chat.addToChannel")}</button></div>
          ))}
        </>}
        <div className="acts"><button className="cancel" onClick={onClose}>{t("chat.close")}</button></div>
      </div>
    </div>
  );
}
*/
