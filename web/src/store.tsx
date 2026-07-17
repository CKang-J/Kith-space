// Global state + API + socket.io event bus (React Context). Chat messages and traces are consumed by views via onEvent.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { loadBrowserSession, revokeBrowserSession } from "./browserAuth.ts";
import {
  appendConversationBoundary,
  appendConversationTrajectory,
  type TrajectoryBuckets,
} from "./trajBuffer.ts";
import { messageUnreadDelta, threadUnreadDelta } from "./threadUnread";
import { initialAuthState, type AuthState } from "./routing.ts";
import { initialReadySpace } from "./spaces/spaceAvailability.ts";
import { applySpaceScopeHeaders, spaceScopeHeaders } from "./spaceScope.ts";

export interface Channel { id: string; name: string; description?: string; type: string; lastMessageAt?: string; archivedAt?: string | null }
export interface Dm { id: string; name: string; type: string; description?: string; lastMessageAt?: string; peerId?: string | null; peerName?: string | null; peerDisplayName?: string | null; peerType?: string | null; peerAvatarUrl?: string | null }
export interface Agent { id: string; name: string; displayName: string; description?: string; status: string; activity?: string; activityDetail?: string; model?: string; runtime: string; avatarUrl?: string | null; creatorType?: string; defaultResponseMode?: "active" | "mention_only" | "silent" }
export type SpaceRootStatus = "ready" | "missing" | "error";
export interface SpaceInfo { id: string; name: string; slug: string; rootPath?: string; status: SpaceRootStatus; rootError?: string | null; code?: string; avatarUrl?: string | null; isHome: boolean; lastOpenedAt?: string }
export interface SpaceMutationResult { space?: SpaceInfo; error?: string; code?: string }
export interface Me { id: string; name: string; email?: string | null; description?: string | null }
export interface Att { id: string; filename: string; mimeType?: string; sizeBytes?: number }
export interface Reaction { emoji: string; count: number; reactorIds: string[]; reactorNames: string[] }
export interface ActionMeta { kind: string; state: "prepared" | "executed"; action: { type: string; name: string; description?: string | null; visibility?: string; initialAgents?: string[] }; executedByUserName?: string | null; result?: { kind: string; id: string; name: string } | null }
export interface Msg { id: string; seq: number; channelId: string; senderType: string; senderId?: string | null; senderName: string; senderDeleted?: boolean; content: string; messageType?: string; actionMetadata?: ActionMeta | null; createdAt?: string; taskStatus?: string | null; taskNumber?: number | null; taskAssigneeType?: string | null; taskAssigneeId?: string | null; mentions?: { type?: string; id?: string; name: string }[]; attachments?: Att[]; reactions?: Reaction[] }
type Ev = { type: string; [k: string]: any };

