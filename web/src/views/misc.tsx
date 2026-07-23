import { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Star, Bookmark, Lock, MessageCircle } from "lucide-react";
import { useStore } from "../store.tsx";
import { fmtDateTime } from "../format";
import { ChatSidebar } from "./ChatSidebar.tsx";
import { IconInbox } from "../icons.tsx";
import { TaskBoard } from "../TaskBoard.tsx";
import { PaneEmpty } from "../PaneEmpty.tsx";
import { useTranslation } from "react-i18next";
import { getDesktopBridge, resolveSettingsSection } from "../desktopBridge.ts";
import { DesktopSettings } from "./DesktopSettings.tsx";
import { workspaceLocationForConversation, workspaceLocationForModule } from "../shell/workspaceRoute.ts";
import { AdvisorProviderSettings } from "./advisor-provider/AdvisorProviderSettings.tsx";

interface TasksProps {
  channelIdOverride?: string | null;
}
export function Tasks({ channelIdOverride }: TasksProps = {}) {
  const { channels } = useStore();
  const nav = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const scope = channelIdOverride || "space";
  const cur = scope === "space" ? null : channels.find((c) => c.id === scope);
  const openScope = (taskScope: string) => nav(workspaceLocationForModule(
    location.pathname,
    location.search,
    { moduleId: "tasks", taskScope },
  ));

  return (
    <>
      <aside className="sidebar">
        <div className="sb-scroll">
        <div className="sb-title">{t("nav.tasks")}</div>
        <div className="sec">{t("misc.tasksScope")}</div>
        <button className={"item" + (scope === "space" ? " active" : "")} onClick={() => openScope("space")}><Star size={14} /><span className="grow">{t("misc.tasksAll")}</span></button>
        <div className="sec">{t("common.channels")}</div>
        {channels.filter((c) => c.type !== "dm").map((c) => <button key={c.id} className={"item" + (c.id === scope ? " active" : "")} onClick={() => openScope(c.id)}># {c.name}</button>)}
        </div>
      </aside>
      <main className="content-col">
        <div className="head"><h1>{t("nav.tasks")}</h1><small>{scope === "space" ? t("misc.tasksAllCross") : cur ? "# " + cur.name : ""}</small></div>
        <TaskBoard channelId={scope === "space" ? null : scope} />
      </main>
    </>
  );
}
// Unified inbox (GET /api/channels/inbox): aggregates recent activity across channels/DMs/threads, including unread counts and mentions.
interface InboxItem {
  kind: string; channelId: string; channelName: string; channelType: string;
  parentMessageId?: string | null; parentChannelId?: string | null; parentChannelName?: string | null; // thread entry: navigate to parent channel and open thread panel
  lastMessageId: string; firstUnreadMessageId: string | null;
  lastMessageAt: string; lastMessagePreview: string;
  lastMessageSenderType: string; lastMessageSenderId: string | null; lastMessageSenderName: string;
  unreadCount: number; hasMention: boolean;
}
// One @-mention of me, message-grained (GET /api/mentions): read & unread alike, deep-links to that message.
interface MentionItem {
  messageId: string; channelId: string; channelName: string; channelType: string;
  parentMessageId?: string | null; parentChannelId?: string | null; parentChannelName?: string | null; // thread mention → open the parent thread panel
  senderType: string; senderId: string | null; senderName: string;
  preview: string; createdAt: string; seq: number; read: boolean;
}
// INBOX_FILTERS labels are i18n keys; call t(label) at render time
const INBOX_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "misc.inboxFilterAll" },
  { key: "unread", label: "misc.inboxFilterUnread" },
  { key: "mentions", label: "misc.inboxFilterMentions" },
];
// Channel type glyph: private and thread channels use SVG icons; public channels and DMs use text glyphs.
function KindGlyph({ type }: { type: string }) {
  if (type === "private") return <Lock size={13} />;
  if (type === "thread") return <MessageCircle size={13} />;
  return <>{type === "dm" ? "@" : "#"}</>;
}

