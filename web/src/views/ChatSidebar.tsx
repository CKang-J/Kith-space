import { useState, useEffect } from "react";
import { Pin, Bookmark, Check, Eye } from "lucide-react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { mergeWorkspaceSearch } from "../shell/workspaceRoute.ts";
import { useStore } from "../store.tsx";
import { Avatar, resolveAvatar } from "../Avatar.tsx";
import { useEscClose } from "../ConfirmModal.tsx";
import { LiveAgentBar } from "./LiveAgentBar.tsx";
import { useToast } from "../toast.tsx";

// Maps the create-channel API's `error` string (e.g. 409 "channel name exists") to a localized toast message.
// Shared by ChatSidebar's own create-channel button and Chat.tsx's action-card create-channel flow.
export function channelCreateErrorMsg(t: (key: string) => string, error?: string): string {
  return error === "channel name exists" ? t("sidebar.createChannelDup") : t("sidebar.createChannelFailed");
}

// Shared chat sidebar (Saved/Channels/DMs share the same sidebar; persists unchanged when switching between the channel view and the Saved view).
// Both the Chat view and the Saved view (misc.tsx) render this component so the channel list stays visible when navigating to Saved.
export function ChatSidebar({ channelIdOverride, preserveSearch = "" }: { channelIdOverride?: string; preserveSearch?: string } = {}) {
  const { t } = useTranslation();
  const { api, spaceId, channels, dms, unread, agents, visibleAgents, slug, savedIds, createChannel, openAgentDM, attachmentUrl } = useStore();
  const toast = useToast();
  const avFor = (u?: string | null) => resolveAvatar(u, attachmentUrl);
  const { channelId: routeChannelId } = useParams();
  const channelId = channelIdOverride ?? routeChannelId;
  const { pathname } = useLocation();
  const nav = useNavigate();
  const [pinned, setPinned] = useState<string[]>([]);
  const [mkChan, setMkChan] = useState(false);
  const [dmPick, setDmPick] = useState(false);
  const withPreservedSearch = (target: string) => mergeWorkspaceSearch(target, preserveSearch);
  const onSaved = pathname.endsWith("/saved");
  const onShowcase = pathname.endsWith("/showcase");

  const regularChannels = channels.filter((channel) => channel.type !== "showcase");
  const pinnedChans = pinned.map((id) => regularChannels.find((channel) => channel.id === id)).filter(Boolean) as typeof regularChannels;
  const unpinnedChannels = regularChannels.filter((channel) => !pinned.includes(channel.id));
  const togglePin = async (id: string) => {
    const next = pinned.includes(id) ? pinned.filter((x) => x !== id) : [...pinned, id];
    setPinned(next);
    try { await api("PUT", `/api/spaces/${spaceId}/sidebar-order`, { pinnedChannelIds: next }); } catch { /* rollback deferred to next load */ }
  };
  useEffect(() => { if (!spaceId) return; api("GET", `/api/spaces/${spaceId}/sidebar-order`).then((p) => setPinned(p?.pinnedChannelIds || [])).catch(() => {}); }, [spaceId]);
  const doCreate = async (opts: { name: string; description?: string; visibility?: string; agentIds?: string[] }) => {
    const r = await createChannel(opts);
    if (r?.id) { setMkChan(false); nav(withPreservedSearch(`/s/${slug}/channel/${r.id}`)); }
    else toast.error(channelCreateErrorMsg(t, r?.error)); // keep the modal open so the user can fix the name and retry
  };
  const doDM = async (agentId: string) => { const id = await openAgentDM(agentId); setDmPick(false); if (id) nav(withPreservedSearch(`/s/${slug}/channel/${id}`)); };

  const chanRow = (c: any) => (
    <div key={c.id} className={"item chan-row" + (c.id === channelId ? " active" : "")} onClick={() => nav(withPreservedSearch(`/s/${slug}/channel/${c.id}`))}>
      <span className="grow"># {c.name}</span>
      <button className={"pinbtn" + (pinned.includes(c.id) ? " on" : "")} title={pinned.includes(c.id) ? t("sidebar.unpinChannel") : t("sidebar.pinChannel")} onClick={(e) => { e.stopPropagation(); togglePin(c.id); }}><Pin size={12} /></button>
      {!!unread[c.id] && <span className="badge">{unread[c.id]}</span>}
    </div>
  );

  return (
    <aside className="sidebar">
      <div className="sb-scroll">
      <div className="sb-title">{t("nav.channel")}</div>
      <div className={"item nav-row" + (onSaved ? " active" : "")} onClick={() => nav(withPreservedSearch(`/s/${slug}/saved`))}>
        <span className="grow"><Bookmark size={14} style={{ verticalAlign: "-2px" }} /> {t("common.saved")}</span>
        {savedIds.size > 0 && <span className="badge">{savedIds.size}</span>}
      </div>
      {/* Showcase pinned to the very top: a static, read-only demo page (no DB channel, no API) — browsed a few
          times, then ignored. Kept above Channels/DMs by product call so the two high-traffic sections stay
          adjacent and uninterrupted. */}
      <div className="sec sec-sub">{t("sidebar.showcaseSection")}</div>
      <div className={"item" + (onShowcase ? " active" : "")} style={{ cursor: "pointer" }} onClick={() => nav(withPreservedSearch(`/s/${slug}/showcase`))}>
        <Eye size={13} style={{ flexShrink: 0, opacity: 0.7 }} /><span className="grow">{t("sidebar.showcaseItem")}</span>
      </div>
      {pinnedChans.length > 0 && <><div className="sec">{t("sidebar.pinnedSection")}</div>{pinnedChans.map(chanRow)}</>}
      <div className="sec">{t("common.channels")} <button className="addbtn" title={t("sidebar.createChannelTitle")} onClick={() => { setMkChan(true); setDmPick(false); }}>+</button></div>
      {unpinnedChannels.map(chanRow)}
      <div className="sec">{t("common.directMessages")} <button className="addbtn" title={t("sidebar.newDmTitle")} onClick={() => { setDmPick((v) => !v); setMkChan(false); }}>+</button></div>
      {dmPick && <div className="dm-pick">{visibleAgents.length ? visibleAgents.map((a) => <button key={a.id} className="item" onClick={() => doDM(a.id)}><Avatar seed={a.name} url={avFor(a.avatarUrl)} size={20} /><span className="grow">{a.displayName || a.name}</span></button>) : <div className="empty">{t("sidebar.dmPickEmpty")}</div>}</div>}
      {dms.map((c) => {
        const a = agents.find((agent) => agent.id === c.peerId);
        return (
        <button key={c.id} className={"item" + (c.id === channelId ? " active" : "")} onClick={() => nav(withPreservedSearch(`/s/${slug}/channel/${c.id}`))}>
          <Avatar seed={c.peerDisplayName || c.peerName || c.peerId || c.id} url={avFor(c.peerAvatarUrl)} size={20} /><span className="grow">{c.peerDisplayName || c.peerName || t("sidebar.unknownAgent")}</span>
          {a && <span className={"dot " + (a.activity || "offline")} role="img" aria-label={t("members.statusLabel", { status: a.activity || "offline" })} title={a.activityDetail || a.activity || "offline"} />}
          {!!unread[c.id] && <span className="badge">{unread[c.id]}</span>}
        </button>
        );
      })}
      {mkChan && <CreateChannelModal onCreate={doCreate} onClose={() => setMkChan(false)} />}
      </div>
      <LiveAgentBar />
    </aside>
  );
}

