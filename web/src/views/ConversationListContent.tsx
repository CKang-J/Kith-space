import { useEffect, useState } from "react";
import { Bookmark, Check, Hash, Pin } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { mergeWorkspaceSearch } from "../shell/workspaceRoute.ts";
import { useStore } from "../store.tsx";
import { Avatar, resolveAvatar } from "../Avatar.tsx";
import { useEscClose } from "../ConfirmModal.tsx";
import { useToast } from "../toast.tsx";
import { agentStatusLabel } from "../agentStatus.ts";
import { ArchivedChannelGroup } from "./ArchivedChannelGroup.tsx";

interface ConversationListContentProps {
  channelIdOverride?: string;
  preserveSearch?: string;
  onNavigate?(target: string): void;
}

export function channelCreateErrorMsg(t: (key: string) => string, error?: string): string {
  return error === "channel name exists" ? t("sidebar.createChannelDup") : t("sidebar.createChannelFailed");
}

export function ConversationListContent({
  channelIdOverride,
  preserveSearch = "",
  onNavigate,
}: ConversationListContentProps = {}) {
  const { t } = useTranslation();
  const { api, spaceId, channels, archivedChannels, dms, unread, agents, visibleAgents, slug, savedIds, createChannel, openAgentDM, attachmentUrl } = useStore();
  const toast = useToast();
  const avFor = (url?: string | null) => resolveAvatar(url, attachmentUrl);
  const { channelId: routeChannelId } = useParams();
  const channelId = channelIdOverride ?? routeChannelId;
  const { pathname } = useLocation();
  const nav = useNavigate();
  const navigate = (target: string) => onNavigate ? onNavigate(target) : nav(target);
  const [pinned, setPinned] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [dmPickerOpen, setDmPickerOpen] = useState(false);
  const withPreservedSearch = (target: string) => mergeWorkspaceSearch(target, preserveSearch);
  const onSaved = pathname.endsWith("/saved");

  const pinnedChannels = pinned.map((id) => channels.find((channel) => channel.id === id)).filter(Boolean) as typeof channels;
  const unpinnedChannels = channels.filter((channel) => !pinned.includes(channel.id));

  useEffect(() => {
    if (!spaceId) return;
    api("GET", `/api/spaces/${spaceId}/sidebar-order`)
      .then((payload) => setPinned(payload?.pinnedChannelIds || []))
      .catch(() => {});
  }, [spaceId]);

  const togglePin = async (id: string) => {
    const next = pinned.includes(id) ? pinned.filter((item) => item !== id) : [...pinned, id];
    setPinned(next);
    try {
      await api("PUT", `/api/spaces/${spaceId}/sidebar-order`, { pinnedChannelIds: next });
    } catch {
      // The next sidebar load reconciles with the persisted order.
    }
  };

  const createConversation = async (options: { name: string; description?: string; visibility?: string; agentIds?: string[] }) => {
    const result = await createChannel(options);
    if (result?.id) {
      setCreateOpen(false);
      navigate(withPreservedSearch(`/s/${slug}/channel/${result.id}`));
      return;
    }
    toast.error(channelCreateErrorMsg(t, result?.error));
  };

  const openDirectMessage = async (agentId: string) => {
    const id = await openAgentDM(agentId);
    setDmPickerOpen(false);
    if (id) navigate(withPreservedSearch(`/s/${slug}/channel/${id}`));
  };

  const channelRow = (channel: (typeof channels)[number]) => (
    <div
      key={channel.id}
      className={`item chan-row${channel.id === channelId ? " active" : ""}`}
    >
      <button
        type="button"
        className="conversation-row__target"
        aria-current={channel.id === channelId ? "page" : undefined}
        onClick={() => navigate(withPreservedSearch(`/s/${slug}/channel/${channel.id}`))}
      >
        <span className="conversation-row__avatar conversation-row__avatar--channel">
          <Hash size={16} className="channel-row-icon" aria-hidden="true" />
        </span>
        <span className="grow">{channel.name}</span>
        {!!unread[channel.id] && <span className="badge">{unread[channel.id]}</span>}
      </button>
      <button
        type="button"
        className={`pinbtn${pinned.includes(channel.id) ? " on" : ""}`}
        title={pinned.includes(channel.id) ? t("sidebar.unpinChannel") : t("sidebar.pinChannel")}
        onClick={(event) => {
          event.stopPropagation();
          void togglePin(channel.id);
        }}
      >
        <Pin size={12} />
      </button>
    </div>
  );

  return (
    <>
      <button
        type="button"
        className={`item nav-row conversation-saved-row${onSaved ? " active" : ""}`}
        aria-current={onSaved ? "page" : undefined}
        onClick={() => navigate(withPreservedSearch(`/s/${slug}/saved`))}
      >
        <span className="conversation-row__avatar conversation-row__avatar--saved"><Bookmark size={16} /></span>
        <span className="grow">{t("common.saved")}</span>
        {savedIds.size > 0 && <span className="badge">{savedIds.size}</span>}
      </button>
      <div className="sec">
        {t("common.channels")}
        <button className="addbtn" title={t("sidebar.createChannelTitle")} onClick={() => { setCreateOpen(true); setDmPickerOpen(false); }}>+</button>
      </div>
      {pinnedChannels.map(channelRow)}
      {unpinnedChannels.map(channelRow)}
      <ArchivedChannelGroup
        channels={archivedChannels.filter((channel) => channel.name !== "all")}
        currentChannelId={channelId}
        onSelect={(id) => navigate(withPreservedSearch(`/s/${slug}/channel/${id}`))}
      />
      <div className="sec">
        {t("common.directMessages")}
        <button className="addbtn" title={t("sidebar.newDmTitle")} onClick={() => { setDmPickerOpen((open) => !open); setCreateOpen(false); }}>+</button>
      </div>
      {dmPickerOpen ? (
        <div className="dm-pick">
          {visibleAgents.length ? visibleAgents.map((agent) => (
            <button key={agent.id} className="item" onClick={() => void openDirectMessage(agent.id)}>
              <Avatar seed={agent.name} url={avFor(agent.avatarUrl)} size={28} />
              <span className="grow">{agent.displayName || agent.name}</span>
            </button>
          )) : <div className="empty">{t("sidebar.dmPickEmpty")}</div>}
        </div>
      ) : null}
      {dms.map((conversation) => {
        const agent = agents.find((candidate) => candidate.id === conversation.peerId);
        return (
          <button
            key={conversation.id}
            className={`item agent-list-item${conversation.id === channelId ? " active" : ""}`}
            aria-current={conversation.id === channelId ? "page" : undefined}
            onClick={() => navigate(withPreservedSearch(`/s/${slug}/channel/${conversation.id}`))}
          >
            <Avatar seed={conversation.peerDisplayName || conversation.peerName || conversation.peerId || conversation.id} url={avFor(conversation.peerAvatarUrl)} size={32} />
            <span className="grow">{conversation.peerDisplayName || conversation.peerName || t("sidebar.unknownAgent")}</span>
            {agent ? (
              <span
                className={`dot ${agent.activity || "offline"}`}
                role="img"
                aria-label={t("members.statusLabel", { status: agentStatusLabel(t, agent.activity || "offline") })}
                title={agent.activityDetail || agentStatusLabel(t, agent.activity || "offline")}
              />
            ) : null}
            {!!unread[conversation.id] && <span className="badge">{unread[conversation.id]}</span>}
          </button>
        );
      })}
      {createOpen ? <CreateChannelModal onCreate={createConversation} onClose={() => setCreateOpen(false)} /> : null}
    </>
  );
}