export function Inbox({ embedded = false, onNavigate }: { embedded?: boolean; onNavigate?: () => void }) {
  const { api, slug, markRead, onEvent } = useStore();
  const nav = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const [filter, setFilter] = useState("all");
  const [items, setItems] = useState<InboxItem[]>([]);
  const [mentions, setMentions] = useState<MentionItem[]>([]);
  const [mentionsHasMore, setMentionsHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const filterRef = useRef("all");
  const MENTIONS_PAGE = 50;
  const openConversation = (target: string) => nav(workspaceLocationForConversation(
    target,
    location.pathname,
    location.search,
  ));

  const load = (f: string, silent = false) => {
    if (!silent) setLoading(true);
    // Mentions is a message-grained activity stream (every @ of me, read or not — GET /api/mentions), paginated
    // with a Load-more button; all/unread stay channel-aggregated via the inbox endpoint. A realtime reload
    // resets to the first page (newest @s are at the top).
    const req = f === "mentions"
      ? api("GET", `/api/mentions?limit=${MENTIONS_PAGE}`).then((r) => { setMentions(r?.items || []); setMentionsHasMore(!!r?.hasMore); }).catch(() => { setMentions([]); setMentionsHasMore(false); })
      : api("GET", `/api/channels/inbox?filter=${f}&limit=50`).then((r) => setItems(r?.items || [])).catch(() => setItems([]));
    req.finally(() => setLoading(false));
  };
  // Append the next page of mentions (offset = how many we already hold).
  const loadMoreMentions = () => api("GET", `/api/mentions?limit=${MENTIONS_PAGE}&offset=${mentions.length}`)
    .then((r) => { setMentions((prev) => [...prev, ...(r?.items || [])]); setMentionsHasMore(!!r?.hasMore); }).catch(() => {});
  useEffect(() => { filterRef.current = filter; load(filter); /* eslint-disable-next-line */ }, [filter]);

  // Real-time: on incoming message/message:updated socket events, debounce a silent re-fetch of the current filter to stay fresh without manual refresh.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = onEvent((e) => {
      if (e.type !== "message" && e.type !== "message:updated") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => load(filterRef.current, true), 400);
    });
    return () => { if (timer) clearTimeout(timer); off(); };
    /* eslint-disable-next-line */
  }, []);

  const open = (it: InboxItem) => {
    if (it.unreadCount > 0) markRead(it.channelId);
    onNavigate?.();
    // Thread entry → navigate to parent channel and open the thread panel; non-thread unread → jump to first unread message; otherwise navigate to channel
    if (it.kind === "thread" && it.parentChannelId && it.parentMessageId) openConversation(`/s/${slug}/channel/${it.parentChannelId}?thread=${it.parentMessageId}`);
    else if (it.firstUnreadMessageId) openConversation(`/s/${slug}/channel/${it.channelId}?msg=${it.firstUnreadMessageId}`);
    else openConversation(`/s/${slug}/channel/${it.channelId}`);
  };
  // Jump straight to the @-mention: highlight that message via ?msg=; a thread mention opens the parent thread panel.
  const openMention = (m: MentionItem) => {
    onNavigate?.();
    if (m.channelType === "thread" && m.parentChannelId && m.parentMessageId) openConversation(`/s/${slug}/channel/${m.parentChannelId}?thread=${m.parentMessageId}`);
    else openConversation(`/s/${slug}/channel/${m.channelId}?msg=${m.messageId}`);
  };

  const curFilter = INBOX_FILTERS.find((f) => f.key === filter);
  const curFilterLabel = curFilter ? t(curFilter.label) : filter;
  const isMentions = filter === "mentions";
  const listCount = isMentions ? mentions.length : items.length;
  const isEmpty = isMentions ? !mentions.length : !items.length;

  return (
    <>
      {!embedded && <aside className="sidebar">
        <div className="sb-scroll">
        <div className="sb-title">{t("misc.inboxTitle")}</div>
        <div className="sec">{t("misc.inboxFilter")}</div>
        {INBOX_FILTERS.map((f) => (
          <button key={f.key} className={"item" + (filter === f.key ? " active" : "")} onClick={() => setFilter(f.key)}>
            <span className="grow">{t(f.label)}</span>
          </button>
        ))}
        </div>
      </aside>}
      <main className={`content-col${embedded ? " inbox-embedded" : ""}`}>
        {!embedded && <div className="head"><h1>{t("misc.inboxTitle")}</h1><small>{loading ? t("misc.inboxLoading") : t("misc.inboxSummary", { count: listCount, filter: curFilterLabel })}</small></div>}
        <div className="inbox-list">
          {!loading && isEmpty && (
            <PaneEmpty icon={<IconInbox size={30} />} title={filter === "all" ? t("misc.inboxEmptyAll") : t("misc.inboxEmptyFilter", { filter: curFilterLabel })} />
          )}
          {!isMentions && items.map((it) => (
            <button key={it.channelId} className={"inbox-row" + (it.unreadCount > 0 ? " unread" : "")} onClick={() => open(it)}>
              <span className={"ib-glyph k-" + it.kind}><KindGlyph type={it.channelType} /></span>
              <span className="ib-main">
                <span className="ib-top">
                  <span className="ib-name">{it.channelName}</span>
                  {it.hasMention && <span className="ib-mention" title={t("misc.inboxMentionTitle")}>@</span>}
                  <span className="ib-time">{fmtDateTime(it.lastMessageAt)}</span>
                </span>
                <span className="ib-preview"><b>{it.lastMessageSenderName}</b>: {it.lastMessagePreview}</span>
              </span>
              {it.unreadCount > 0 && <span className="ib-badge">{it.unreadCount}</span>}
            </button>
          ))}
          {isMentions && mentions.map((m) => (
            <button key={m.messageId} className={"inbox-row" + (m.read ? "" : " unread")} onClick={() => openMention(m)}>
              <span className={"ib-glyph k-" + (m.channelType === "dm" ? "dm" : m.channelType === "thread" ? "thread" : "channel")}><KindGlyph type={m.channelType} /></span>
              <span className="ib-main">
                <span className="ib-top">
                  <span className="ib-name">{m.channelName}</span>
                  {!m.read && <span className="ib-mention" title={t("misc.inboxMentionTitle")}>@</span>}
                  <span className="ib-time">{fmtDateTime(m.createdAt)}</span>
                </span>
                <span className="ib-preview"><b>{m.senderName}</b>: {m.preview}</span>
              </span>
            </button>
          ))}
          {isMentions && mentionsHasMore && !loading && <button className="loadmore" onClick={loadMoreMentions}>{t("misc.loadMore")}</button>}
        </div>
      </main>
    </>
  );
}

const escHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
const hilite = (s: string, q: string) => { const e = escHtml(s); if (!q) return e; const re = new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig"); return e.replace(re, "<mark>$1</mark>"); };

export function Search() {
  const { api, slug } = useStore();
  const nav = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searched, setSearched] = useState(false);
  useEffect(() => {
    const v = q.trim();
    if (!v) { setResults([]); setSearched(false); return; }
    const h = setTimeout(async () => { const d = await api("GET", `/api/messages/search?q=${encodeURIComponent(v)}`); setResults(d?.results || []); setSearched(true); }, 300);
    return () => clearTimeout(h);
  }, [q]);
  return (
    <>
      <aside className="sidebar"><div className="sb-scroll"><div className="sb-title">{t("nav.search")}</div><div className="empty">{t("misc.searchSidebarHint")}</div></div></aside>
      <main className="content-col">
        <div className="head"><h1>{t("nav.search")}</h1><small>{searched ? t("misc.searchResults", { count: results.length }) : ""}</small></div>
        <div className="scroll">
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder={t("misc.searchPlaceholder")} style={{ width: "100%", fontSize: 16, padding: "11px 16px", border: "1px solid var(--hair-strong)", borderRadius: 8, marginBottom: 16, outline: "none" }} />
          {searched && results.length === 0 && <div className="empty">{t("misc.searchNoResults", { q })}</div>}
          {results.map((r) => (
            <div className="card" key={r.id} style={{ cursor: "pointer" }} onClick={() => nav(workspaceLocationForConversation(
              `/s/${slug}/channel/${r.channelId}?msg=${r.id}`,
              location.pathname,
              location.search,
            ))}>
              <div className="kv"><b># {r.channelName}</b> · {r.senderName} · {fmtDateTime(r.createdAt)}</div>
              <div className="mbody" dangerouslySetInnerHTML={{ __html: hilite(r.snippet || r.content, q) }} />
            </div>
          ))}
        </div>
      </main>
    </>
  );
}