// Full create-channel form: name + description + visibility + initial agent membership.
export function CreateChannelModal({ onCreate, onClose, prefill, submitLabel }: { onCreate: (opts: { name: string; description?: string; visibility?: string; agentIds?: string[] }) => void; onClose: () => void; prefill?: { name?: string; description?: string; visibility?: string; agentIds?: string[] }; submitLabel?: string }) {
  useEscClose(onClose);
  const { t } = useTranslation();
  const { visibleAgents: agents, attachmentUrl } = useStore(); // visibleAgents: showcase demo props are not offered as channel members
  const avFor = (u?: string | null) => resolveAvatar(u, attachmentUrl);
  const [name, setName] = useState(prefill?.name ?? "");
  const [desc, setDesc] = useState(prefill?.description ?? "");
  const [visibility, setVisibility] = useState(prefill?.visibility ?? "public");
  const [pickAgents, setPickAgents] = useState<Set<string>>(new Set(prefill?.agentIds ?? []));
  const [mq, setMq] = useState("");
  const toggle = (set: Set<string>, id: string, upd: (s: Set<string>) => void) => { const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); upd(n); };
  const ql = mq.trim().toLowerCase();
  const fAgents = agents.filter((a) => !ql || (a.displayName || a.name).toLowerCase().includes(ql));
  const submit = () => { if (name.trim()) onCreate({ name: name.trim(), description: desc.trim(), visibility, agentIds: [...pickAgents] }); };
  const total = pickAgents.size;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t("sidebar.createChannelHeading")}</h3>
        <label>{t("sidebar.fieldName")}</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("sidebar.namePlaceholder")} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && name.trim()) submit(); }} />
        <label>{t("sidebar.descLabel")}</label><textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t("sidebar.descPlaceholder")} />
        <label>{t("sidebar.visibilityLabel")}</label>
        <div className="ck"><input type="radio" name="ct" checked={visibility === "public"} onChange={() => setVisibility("public")} /><span>{t("sidebar.visibilityPublic")}</span></div>
        <div className="ck"><input type="radio" name="ct" checked={visibility === "private"} onChange={() => setVisibility("private")} /><span>{t("sidebar.visibilityPrivate")}</span></div>
        <label>{t("sidebar.membersLabel")}{total ? ` · ${t("sidebar.membersSelected", { count: total })}` : t("sidebar.membersOptional")}</label>
        <input value={mq} onChange={(e) => setMq(e.target.value)} placeholder={t("sidebar.memberSearchPlaceholder")} />
        <div className="member-pick">
          {fAgents.length > 0 && <div className="sec sec-sub">{t("common.agents")}</div>}
          {fAgents.map((a) => (
            <button key={a.id} className={"item pickable" + (pickAgents.has(a.id) ? " picked" : "")} onClick={() => toggle(pickAgents, a.id, setPickAgents)}>
              <Avatar seed={a.name} url={avFor(a.avatarUrl)} size={22} /><span className="grow">{a.displayName || a.name}</span>{pickAgents.has(a.id) && <Check size={14} className="ck-mark" />}
            </button>
          ))}
          {fAgents.length === 0 && <div className="empty">{t("sidebar.noMembers")}</div>}
        </div>
        <div className="acts"><button className="cancel" onClick={onClose}>{t("sidebar.cancelBtn")}</button><button className="ok" onClick={submit}>{submitLabel ?? t("sidebar.createBtn")}</button></div>
      </div>
    </div>
  );
}
