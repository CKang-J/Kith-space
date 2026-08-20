import { useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useLocation, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { useStore, type Msg, type Att } from "../store.tsx";
import { fmtMessageTime, isSameLocalDay, fmtDateDivider } from "../format";
import { AGENT_REPLY_PREVIEW_TYPE, renderKeyForMessage, type AgentReplyPreviewMsg } from "../lib/agentReplyPreview";
import { MessageContent } from "../messageRender.tsx";
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
import { buildMessageImageGallery, isSingleImageMessage } from "./chat-message/messageImageGallery.ts";
import { TurnDetailsButton } from "./chat-message/TurnDetailsButton.tsx";
import { CanvasContextChip } from "./chat-message/CanvasContextChip.tsx";
import { CanvasChip } from "./chat-message/CanvasChip.tsx";
import type { LightboxImage } from "../Lightbox.tsx";
import { useConversationApi } from "../features/conversation/data/conversationApi.ts";
import { useTaskApi } from "../features/conversation/data/taskApi.ts";
import { useConversationMessages } from "../features/conversation/model/useConversationMessages.ts";
import { useConversationViewport } from "../features/conversation/model/useConversationViewport.ts";
import { useConversationThreads, useThreadPanelModel } from "../features/conversation/model/useConversationThreads.ts";
import { copyText } from "../clipboard.ts";

export { animateBackToBottom, BACK_TO_BOTTOM_SCROLL_MS, keepPinnedToBottomDuringEnter, MESSAGE_ENTER_PIN_MS } from "../features/conversation/model/useConversationViewport.ts";

const CHAT_SURFACE_WIDTH_SETTLE_MS = 80;

const fmtSize = (n?: number) => (!n ? "" : n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB");

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

// Message and Composer attachments share the same responsive card. Images open the common viewer;
// every other type keeps a direct file link without introducing a second visual treatment.
function AttCard({ a, url, gallery }: { a: Att; url: string; gallery: readonly LightboxImage[] }) {
  const image = !!a.mimeType?.startsWith("image/");
  return <AttachmentCard filename={a.filename} mimeType={a.mimeType} imageSrc={image ? url : undefined} imageId={image ? a.id : undefined} imageGallery={image ? gallery : undefined} href={image ? undefined : url} sizeLabel={fmtSize(a.sizeBytes)} />;
}

function messageCanvasContexts(m: Msg) {
  return m.canvasContexts?.length ? m.canvasContexts : m.canvasContext ? [m.canvasContext] : [];
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
  const toast = useToast();
  const copy = async (text: string) => {
    const copied = await copyText(text);
    copied ? toast.info(t("clipboard.copied")) : toast.error(t("clipboard.copyFailed"));
    onClose();
  };
  return (
    <div className="ctx-backdrop" onClick={onClose} onContextMenu={(event) => { event.preventDefault(); onClose(); }}>
      <div className="ctx-menu" style={{ left: Math.min(x, window.innerWidth - 230), top: Math.min(y, window.innerHeight - 320) }} onClick={(event) => event.stopPropagation()}>
        {!readOnly ? <div className="ctx-rx">{QUICK_EMOJIS.slice(0, 6).map((emoji) => <button key={emoji} title={emoji} onClick={() => { onReact(emoji); onClose(); }}>{emoji}</button>)}</div> : null}
        <button className="ctx-item" onClick={() => { void copy(m.content); }}><Clipboard size={14} /> {t("chat.copyMarkdown")}</button>
        <button className="ctx-item" onClick={() => { void copy(link); }}><Link2 size={14} /> {t("chat.copyLink")}</button>
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
          ? <button type="button" className="msg-av clickable" aria-label={t("chat.openAgentCard", { name: m.senderName })} aria-haspopup="dialog" onClick={(event) => onOpenAgentCard(m.senderId!, event.currentTarget)}><Avatar seed={m.senderName} url={resolveAvatar(agent.avatarUrl, attachmentUrl)} size={36} />{live !== "offline" ? <span className={`av-status ${live}`} /> : null}</button>
          : <span className="msg-av"><Avatar seed={m.senderName} url={resolveAvatar(agent?.avatarUrl, attachmentUrl)} size={36} /></span>}
        header={<MessageHeader
          sender={agent
            ? <AgentMentionName displayName={m.senderName} mentionName={agent.name} disabled={readOnly} onMention={onMentionAgent} />
            : <span className="who">{m.senderName}</span>}
          badge={<span className="member-badge">{t("chat.proposed")}</span>}
        />}
        footerTimestamp={fmtMessageTime(m.createdAt)}
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
  conversationToggleRef?: RefObject<HTMLButtonElement | null>;
  aggregateOpen?: boolean;
  aggregateAvailable?: boolean;
  aggregateToggleRef?: RefObject<HTMLButtonElement | null>;
  onToggleConversationList?(): void;
  onToggleAggregate?(): void;
  onOpenTasks?(conversationId: string): void;
  onOpenChannelSettings?(channelId: string, trigger?: HTMLButtonElement): void;
  onNavigateConversation?(target: string): void;
  headerTrailingAction?: ReactNode;
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
  headerTrailingAction,
}: ChatProps) {
  const { t } = useTranslation();
  const { reload, channels, archivedChannels, dms, unread, agents, slug, me, attachmentUrl, react, openAgentDM, savedIds, saveMsg, unsaveMsg, agentPanelReq, clearAgentPanelReq } = useStore();
  const conversationApi = useConversationApi();
  const taskApi = useTaskApi();
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
  const [sub, setSub] = useState("");
  const [threadWidth, setThreadWidth] = useState<number | null>(null);
  const [chatSurfaceWidth, setChatSurfaceWidth] = useState(() => typeof window === "undefined" ? 1000 : window.innerWidth);
  const chatMainRef = useRef<HTMLElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const threadConstraints = threadPaneConstraints(
    chatSurfaceWidth,
    threadWidth ?? defaultThreadPaneWidth(chatSurfaceWidth),
  );
  const cur = [...channels, ...archivedChannels, ...dms].find((c) => c.id === channelId) || channels.find((c) => c.name === "all") || channels[0];
  const isArchived = !!cur && archivedChannels.some((channel) => channel.id === cur.id);
  const conversationReadOnly = isArchived;
  const [restoringArchived, setRestoringArchived] = useState(false);
  const messageChannels = [...channels, ...archivedChannels];
  const [sp, setSp] = useSearchParams();
  const msgParam = sp.get("msg");
  const messageModel = useConversationMessages(cur?.id, agents, me?.id);
  const { messages: msgs, loaded: messagesLoaded, loadError, hasMore, reload: loadCurrentMessages } = messageModel;
  const messageImageGallery = useMemo(() => buildMessageImageGallery(msgs, attachmentUrl), [attachmentUrl, msgs]);
  const threadModel = useConversationThreads({
    channel: cur,
    isArchived,
    unreadCount: unread[cur?.id ?? ""] ?? 0,
    currentUserId: me?.id,
    messages: msgs,
    initialPage: messageModel.initialPage,
    olderPage: messageModel.olderPage,
    hasMore,
    loadingOlderRef: messageModel.loadingOlderRef,
    loadOlder: messageModel.loadOlder,
  });
  const { thread, threadMeta, unreadThreads, startThread, closeThread, openUnreadThread, setThreadFollowed } = threadModel;
  useLayoutEffect(() => {
    // Only the thread pane consumes this width. Waiting for resize motion to settle
    // keeps the message timeline out of side-panel animation frames.
    if (threadOnly || !thread) return;
    const surface = chatMainRef.current?.parentElement;
    if (!surface) return;
    let settleTimer: number | null = null;
    const updateWidth = () => {
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        setChatSurfaceWidth(surface.clientWidth);
        settleTimer = null;
      }, CHAT_SURFACE_WIDTH_SETTLE_MS);
    };
    setChatSurfaceWidth(surface.clientWidth);
    const observer = new ResizeObserver(updateWidth);
    observer.observe(surface);
    return () => {
      observer.disconnect();
      if (settleTimer !== null) window.clearTimeout(settleTimer);
    };
  }, [threadOnly, thread?.channelId]);
  const loaded = messagesLoaded && threadModel.initialMetadataLoaded;
  const { scrollRef, showJump, onScroll, toBottom } = useConversationViewport(cur?.id, msgs, msgParam, messageModel);
  const newMsgOrderRef = messageModel.newMessageOrderRef;

  const restoreArchivedChannel = async () => {
    if (!cur || !isArchived || restoringArchived) return;
    setRestoringArchived(true);
    try {
      await conversationApi.unarchiveChannel(cur.id);
      await reload();
      toast.info(t("channelSettings.restoreSuccess"));
    } catch {
      toast.error(t("channelSettings.operationFailed"));
    } finally {
      setRestoringArchived(false);
    }
  };
  const isDm = !!dms.find((d) => d.id === cur?.id);
  const dmPeer = dms.find((d) => d.id === cur?.id);
  const dmAgent = dmPeer?.peerType === "agent" ? agents.find((a) => a.id === dmPeer.peerId) : undefined; // DM peer agent → used for the live status indicator in the header
  const responseModeChannelId = !isDm && cur?.type !== "thread" ? cur?.id : thread?.parent.channelId;
  const responseModeReadOnly = conversationReadOnly;
  const channelResponseModes = useChannelAgentResponseModes(responseModeChannelId, !!responseModeChannelId && !isDm);
  const threadMsgParam = threadModel.threadMessageId;
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

  useEffect(() => {
    if (!routeChannelId && !channelIdOverride && cur) navigateConversation(`/s/${slug}/channel/${cur.id}`, { replace: true });
  }, [routeChannelId, channelIdOverride, cur, slug, routeLocation.pathname, routeLocation.search, nav]);
  useEffect(() => { setThreadWidth(null); }, [cur?.id, thread?.channelId]);
  // The current-conversation activity summary opens the canonical Agents module on its Activity tab.
  useEffect(() => {
    if (!agentPanelReq) return;
    openAgentProfile(agentPanelReq, "activity");
    clearAgentPanelReq();
    // eslint-disable-next-line
  }, [agentPanelReq]);
  // Returns the display name of the task assignee, used by the task pill
  const taskAssignee = (m: Msg) => { if (!m.taskAssigneeId) return ""; const a = agents.find((x) => x.id === m.taskAssigneeId); if (a) return " @" + (a.displayName || a.name); return m.taskAssigneeId === me?.id ? " @" + me.name : ""; };
  // Handles task status change / claim from the task badge; socket message:updated event refreshes the message automatically
  const doTask = async (m: Msg, action: string, body?: unknown) => { try { await taskApi.updateMessageTask(m.id, action, body); } catch { /* will self-correct on next reload */ } };
  const copyMarkdown = async (content: string) => {
    const copied = await copyText(content);
    copied ? toast.info(t("clipboard.copied")) : toast.error(t("clipboard.copyFailed"));
  };
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
      try { const task = await taskApi.findTaskByNumber(num); if (task) navigateConversation(`/s/${slug}/channel/${task.channelId}?msg=${task.id}`); } catch { /* */ }
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
      {headerTrailingAction}
    </div>
  ) : null;


  return (
    <>
      {!embedded && <ChatSidebar />}
      {!thread || !threadOnly ? <main
        ref={chatMainRef}
        className={[
          "content-col",
          thread && !threadOnly ? "content-col--with-thread" : "",
          isArchived ? "archived-readonly" : "",
        ].filter(Boolean).join(" ")}
        style={thread && !threadOnly
          ? { "--chat-thread-occupied-width": `${threadConstraints.width + 10}px` } as CSSProperties
          : undefined}
      >
        <div className="head chat-head">
          <div className="chat-head__rail">
            {renderConversationListControl()}
            <h1 className={isDm ? "chat-head__dm-title" : "chat-head__channel-title"}>
              {isDm
                ? (cur?.name || "")
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
                  ? <span className="msg-av"><Avatar seed={m.senderName} size={36} /></span>
                  : ag
                  ? <button type="button" className="msg-av clickable" aria-label={t("chat.openAgentCard", { name: m.senderName })} aria-haspopup="dialog" onClick={(event) => openMessageAgentCard(m.senderId!, event.currentTarget)}><Avatar seed={m.senderName} url={senderAvatar(m)} size={36} />{agLive !== "offline" && <span className={"av-status " + agLive} />}</button>
                  : m.senderId
                    ? <button type="button" className="msg-av clickable" aria-label={t("chat.openHumanCard", { name: m.senderName })} aria-haspopup="dialog" onClick={(event) => openMessageHumanCard(m.senderName, senderAvatar(m), event.currentTarget)}><Avatar seed={m.senderName} url={senderAvatar(m)} size={36} /></button>
                    : <span className="msg-av"><Avatar seed={m.senderName} url={senderAvatar(m)} size={36} /></span>;
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
                      isDm ? "chat-message--direct" : "",
                      continuation ? "chat-message--continuation" : "",
                      hasContinuation ? "chat-message--has-continuation" : "",
                    ].filter(Boolean).join(" ")}
                    style={isNewMsg ? { "--msg-delay": `${staggerIdx * 60}ms` } as CSSProperties : undefined}
                    onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ m, x: e.clientX, y: e.clientY }); }}
                    avatar={continuation ? null : avatar}
                    header={continuation || isDm ? null : <MessageHeader sender={sender} />}
                    footerTimestamp={fmtMessageTime(m.createdAt)}
                    afterBubble={tm?.replyCount ? <MessageTopicPreview
                      meta={tm}
                      onOpen={() => startThread(m)}
                      avatarUrlFor={(reply) => reply.senderType === "agent"
                        ? avFor(agents.find((agent) => agent.id === reply.senderId)?.avatarUrl)
                        : undefined}
                    /> : null}
                    toolbar={<MessageToolbar>
                      {m.producedByTurnId ? <TurnDetailsButton turnId={m.producedByTurnId} /> : null}
                      {!conversationReadOnly ? <ReactionToolbarButton onReact={(emoji) => react(m.id, emoji, false)} /> : null}
                      {!conversationReadOnly || tm?.threadChannelId ? <button title={t("chat.openThread")} aria-label={t("chat.openThread")} onClick={() => startThread(m)}><MessageCircle size={15} /></button> : null}
                      <button title={t("chat.copyMarkdown")} aria-label={t("chat.copyMarkdown")} onClick={() => { void copyMarkdown(m.content); }}><Clipboard size={15} /></button>
                      <button title={t("chat.more")} aria-label={t("chat.more")} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setCtxMenu({ m, x: r.right - 212, y: r.bottom + 4 }); }}><MoreHorizontal size={15} /></button>
                    </MessageToolbar>}
                  >
                    {isAgentReplyPreview && !m.content
                      ? <AgentReplyPreviewBody m={m} />
                      : !!m.content && <div className="mbody"><MessageContent content={m.content} mentions={m.mentions || []} channels={messageChannels} nav={navToken} /></div>}
                    {!!m.attachments?.length && <div className={`msg-atts attachment-list${isSingleImageMessage(m.attachments) ? " attachment-list--single-image" : ""}`}>{m.attachments.map((a) => <AttCard key={a.id} a={a} url={attachmentUrl(a.id)} gallery={messageImageGallery} />)}</div>}
                    {(() => {
                      const contexts = messageCanvasContexts(m);
                      if (!contexts.length) return null;
                      const selectionContexts = contexts.filter((ctx) => !ctx.summaryParts?.wholeCanvas && (ctx.selectedIds?.length || ctx.selectedElements?.length || ctx.selectedFrames?.length));
                      const wholeCanvasContexts = contexts.filter((ctx) => ctx.summaryParts?.wholeCanvas || (!ctx.selectedIds?.length && !ctx.selectedElements?.length && !ctx.selectedFrames?.length));
                      return (
                        <>
                          {selectionContexts.length > 0 && (
                            <div className="mt-2 flex snap-x snap-mandatory gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                              {selectionContexts.map((context) => (
                                <CanvasContextChip key={context.snapshotId || `${context.canvasId}-${context.documentRevision}`} compact context={context} />
                              ))}
                            </div>
                          )}
                          {wholeCanvasContexts.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {wholeCanvasContexts.map((context) => (
                                <CanvasChip key={context.snapshotId || `${context.canvasId}-${context.documentRevision}`} canvas={{ canvasId: context.canvasId, canvasTitle: context.canvasTitle }} />
                              ))}
                            </div>
                          )}
                        </>
                      );
                    })()}
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
                  </ChatMessageItem>
                </Fragment>
                );
              })}
            </div>
            {showJump && <button className="jump-bottom" type="button" aria-label={t("chat.backToBottom")} title={t("chat.backToBottom")} onClick={toBottom}><ArrowDown aria-hidden="true" /></button>}
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
              onFollowChange={setThreadFollowed}
              onClose={() => { setThreadWidth(null); closeThread(); }}
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
            onConvertTask={() => { void taskApi.convertMessage(m.id); }}
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
  const { attachmentUrl, me, react, agents, channels, archivedChannels, slug, savedIds, saveMsg, unsaveMsg } = useStore();
  const toast = useToast();
  const taskApi = useTaskApi();
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
    if (type === "task") { try { const task = await taskApi.findTaskByNumber(Number(args[0])); if (task) navigateConversation(`/s/${slug}/channel/${task.channelId}?msg=${task.id}`); } catch { /* */ } }
  };
  const panelModel = useThreadPanelModel(channelId, agents, focusMessageId);
  const { messages: msgs, scrollRef, followPending } = panelModel;
  const threadImageGallery = useMemo(() => buildMessageImageGallery([parent, ...msgs], attachmentUrl), [attachmentUrl, msgs, parent]);
  const [ctxMenu, setCtxMenu] = useState<{ m: Msg; x: number; y: number } | null>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const toggleFollow = () => panelModel.toggleFollow(followed, onFollowChange);
  const copyMarkdown = async (content: string) => {
    const copied = await copyText(content);
    copied ? toast.info(t("clipboard.copied")) : toast.error(t("clipboard.copyFailed"));
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
          ? <span className="msg-av"><Avatar seed={m.senderName} size={36} /></span>
          : ag
          ? <button type="button" className="msg-av clickable" aria-label={t("chat.openAgentCard", { name: m.senderName })} aria-haspopup="dialog" onClick={(event) => onOpenAgentCard(m.senderId!, event.currentTarget)}><Avatar seed={m.senderName} url={senderAvatar(m)} size={36} />{live !== "offline" && <span className={"av-status " + live} />}</button>
          : m.senderId
            ? <button type="button" className="msg-av clickable" aria-label={t("chat.openHumanCard", { name: m.senderName })} aria-haspopup="dialog" onClick={(event) => onOpenHumanCard(m.senderName, senderAvatar(m), event.currentTarget)}><Avatar seed={m.senderName} url={senderAvatar(m)} size={36} /></button>
            : <span className="msg-av"><Avatar seed={m.senderName} url={senderAvatar(m)} size={36} /></span>}
        header={continuation ? null : <MessageHeader
          sender={deletedAgent
            ? <DeletedAgentName displayName={m.senderName} />
            : ag
            ? <AgentMentionName displayName={m.senderName} mentionName={ag.name} disabled={readOnly} onMention={(agentName) => composerRef.current?.mentionAgent(agentName)} />
            : m.senderId
              ? <span className="who">{m.senderName}</span>
              : <span className="who">{m.senderName}</span>}
        />}
        footerTimestamp={fmtMessageTime(m.createdAt)}
        toolbar={<MessageToolbar>
          {m.producedByTurnId ? <TurnDetailsButton turnId={m.producedByTurnId} /> : null}
          {!readOnly ? <ReactionToolbarButton onReact={(emoji) => react(m.id, emoji, false)} /> : null}
          <button title={t("chat.copyMarkdown")} aria-label={t("chat.copyMarkdown")} onClick={() => { void copyMarkdown(m.content); }}><Clipboard size={15} /></button>
          <button title={t("chat.more")} aria-label={t("chat.more")} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setCtxMenu({ m, x: rect.right - 212, y: rect.bottom + 4 }); }}><MoreHorizontal size={15} /></button>
        </MessageToolbar>}
      >
        {isAgentReplyPreview && !m.content
          ? <AgentReplyPreviewBody m={m} />
          : !!m.content && <div className="mbody"><MessageContent content={m.content} mentions={m.mentions || []} channels={[...channels, ...archivedChannels]} nav={navToken} /></div>}
        {!!m.attachments?.length && <div className={`msg-atts attachment-list${isSingleImageMessage(m.attachments) ? " attachment-list--single-image" : ""}`}>{m.attachments.map((a) => <AttCard key={a.id} a={a} url={attachmentUrl(a.id)} gallery={threadImageGallery} />)}</div>}
        {(() => {
          const contexts = messageCanvasContexts(m);
          if (!contexts.length) return null;
          const selectionContexts = contexts.filter((ctx) => !ctx.summaryParts?.wholeCanvas && (ctx.selectedIds?.length || ctx.selectedElements?.length || ctx.selectedFrames?.length));
          const wholeCanvasContexts = contexts.filter((ctx) => ctx.summaryParts?.wholeCanvas || (!ctx.selectedIds?.length && !ctx.selectedElements?.length && !ctx.selectedFrames?.length));
          return (
            <>
              {selectionContexts.length > 0 && (
                <div className="mt-2 flex snap-x snap-mandatory gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {selectionContexts.map((context) => (
                    <CanvasContextChip key={context.snapshotId || `${context.canvasId}-${context.documentRevision}`} compact context={context} />
                  ))}
                </div>
              )}
              {wholeCanvasContexts.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {wholeCanvasContexts.map((context) => (
                    <CanvasChip key={context.snapshotId || `${context.canvasId}-${context.documentRevision}`} canvas={{ canvasId: context.canvasId, canvasTitle: context.canvasTitle }} />
                  ))}
                </div>
              )}
            </>
          );
        })()}
        <Reactions m={m} mine={me?.id ?? ""} readOnly={readOnly} onReact={(emoji, remove) => react(m.id, emoji, remove)} />
      </ChatMessageItem>
    </Fragment>
    );
  };
  return (
    <aside className={`thread-panel${solo ? " thread-panel--solo" : ""}`} style={style}>
      <div className="thread-head">{headerLeading}<span className="grow">{t("chat.thread")}</span>{headerActions}
        {!readOnly ? <button className="tp-link" title={t("chat.markDone")} onClick={() => { void panelModel.markDone(onClose); }}><CheckCircle2 size={14} /></button> : null}
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
        onConvertTask={() => { void taskApi.convertMessage(ctxMenu.m.id); }}
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