// Settings sub-pages. Desktop administration exists only inside the Electron preload boundary.
// SETTINGS labels are i18n keys; call t(label) at render time
const SETTINGS: [string, string][] = [
  ["human", "misc.settingsNavHuman"],
  ["space", "misc.settingsNavSpace"],
  ["advisor", "misc.settingsNavAdvisor"],
];
export function Settings({ sectionOverride }: { sectionOverride?: string } = {}) {
  const section = sectionOverride;
  const { spaceId, api } = useStore();
  const nav = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const desktopBridge = getDesktopBridge();
  const requestedSection = section || "human";
  const cur = resolveSettingsSection(section, desktopBridge !== null);
  const settingsEntries: [string, string][] = desktopBridge
    ? [...SETTINGS, ["desktop", "misc.settingsNavDesktop"]]
    : SETTINGS;
  const curLabel = t(settingsEntries.find((s) => s[0] === cur)?.[1] || cur);
  useEffect(() => {
    if (requestedSection === cur) return;
    nav(workspaceLocationForModule(
      location.pathname,
      location.search,
      { moduleId: "settings", settings: cur },
    ), { replace: true });
  }, [cur, location.pathname, location.search, nav, requestedSection]);
  return (
    <>
      <aside className="sidebar">
        <div className="sb-scroll">
        <div className="sb-title">{t("nav.settings")}</div>
        <div className="settings-nav">{settingsEntries.map(([k, labelKey]) => <button key={k} className={"item" + (cur === k ? " active" : "")} onClick={() => nav(workspaceLocationForModule(location.pathname, location.search, { moduleId: "settings", settings: k }))}>{t(labelKey)}</button>)}</div>
        </div>
      </aside>
      <main className="content-col">
        <div className="head"><h1>{t("misc.settingsTitle", { section: curLabel })}</h1></div>
        <div className="scroll">
          {cur === "human"
            ? <HumanSettings api={api} />
            : cur === "space"
              ? <SpaceSettings api={api} spaceId={spaceId} />
              : cur === "advisor"
                ? <AdvisorProviderSettings api={api} />
              : cur === "desktop" && desktopBridge
                ? <DesktopSettings bridge={desktopBridge} />
                : <div className="empty">{t("misc.settingsWip", { section: cur })}</div>}
        </div>
      </main>
    </>
  );
}
function HumanSettings({ api }: { api: any }) {
  const { clearBrowserAccess } = useStore();
  const { t, i18n } = useTranslation();
  const desktopAvailable = getDesktopBridge() !== null;
  const setLang = (l: string) => { i18n.changeLanguage(l); localStorage.setItem("kith-space.lang", l); };
  const [u, setU] = useState<any>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { (async () => setU(await api("GET", "/api/human/profile")))(); }, []);
  if (!u) return <div className="empty">{t("misc.humanLoading")}</div>;
  const save = async () => { await api("PATCH", "/api/human/profile", { name: u.name, email: u.email || null, description: u.description }); setSaved(true); setTimeout(() => setSaved(false), 1500); };
  return (
    <div className="setform">
      <label>{t("misc.humanDisplayName")}</label><input value={u.name || ""} onChange={(e) => setU({ ...u, name: e.target.value })} />
      <label>{t("misc.humanDescription")}</label>
      <textarea value={u.description || ""} maxLength={3000} onChange={(e) => setU({ ...u, description: e.target.value })} placeholder={t("misc.humanDescriptionPlaceholder")} />
      <div className="ta-count">{(u.description || "").length}/3000</div>
      <label>{t("misc.humanEmail")}</label><input value={u.email || ""} onChange={(e) => setU({ ...u, email: e.target.value })} />
      <div className="setrow"><button className="ok" onClick={save}>{t("misc.humanSave")}</button>{saved && <span className="saved">{t("misc.humanSaved")}</span>}</div>
      <div className="lang-row">
        <div><div className="browser-session-title">{t("settings.language")}</div><div className="browser-session-desc">{t("settings.languageDesc")}</div></div>
        <div className="seg-pill" role="group" aria-label={t("settings.language")}>
          <button className={"seg-opt" + (i18n.language.startsWith("en") ? " on" : "")} onClick={() => setLang("en")}>{t("settings.langEnglish")}</button>
          <button className={"seg-opt" + (i18n.language.startsWith("zh") ? " on" : "")} onClick={() => setLang("zh")}>{t("settings.langChinese")}</button>
        </div>
      </div>
      {!desktopAvailable ? <div className="browser-session-row">
        <div><div className="browser-session-title">{t("misc.browserAuthorizationTitle")}</div><div className="browser-session-desc">{t("misc.browserAuthorizationDesc")}</div></div>
        <button className="browser-session-btn" onClick={clearBrowserAccess}>{t("misc.browserAuthorizationBtn")}</button>
      </div> : null}
    </div>
  );
}
function SpaceSettings({ api, spaceId }: { api: any; spaceId: string }) {
  const { spaceAvatar, uploadSpaceAvatar } = useStore();
  const { t } = useTranslation();
  const [s, setS] = useState<any>(null);
  const [saved, setSaved] = useState(false);
  const [avErr, setAvErr] = useState("");
  const [avBusy, setAvBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { (async () => setS(await api("GET", "/api/spaces/" + spaceId)))(); }, [spaceId]);
  if (!s) return <div className="empty">{t("misc.spaceLoading")}</div>;
  const save = async () => { await api("PATCH", "/api/spaces/" + spaceId, { name: s.name, slug: s.slug }); setSaved(true); setTimeout(() => setSaved(false), 1500); };
  const onPick = async (e: any) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; setAvErr(""); setAvBusy(true); try { await uploadSpaceAvatar(f); } catch (err: any) { setAvErr(String(err?.message || err)); } finally { setAvBusy(false); } };
  return (
    <div className="setform">
      <label>{t("misc.spaceAvatarLabel")}</label>
      <div className="avatar-edit">
        {spaceAvatar ? <img className="avatar-edit-img" src={spaceAvatar} alt="" /> : <div className="avatar-edit-ph">{(s.name || "?")[0].toUpperCase()}</div>}
        <button className="ghost" disabled={avBusy} onClick={() => fileRef.current?.click()}>{avBusy ? t("misc.spaceAvatarUploading") : spaceAvatar ? t("misc.spaceAvatarChange") : t("misc.spaceAvatarUpload")}</button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPick} />
      </div>
      {avErr && <div className="form-err">{avErr}</div>}
      <label>{t("misc.spaceNameLabel")}</label><input value={s.name || ""} onChange={(e) => setS({ ...s, name: e.target.value })} />
      <label>{t("misc.spaceSlugLabel")}</label><input value={s.slug || ""} onChange={(e) => setS({ ...s, slug: e.target.value })} />
      <div className="setrow"><button className="ok" onClick={save}>{t("misc.spaceSave")}</button>{saved && <span className="saved">{t("misc.spaceSaved")}</span>}</div>
    </div>
  );
}
// Saved messages view (/s/:slug/saved): bookmark list with source channel/thread, sender, relative time, content, and unsave action; clicking a card navigates to the message.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const relTime = (iso?: string, tFn?: (k: string, opts?: any) => string) => {
  try {
    const d = Date.now() - new Date(iso!).getTime();
    const m = Math.floor(d / 60000);
    if (!tFn) return "";
    if (m < 1) return tFn("misc.relTimeJustNow");
    if (m < 60) return tFn("misc.relTimeMinutes", { count: m });
    const h = Math.floor(m / 60);
    if (h < 24) return tFn("misc.relTimeHours", { count: h });
    return tFn("misc.relTimeDays", { count: Math.floor(h / 24) });
  } catch { return ""; }
};
export function Saved({ embedded = false }: { embedded?: boolean } = {}) {
  const { slug, listSaved, unsaveMsg } = useStore();
  const nav = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const PAGE = 20;
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  // Paginate by DB-row offset, NOT items.length: listSaved now filters out saved rows whose channel the
  // caller can't currently read (IDOR-B5 read-time gate), so the visible count is ≤ the rows the server
  // consumed. Deriving the next offset from items.length would re-request overlapping windows (duplicate
  // bookmarks) or, when a whole window is filtered out, repeat the same offset forever (stuck "load more").
  const [nextOffset, setNextOffset] = useState(0);
  const load = (off = 0) => listSaved(PAGE, off).then((r) => {
    setItems((prev) => (off ? [...prev, ...r.saved] : r.saved));
    setHasMore(r.hasMore);
    setNextOffset(off + PAGE);
  }).finally(() => setLoading(false));
  useEffect(() => { load(0); /* eslint-disable-next-line */ }, []);
  const open = (it: any) => nav(workspaceLocationForConversation(
    `/s/${slug}/channel/${it.channelId}?msg=${it.messageId}`,
    location.pathname,
    location.search,
  ));
  const unsave = (e: React.MouseEvent, it: any) => { e.stopPropagation(); unsaveMsg(it.messageId); setItems((p) => p.filter((x) => x.messageId !== it.messageId)); setNextOffset((n) => Math.max(0, n - 1)); };
  const source = (it: any) => it.channelType === "thread"
    ? <><MessageCircle size={12} /> {t("misc.savedThread")}{it.parentChannelType === "dm" ? "@" : "#"}{it.parentChannelName ?? "?"}</>
    : it.channelType === "private"
    ? <><Lock size={12} /> {it.channelName ?? "?"}</>
    : <>{it.channelType === "dm" ? "@" : "#"} {it.channelName ?? "?"}</>;
  return (
    <>
      {!embedded && <ChatSidebar />}
      <main className="content-col">
        <div className="head"><h1>{t("common.saved")}</h1><small>{loading ? t("misc.savedLoading") : t("misc.savedCount", { count: items.length })}</small></div>
        <div className="inbox-list">
          {!loading && !items.length && <PaneEmpty icon={<Bookmark size={28} />} title={t("misc.savedEmpty")} />}
          {items.map((it) => (
            <button key={it.messageId} className="inbox-row" onClick={() => open(it)}>
              <span className="ib-main">
                <span className="ib-top">
                  <span className="ib-name">{source(it)}</span>
                  <span className="ib-time">{relTime(it.createdAt, t)}</span>
                </span>
                <span className="ib-preview"><b>{it.senderName ?? (it.senderType === "agent" ? "agent" : "human")}</b>: {it.content}</span>
              </span>
              <span className="ib-save on" title={t("misc.savedUnsave")} onClick={(e) => unsave(e, it)}><Bookmark size={15} fill="currentColor" /></span>
            </button>
          ))}
          {hasMore && !loading && <button className="loadmore" onClick={() => load(nextOffset)}>{t("misc.savedLoadMore")}</button>}
        </div>
      </main>
    </>
  );
}