interface Store {
  ready: boolean; authState: "loading" | "authed" | "anon"; spaceId: string; slug: string; me: Me | null; spaceAvatar: string | null;
  spaces: SpaceInfo[];
  uploadSpaceAvatar: (file: File) => Promise<void>;
  uploadAgentAvatar: (agentId: string, file: File) => Promise<string>;
  createSpace: (input: { name?: string; rootPath?: string }) => Promise<SpaceMutationResult>;
  relocateSpace: (spaceId: string, rootPath: string) => Promise<SpaceMutationResult>;
  renameSpace: (spaceId: string, name: string) => Promise<SpaceMutationResult>;
  removeSpace: (spaceId: string) => Promise<{ ok: boolean; error?: string }>;
  refreshSpaces: () => Promise<SpaceInfo[]>;
  switchSpace: (slug: string) => void;                           // client-side Space switch: re-point the active Space, reset per-Space state, reconnect the socket (no full-page reload)
  clearBrowserAccess: () => Promise<void>;
  channels: Channel[]; archivedChannels: Channel[]; dms: Dm[]; unread: Record<string, number>;
  agents: Agent[];        // all persisted agent identities, including system-owned records needed for attribution
  visibleAgents: Agent[]; // interactive agents available to rosters, pickers, and @mention reachability
  trajByConversation: TrajectoryBuckets;                          // per-base-conversation live trace buffers; each bucket is independently bounded
  api: (m: string, p: string, b?: unknown) => Promise<any>;
  reload: () => Promise<void>;
  onEvent: (cb: (e: Ev) => void) => () => void;
  subscribeChannel: (id: string) => void;                         // join the channel/thread's realtime room while it is being viewed (idempotent; re-emitted on reconnect)
  createChannel: (opts: { name: string; description?: string; visibility?: string; agentIds?: string[] }) => Promise<{ id?: string; error?: string } | null>;
  markActionExecuted: (messageId: string, result?: { kind: string; id: string; name: string }) => Promise<void>; // mark action card as executed after submission
  createTasks: (channelId: string, titles: string[]) => Promise<any[]>;
  openAgentDM: (agentId: string) => Promise<string | null>;
  markRead: (id: string) => void;
  uploadFiles: (channelId: string, files: FileList | File[]) => Promise<any[]>;
  uploadOne: (channelId: string, file: File, onProgress?: (pct: number) => void) => Promise<any>;
  attachmentUrl: (id: string) => string;
  react: (messageId: string, emoji: string, remove?: boolean) => Promise<void>;
  openThread: (parentChannelId: string, parentMessageId: string) => Promise<string | null>;
  openAgentPanel: (agentId: string) => void;                      // request the agent profile panel (Activity tab) to open in the chat right column; consumed once by the Chat view
  agentPanelReq: string | null;                                   // pending open-agent-panel request (agent id); null when none
  clearAgentPanelReq: () => void;                                 // clear the pending request after the Chat view has consumed it
  savedIds: Set<string>;                                          // saved message ids known in this session (bookmark state + Saved count source)
  saveMsg: (messageId: string) => Promise<void>;
  unsaveMsg: (messageId: string) => Promise<void>;
  listSaved: (limit?: number, offset?: number) => Promise<{ saved: any[]; hasMore: boolean }>;
}
const Ctx = createContext<Store>(null as any);
export const useStore = () => useContext(Ctx);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  // HttpOnly Cookies cannot be inspected synchronously. The route guards wait in "loading"
  // until the browser-session bootstrap resolves to either protected UI or the Access Token gate.
  const [authState, setAuthState] = useState<AuthState>(initialAuthState);
  const [spaceId, setSpaceId] = useState("");
  const [slug, setSlug] = useState("kith-space");
  const [spaces, setSpaces] = useState<SpaceInfo[]>([]);             // all local Spaces (used by Space switcher)
  const [spaceAvatar, setSpaceAvatar] = useState<string | null>(null); // Space avatar URL; Cookie auth is supplied by the browser
  const [me, setMe] = useState<Me | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [archivedChannels, setArchivedChannels] = useState<Channel[]>([]);
  const [dms, setDms] = useState<Dm[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [agents, setAgents] = useState<Agent[]>([]);
  const [trajByConversation, setTrajByConversation] = useState<TrajectoryBuckets>({});
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [agentPanelReq, setAgentPanelReq] = useState<string | null>(null); // cross-component signal: LiveAgentBar (sidebar) → Chat view opens the agent profile panel
  const [activeSpaceId, setActiveSpaceId] = useState(""); // id of the Space to activate; changing it drives the activation effect (initial pick + every client-side switch)
  const csrfRef = useRef("");
  const spaceIdRef = useRef("");
  const spacesRef = useRef<SpaceInfo[]>([]); // mirror of `spaces` for lookups in effects/handlers without taking a render dependency on it
  const meIdRef = useRef<string | undefined>(undefined); // current user id; read by socket handlers (own-message unread suppression) and stable across workspace switches
  const sockRef = useRef<Socket | null>(null); // active socket connection; emits join:channel when joining/creating a channel mid-session for room isolation
  const subscribedRef = useRef<Set<string>>(new Set()); // channels/threads explicitly subscribed by the active view; re-emitted on every (re)connect so a reconnect re-joins them
  const listeners = useRef(new Set<(e: Ev) => void>());

  const api = async (method: string, path: string, body?: unknown) => {
    // Views can mount while a Space is activating. Wait for its scope before sending the request.
    for (let i = 0; i < 60 && !spaceIdRef.current; i++) await new Promise((r) => setTimeout(r, 30));
    const r = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: spaceScopeHeaders(spaceIdRef.current, { method, csrfToken: csrfRef.current, json: true }),
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.json();
  };
  const reload = async () => {
    // Pin the target Space at entry. A client-side Space switch re-points spaceIdRef mid-flight; `fresh()` then
    // turns false, so this (now-stale) reload's results are dropped instead of landing mixed with the new
    // Space's data — guards rapid A→B→C switches (the sequential awaits below each read the shared spaceIdRef).
    const reloadSpaceId = spaceIdRef.current;
    const fresh = () => spaceIdRef.current === reloadSpaceId;
    const [ch, archived] = await Promise.all([
      api("GET", "/api/channels"),
      api("GET", "/api/channels?archived=only"),
    ]);
    if (fresh()) { setChannels(ch); setArchivedChannels(archived); }
    try { const dm = await api("GET", "/api/channels/dm"); if (fresh()) setDms(dm); } catch { if (fresh()) setDms([]); }
    try { const un = (await api("GET", "/api/channels/unread")) || {}; if (fresh()) setUnread(un); } catch { if (fresh()) setUnread({}); }
    const ag = await api("GET", "/api/agents"); if (fresh()) setAgents(ag);
  };
  const onEvent = (cb: (e: Ev) => void) => { listeners.current.add(cb); return () => { listeners.current.delete(cb); }; };
  // View-driven realtime subscription: opening a channel/thread joins its transport room so message:new arrives live, regardless
  // of whether it was created or first opened after connect. This is socket state, not Human channel membership. Idempotent.
  const subscribeChannel = (id: string) => { if (!id) return; subscribedRef.current.add(id); sockRef.current?.emit("join:channel", id); };

  // Returns the raw response (incl. `error` on failure, e.g. 409 "channel name exists") instead of collapsing
  // it to null — callers need `error` to surface a toast instead of silently closing the create-channel modal.
  const createChannel = async (opts: { name: string; description?: string; visibility?: string; agentIds?: string[] }) => { const r = await api("POST", "/api/channels", { name: opts.name, description: opts.description, visibility: opts.visibility, agentIds: opts.agentIds ?? [] }); if (r?.id) { await reload(); sockRef.current?.emit("join:channel", r.id); } return r; };
  const toSpaceInfo = (raw: any): SpaceInfo => ({
    id: String(raw.id), name: String(raw.name), slug: String(raw.slug),
    rootPath: typeof raw.rootPath === "string" ? raw.rootPath : undefined,
    status: raw.status === "missing" || raw.status === "error" ? raw.status : "ready",
    rootError: typeof raw.rootError === "string" ? raw.rootError : null,
    code: typeof raw.code === "string" ? raw.code : undefined,
    avatarUrl: typeof raw.avatarUrl === "string" ? raw.avatarUrl : null,
    isHome: raw.isHome === true,
    lastOpenedAt: typeof raw.lastOpenedAt === "string" ? raw.lastOpenedAt : undefined,
  });
  const rememberSpace = (raw: any): SpaceInfo => {
    const info = toSpaceInfo(raw);
    const next = [info, ...spacesRef.current.filter((s) => s.id !== info.id)];
    spacesRef.current = next; setSpaces(next);
    return info;
  };
  const refreshSpaces = async (): Promise<SpaceInfo[]> => {
    const response = await fetch("/api/spaces", { credentials: "same-origin" });
    if (!response.ok) throw new Error(`Space list failed (${response.status})`);
    const data = await response.json().catch(() => []);
    const next = Array.isArray(data) ? data.map(toSpaceInfo) : [];
    spacesRef.current = next;
    setSpaces(next);
    return next;
  };
  const mutateSpaceDirectory = async (method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown) => {
    if (!csrfRef.current) throw new Error("Missing browser session CSRF token");
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-kith-csrf": csrfRef.current },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return response.json().catch(() => ({}));
  };
  // Create in the default container when rootPath is omitted; an explicit rootPath attaches an existing host folder.
  const createSpace = async (input: { name?: string; rootPath?: string }): Promise<SpaceMutationResult> => {
    const r = await mutateSpaceDirectory("POST", "/api/spaces", input);
    if (!r?.id) return { error: r?.error || "Space creation failed", code: r?.code };
    return { space: rememberSpace(r) };
  };
  const relocateSpace = async (targetSpaceId: string, rootPath: string): Promise<SpaceMutationResult> => {
    const r = await mutateSpaceDirectory("POST", `/api/spaces/${targetSpaceId}/relocate`, { rootPath });
    if (!r?.id) return { error: r?.error || "Space relocation failed", code: r?.code };
    return { space: rememberSpace(r) };
  };
  const renameSpace = async (targetSpaceId: string, name: string): Promise<SpaceMutationResult> => {
    const r = await mutateSpaceDirectory("PATCH", `/api/spaces/${targetSpaceId}`, { name });
    if (!r?.id) return { error: r?.error || "Space rename failed", code: r?.code };
    return { space: rememberSpace(r) };
  };
  const removeSpace = async (targetSpaceId: string): Promise<{ ok: boolean; error?: string }> => {
    const r = await mutateSpaceDirectory("DELETE", `/api/spaces/${targetSpaceId}`);
    if (!r?.ok) return { ok: false, error: r?.error || "Space removal failed" };
    const next = spacesRef.current.filter((space) => space.id !== targetSpaceId);
    spacesRef.current = next;
    setSpaces(next);
    return { ok: true };
  };
  const markSpaceOpened = async (targetSpaceId: string) => {
    const opened = await mutateSpaceDirectory("POST", `/api/spaces/${targetSpaceId}/open`, {});
    if (opened?.id) rememberSpace(opened);
  };
  // Client-side Space switch: re-point the active Space by slug. The activation effect (keyed on activeSpaceId) resets
  // per-Space state and reconnects the socket. No-op if the target is unknown or already active.
  const switchSpace = (targetSlug: string) => { const cur = spacesRef.current.find((s) => s.slug === targetSlug && s.status === "ready"); if (cur && cur.id !== spaceIdRef.current) setActiveSpaceId(cur.id); };
  const clearBrowserAccess = async () => {
    await revokeBrowserSession(csrfRef.current);
    csrfRef.current = "";
    window.location.assign("/");
  };
  const markActionExecuted = async (messageId: string, result?: { kind: string; id: string; name: string }) => { await api("POST", `/api/actions/${messageId}/mark-executed`, { result: result ?? null }); };
  const createTasks = async (channelId: string, titles: string[]) => { const r = await api("POST", `/api/tasks/channel/${channelId}`, { tasks: titles.map((title) => ({ title })) }); return r?.tasks || []; };
  const openAgentDM = async (agentId: string) => { const r = await api("POST", "/api/channels/dm", { agentId }); if (r?.id) { await reload(); sockRef.current?.emit("join:channel", r.id); } return r?.id ?? null; };
  // A channel's badge = its own-timeline unread + its followed threads' unread. Reading a container (channel OR
  // thread) clears only that container's portion; the server returns the affected sidebar channel's authoritative
  // remaining (a thread read rolls onto its parent). We set the badge to that exact value instead of blind-zeroing
  // it — blind-zeroing hid still-unopened thread replies, which then "resurrected" on the next unread refetch.
  const markRead = (id: string) => {
    api("POST", `/api/channels/${id}/read`, {}).then((r) => {
      const key = r?.channelId; if (!key) return;
      setUnread((u) => { const n = { ...u }; if (Number(r.unread) > 0) n[key] = Number(r.unread); else delete n[key]; return n; });
    }).catch(() => {});
  };
  const uploadFiles = async (channelId: string, files: FileList | File[]) => {
    const fd = new FormData(); fd.append("channelId", channelId);
    for (const f of Array.from(files)) fd.append("files", f);
    const r = await fetch("/api/attachments/upload", {
      method: "POST",
      credentials: "same-origin",
      headers: spaceScopeHeaders(spaceIdRef.current, { method: "POST", csrfToken: csrfRef.current }),
      body: fd,
    });
    return (await r.json())?.attachments || [];
  };
  // Single-file upload with progress tracking (XHR; fetch does not expose upload progress). Returns one attachment.
  const uploadOne = (channelId: string, file: File, onProgress?: (pct: number) => void) => new Promise<any>((resolve, reject) => {
    const fd = new FormData(); fd.append("channelId", channelId); fd.append("files", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/attachments/upload");
    xhr.withCredentials = true;
    applySpaceScopeHeaders(xhr, spaceIdRef.current, { method: "POST", csrfToken: csrfRef.current });
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) { try { resolve(JSON.parse(xhr.responseText)?.attachments?.[0]); } catch { reject(new Error("parse")); } } else reject(new Error("status " + xhr.status)); };
    xhr.onerror = () => reject(new Error("network"));
    xhr.send(fd);
  });
  const attachmentUrl = (id: string) => `/api/attachments/${id}`;
  const uploadSpaceAvatar = async (file: File) => { // The single Human uploads the Space avatar, then refreshes the sidebar tile.
    const fd = new FormData(); fd.append("files", file);
    const r = await fetch(`/api/spaces/${spaceIdRef.current}/avatar`, {
      method: "POST",
      credentials: "same-origin",
      headers: spaceScopeHeaders(spaceIdRef.current, { method: "POST", csrfToken: csrfRef.current }),
      body: fd,
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "upload failed");
    const { avatarUrl } = await r.json();
    setSpaceAvatar(avatarUrl || null);
  };
  const uploadAgentAvatar = async (agentId: string, file: File): Promise<string> => {
    const fd = new FormData(); fd.append("files", file);
    const r = await fetch(`/api/agents/${agentId}/avatar`, {
      method: "POST",
      credentials: "same-origin",
      headers: spaceScopeHeaders(spaceIdRef.current, { method: "POST", csrfToken: csrfRef.current }),
      body: fd,
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "upload failed");
    const { avatarUrl } = await r.json();
    return avatarUrl;
  };
  const react = async (messageId: string, emoji: string, remove = false) => { await api(remove ? "DELETE" : "POST", `/api/messages/${messageId}/reactions`, { emoji }); };
  const openThread = async (parentChannelId: string, parentMessageId: string) => { const r = await api("POST", `/api/channels/${parentChannelId}/threads`, { parentMessageId }); return r?.threadChannelId ?? null; };
  const openAgentPanel = (agentId: string) => setAgentPanelReq(agentId); // LiveAgentBar → Chat: open the agent profile panel (Activity tab); Chat consumes & clears
  const clearAgentPanelReq = () => setAgentPanelReq(null);
  // Saved messages: private bookmarks, optimistically update savedIds.
  const saveMsg = async (messageId: string) => { setSavedIds((s) => new Set(s).add(messageId)); await api("POST", "/api/channels/saved", { messageId }); };
  const unsaveMsg = async (messageId: string) => { setSavedIds((s) => { const n = new Set(s); n.delete(messageId); return n; }); await api("DELETE", `/api/channels/saved/${messageId}`); };
  const listSaved = async (limit = 20, offset = 0) => { const r = await api("GET", `/api/channels/saved?limit=${limit}&offset=${offset}`); return { saved: r?.saved ?? [], hasMore: !!r?.hasMore }; };

  // ── Browser-session bootstrap (runs once): ask the server to authenticate its HttpOnly Cookie,
  //    load the local Space list, and then activate the Space named by the URL (or the first Space).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await loadBrowserSession();
        if (cancelled) return;
        if (!session) { setAuthState("anon"); setReady(true); return; }

        csrfRef.current = session.csrfToken;
        meIdRef.current = session.user.id;
        setMe(session.user);
        setAuthState("authed");

        const spaceList = await refreshSpaces();
        if (cancelled) return;
        const urlSlug = location.pathname.match(/\/s\/([^/]+)/)?.[1];
        const cur = initialReadySpace(spaceList, urlSlug);
        if (!cur) { setReady(true); return; }
        setActiveSpaceId(cur.id);
      } catch {
        if (cancelled) return;
        csrfRef.current = "";
        setMe(null);
        setAuthState("anon");
        setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Space activation (runs on the initial pick + every client-side switch): load the active Space's data and
  //    open a socket scoped to it. Resets all per-Space state first so nothing leaks across a switch, and flips
  //    `ready` false→true so the route guard shows the workspace skeleton during the gap (no blank screen, no reload).
  useEffect(() => {
    if (!activeSpaceId) return; // nothing to activate yet (pre-auth / anon / no-Space)
    const cur = spacesRef.current.find((s) => s.id === activeSpaceId);
    if (!cur) return; // unknown id (should not happen: spacesRef is always seeded before setActiveSpaceId)
    let sock: Socket | null = null;
    // StrictMode / switch guard: socket is built asynchronously; if this effect is cleaned up (unmount or a newer
    // switch) before the socket connects, the flag ensures the late connection is closed immediately.
    let cancelled = false;
    const dispatch = (d: Ev) => listeners.current.forEach((cb) => cb(d));
    // Unread badge correction: optimistic ++ gives instant feedback; after each incoming message a debounced
    // re-fetch of /channels/unread overwrites store.unread with the DB truth, fixing badge drift caused by
    // cross-view messages or reconnect catch-up double-counting.
    let unreadTimer: ReturnType<typeof setTimeout> | null = null;
    const syncUnread = () => { if (unreadTimer) clearTimeout(unreadTimer); unreadTimer = setTimeout(async () => { try { setUnread((await api("GET", "/api/channels/unread")) || {}); } catch { /* keep stale value on error */ } }, 400); };
    const myId = meIdRef.current;
    // Point at the active workspace + clear the previous one's state so a switch starts from a clean slate; the
    // ready=false → workspace skeleton shows while it reloads.
    setReady(false);
    spaceIdRef.current = cur.id; setSpaceId(cur.id); setSlug(cur.slug || "kith-space");
    setSpaceAvatar(cur.avatarUrl || null);
    setChannels([]); setArchivedChannels([]); setDms([]); setUnread({}); setAgents([]); setTrajByConversation({}); setSavedIds(new Set()); setAgentPanelReq(null);
    subscribedRef.current = new Set(); // the previous workspace's view-subscriptions don't carry over
    sockRef.current = null; // the previous socket is closed by this effect's cleanup; drop the stale ref until the new one connects
    let lastSeq = 0;
    (async () => {
      await reload();
      if (cancelled) return;
      // Pre-load saved message id set (small enough for a single full fetch; drives bookmark state + Saved count).
      try { const sv = await api("GET", "/api/channels/saved?limit=100"); setSavedIds(new Set((sv?.saved ?? []).map((s: any) => s.messageId))); } catch { /* */ }
      // Track highest seq so reconnect can fetch only missed messages incrementally.
      try { const s = await api("GET", "/api/messages/sync?since=0"); lastSeq = s?.maxSeq ?? 0; } catch { /* */ }
      if (cancelled) return;
      setReady(true);
      void markSpaceOpened(cur.id).catch(() => { /* opening remains usable even if recency metadata fails */ });
      // The HttpOnly session Cookie rides the same-origin handshake; auth carries only Space scope.
      sock = io("/", { auth: { spaceId: spaceIdRef.current }, transports: ["websocket"], withCredentials: true });
      if (cancelled) { sock.close(); sock = null; return; } // late connect after unmount/switch → close immediately
      sockRef.current = sock; // exposed so channel creation and agent DMs can subscribe their realtime rooms
      let firstConnect = true;
      sock.on("connect", async () => {
        for (const id of subscribedRef.current) sock!.emit("join:channel", id); // re-join view-subscribed rooms after reconnect
        if (firstConnect) { firstConnect = false; return; } // first connect is covered by the initial reload()
        // Reconnect: fetch only messages missed during disconnect (incremental, not full reload).
        try {
          const r = await api("GET", `/api/messages/sync?since=${lastSeq}`);
          for (const msg of (r?.messages || [])) {
            if (msg.senderId !== myId && msg.channelId) setUnread((u) => ({ ...u, [msg.channelId]: (u[msg.channelId] || 0) + 1 }));
            dispatch({ type: "message", channelId: msg.channelId, message: msg });
          }
          syncUnread(); // correct badge after catch-up (prevent double-count inflation)
          if (r?.maxSeq) lastSeq = Math.max(lastSeq, r.maxSeq);
        } catch { /* */ }
      });
      sock.on("message:new", (msg: any) => {
        if (msg?.seq) lastSeq = Math.max(lastSeq, msg.seq);
        if (msg?.channelId) {
          // Own messages don't increment unread; thread-channel messages are aggregated by thread:updated onto their parent channel.
          const delta = messageUnreadDelta(msg.senderId, myId, msg.channelType);
          if (delta > 0) { setUnread((u) => ({ ...u, [msg.channelId]: (u[msg.channelId] || 0) + delta })); syncUnread(); } // optimistic ++ for instant feedback; debounced re-fetch corrects stale counts
          setChannels((cs) => cs.map((c) => (c.id === msg.channelId ? { ...c, lastMessageAt: msg.createdAt } : c)));
          setDms((ds) => ds.map((d) => (d.id === msg.channelId ? { ...d, lastMessageAt: msg.createdAt } : d)));
        }
        dispatch({ type: "message", channelId: msg.channelId, message: msg }); // normalize to internal event bus shape; views stay unchanged
      });
      sock.on("agent:activity", (p: any) => {
        if (p?.entries) {
          dispatch({ type: "trajectory", agentId: p.agentId, name: p.name, entries: p.entries, scope: p.scope, channelId: p.channelId, conversationId: p.conversationId, streamId: p.streamId });
          if (p.scope === "scoped" && typeof p.conversationId === "string" && p.conversationId) {
            setTrajByConversation((prev) => appendConversationTrajectory(
              prev,
              p.conversationId,
              (p.entries as any[]).map((x) => ({
                agentId: p.agentId,
                name: p.name,
                streamId: p.streamId,
                tool: !!x.toolName,
                text: x.text || (x.toolName ? `${x.toolName}${x.toolInput ? " — " + x.toolInput : ""}` : "") || x.detail || "",
              })),
            ));
          }
        }
        else {
          setAgents((as) => as.map((a) => (a.id === p.agentId ? { ...a, status: p.status ?? a.status, activity: p.activity ?? a.activity, activityDetail: p.detail ?? a.activityDetail } : a))); // real-time status dot + activity text used by header and sidebar
          // A terminal activity closes only the matching scoped turn. Unscoped/ambiguous status
          // updates still feed the Agent activity page but never create a conversation marker.
          if (p.scope === "scoped" && typeof p.conversationId === "string" && p.conversationId
            && p.activity && p.activity !== "working" && p.activity !== "thinking") {
            setTrajByConversation((prev) => appendConversationBoundary(prev, p.conversationId, {
              agentId: p.agentId,
              name: p.name,
              streamId: p.streamId,
            }));
          }
          dispatch({ type: "agent", id: p.agentId, name: p.name, activity: p.activity, status: p.status, detail: p.detail, scope: p.scope, channelId: p.channelId, conversationId: p.conversationId, streamId: p.streamId });
        }
      });
      sock.on("agent:reply", (p: any) => dispatch({ type: "agent:reply", ...p }));
      sock.on("agent:response-mode-updated", (p: any) => dispatch({ ...p, type: "agent:response-mode-updated" }));
      sock.on("agent:created", () => reload());
      sock.on("agent:deleted", (p: any) => { reload(); dispatch({ type: "agent:deleted", id: p?.id }); });
      // Real-time: new DM / agent membership change → reload lists + subscribe to the affected transport room.
      // The server validates Space access for the Human; this socket event does not create domain membership.
      sock.on("dm:new", (p: any) => { reload(); if (p?.channelId) sockRef.current?.emit("join:channel", p.channelId); });
      sock.on("channel:members-updated", (p: any) => { reload(); if (p?.channelId) sockRef.current?.emit("join:channel", p.channelId); });
      // Archive/restore/delete moves a channel between the two lists. Re-fetch both from the
      // authoritative lifecycle queries instead of trying to infer the move from event payloads.
      sock.on("channel:updated", () => { void reload(); });
      sock.on("channel:deleted", () => { void reload(); });
      sock.on("task:created", (p: any) => (p.tasks || []).forEach((t: any) => dispatch({ type: "task", op: "created", task: t }))); // payload={channelId,tasks:[]}
      sock.on("task:updated", (p: any) => dispatch({ type: "task", op: "updated", task: p.task }));                                  // payload={channelId,task}
      sock.on("task:deleted", (p: any) => dispatch({ type: "task", op: "deleted", taskId: p.taskId, channelId: p.channelId }));      // payload={channelId,taskId}
      sock.on("message:updated", (m: any) => dispatch({ type: "message:updated", message: m }));
      sock.on("thread:updated", (p: any) => {
        const delta = threadUnreadDelta(1, p?.senderId, myId);
        if (p?.parentChannelId && delta > 0) { setUnread((u) => ({ ...u, [p.parentChannelId]: (u[p.parentChannelId] || 0) + delta })); syncUnread(); }
        dispatch({ type: "thread:updated", ...p });
      });
    })();
    return () => { cancelled = true; sock?.close(); sockRef.current = null; if (unreadTimer) clearTimeout(unreadTimer); };
  }, [activeSpaceId]);

  // System-owned identities remain available for historical attribution but are never interactive members.
  const visibleAgents = agents.filter((a) => a.creatorType !== "system");
  return <Ctx.Provider value={{ ready, authState, spaceId, slug, me, spaceAvatar, spaces, createSpace, relocateSpace, renameSpace, removeSpace, refreshSpaces, switchSpace, clearBrowserAccess, uploadSpaceAvatar, uploadAgentAvatar, channels, archivedChannels, dms, unread, agents, visibleAgents, trajByConversation, api, reload, onEvent, subscribeChannel, createChannel, markActionExecuted, createTasks, openAgentDM, markRead, uploadFiles, uploadOne, attachmentUrl, react, openThread, openAgentPanel, agentPanelReq, clearAgentPanelReq, savedIds, saveMsg, unsaveMsg, listSaved }}>{children}</Ctx.Provider>;
}