export function CreateChannelModal({ onCreate, onClose, prefill, submitLabel }: { onCreate: (options: { name: string; description?: string; visibility?: string; agentIds?: string[] }) => void; onClose: () => void; prefill?: { name?: string; description?: string; visibility?: string; agentIds?: string[] }; submitLabel?: string }) {
  useEscClose(onClose);
  const { t } = useTranslation();
  const { visibleAgents: agents, attachmentUrl } = useStore();
  const avFor = (url?: string | null) => resolveAvatar(url, attachmentUrl);
  const [name, setName] = useState(prefill?.name ?? "");
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [visibility, setVisibility] = useState(prefill?.visibility ?? "public");
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set(prefill?.agentIds ?? []));
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredAgents = agents.filter((agent) => !normalizedQuery || (agent.displayName || agent.name).toLowerCase().includes(normalizedQuery));
  const toggleAgent = (agentId: string) => {
    const next = new Set(selectedAgents);
    next.has(agentId) ? next.delete(agentId) : next.add(agentId);
    setSelectedAgents(next);
  };
  const submit = () => {
    if (name.trim()) onCreate({ name: name.trim(), description: description.trim(), visibility, agentIds: [...selectedAgents] });
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h3>{t("sidebar.createChannelHeading")}</h3>
        <label>{t("sidebar.fieldName")}</label>
        <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={t("sidebar.namePlaceholder")} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && name.trim()) submit(); }} />
        <label>{t("sidebar.descLabel")}</label>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("sidebar.descPlaceholder")} />
        <label>{t("sidebar.visibilityLabel")}</label>
        <div className="ck"><input type="radio" name="ct" checked={visibility === "public"} onChange={() => setVisibility("public")} /><span>{t("sidebar.visibilityPublic")}</span></div>
        <div className="ck"><input type="radio" name="ct" checked={visibility === "private"} onChange={() => setVisibility("private")} /><span>{t("sidebar.visibilityPrivate")}</span></div>
        <label>{t("sidebar.membersLabel")}{selectedAgents.size ? ` · ${t("sidebar.membersSelected", { count: selectedAgents.size })}` : t("sidebar.membersOptional")}</label>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("sidebar.memberSearchPlaceholder")} />
        <div className="member-pick">
          {filteredAgents.length > 0 && <div className="sec sec-sub">{t("common.agents")}</div>}
          {filteredAgents.map((agent) => (
            <button key={agent.id} className={`item agent-list-item pickable${selectedAgents.has(agent.id) ? " picked" : ""}`} onClick={() => toggleAgent(agent.id)}>
              <Avatar seed={agent.name} url={avFor(agent.avatarUrl)} size={22} />
              <span className="grow">{agent.displayName || agent.name}</span>
              {selectedAgents.has(agent.id) && <Check size={14} className="ck-mark" />}
            </button>
          ))}
          {filteredAgents.length === 0 && <div className="empty">{t("sidebar.noMembers")}</div>}
        </div>
        <div className="acts"><button className="cancel" onClick={onClose}>{t("sidebar.cancelBtn")}</button><button className="ok" onClick={submit}>{submitLabel ?? t("sidebar.createBtn")}</button></div>
      </div>
    </div>
  );
}
