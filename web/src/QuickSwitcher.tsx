import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FolderKanban, Hash, ListTodo, MessageCircle, Search, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar } from "./Avatar.tsx";
import { useStore } from "./store.tsx";
import { workspaceLocationForConversation, workspaceLocationForModule } from "./shell/workspaceRoute.ts";

interface MessageSearchResult {
  id: string;
  channelId: string;
  channelName: string;
  channelType: string;
  parentMessageId?: string | null;
  parentChannelId?: string | null;
  parentChannelName?: string | null;
  senderName: string;
  senderDeleted?: boolean;
  snippet?: string;
  content: string;
}

interface QuickItem {
  key: string;
  section: string;
  label: string;
  detail?: string;
  icon: ReactNode;
  go(): void;
}

interface QuickSection {
  title: string;
  items: QuickItem[];
}

export function QuickSwitcher({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { api, channels, dms, visibleAgents: agents, slug, spaceId, spaces } = useStore();
  const nav = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [messageResults, setMessageResults] = useState<MessageSearchResult[]>([]);
  const [searchingMessages, setSearchingMessages] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchGeneration = useRef(0);
  const normalizedQuery = query.trim().toLowerCase();
  const isHome = spaces.some((space) => space.id === spaceId && space.isHome);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const value = query.trim();
    const generation = ++searchGeneration.current;
    if (!value) {
      setMessageResults([]);
      setSearchingMessages(false);
      return;
    }
    setMessageResults([]);
    setSearchingMessages(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await api("GET", `/api/messages/search?q=${encodeURIComponent(value)}&limit=30`);
        if (searchGeneration.current === generation) setMessageResults(response?.results ?? []);
      } catch {
        if (searchGeneration.current === generation) setMessageResults([]);
      } finally {
        if (searchGeneration.current === generation) setSearchingMessages(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [api, query]);

  const openConversation = (target: string) => nav(workspaceLocationForConversation(target, location.pathname, location.search));
  const openModule = (moduleId: "spaces" | "tasks" | "agents" | "settings", agentId?: string) => nav(workspaceLocationForModule(
    location.pathname,
    location.search,
    { moduleId, ...(agentId ? { agent: agentId } : {}) },
  ));
  const messageTarget = (message: MessageSearchResult) => message.channelType === "thread" && message.parentChannelId && message.parentMessageId
    ? `/s/${slug}/channel/${message.parentChannelId}?thread=${message.parentMessageId}&threadMsg=${message.id}`
    : `/s/${slug}/channel/${message.channelId}?msg=${message.id}`;

  const sections = useMemo<QuickSection[]>(() => {
    const matches = (label: string) => !normalizedQuery || label.toLowerCase().includes(normalizedQuery);
    const channelItems: QuickItem[] = channels.filter((channel) => channel.type !== "dm" && matches(channel.name)).map((channel) => ({
      key: `channel:${channel.id}`,
      section: "channels",
      label: channel.name,
      icon: <Hash size={16} aria-hidden="true" />,
      go: () => openConversation(`/s/${slug}/channel/${channel.id}`),
    }));
    const dmItems: QuickItem[] = dms.filter((dm) => matches(dm.peerDisplayName || dm.peerName || dm.name)).map((dm) => ({
      key: `dm:${dm.id}`,
      section: "dms",
      label: dm.peerDisplayName || dm.peerName || t("qs.unknownAgent"),
      icon: <Avatar seed={dm.peerDisplayName || dm.peerName || dm.name} size={20} />,
      go: () => openConversation(`/s/${slug}/channel/${dm.id}`),
    }));
    const agentItems: QuickItem[] = agents.filter((agent) => matches(agent.displayName || agent.name)).map((agent) => ({
      key: `agent:${agent.id}`,
      section: "agents",
      label: agent.displayName || agent.name,
      detail: `@${agent.name}`,
      icon: <Avatar seed={agent.name} size={20} />,
      go: () => openModule("agents", agent.id),
    }));

    if (!normalizedQuery) {
      const recommended: QuickItem[] = [
        { key: "recommend:tasks", section: "recommended", label: t("qs.openTasks"), icon: <ListTodo size={16} aria-hidden="true" />, go: () => openModule("tasks") },
        ...(isHome ? [{ key: "recommend:spaces", section: "recommended", label: t("qs.openSpaces"), icon: <FolderKanban size={16} aria-hidden="true" />, go: () => openModule("spaces") } as QuickItem] : []),
        { key: "recommend:settings", section: "recommended", label: t("qs.openSettings"), icon: <Settings size={16} aria-hidden="true" />, go: () => openModule("settings") },
      ];
      return [
        { title: t("qs.sectionRecommended"), items: recommended },
        { title: t("qs.sectionChannels"), items: channelItems.slice(0, 8) },
        { title: t("qs.sectionDms"), items: dmItems.slice(0, 8) },
        { title: t("qs.sectionAgents"), items: agentItems.slice(0, 8) },
      ].filter((section) => section.items.length > 0);
    }

    const messageItems = messageResults.map((message): QuickItem => ({
      key: `message:${message.id}`,
      section: message.channelType === "thread" ? "topicMessages" : message.channelType === "dm" ? "dmMessages" : "channelMessages",
      label: message.snippet || message.content,
      detail: `${message.channelType === "thread" ? message.parentChannelName || t("qs.topic") : message.channelName} · ${message.senderName}${message.senderDeleted ? ` (${t("chat.deletedAgent")})` : ""}`,
      icon: message.channelType === "thread"
        ? <MessageCircle size={16} aria-hidden="true" />
        : message.channelType === "dm"
          ? <Search size={16} aria-hidden="true" />
          : <Hash size={16} aria-hidden="true" />,
      go: () => openConversation(messageTarget(message)),
    }));
    const messageSection = (section: QuickItem["section"], title: string): QuickSection => ({ title, items: messageItems.filter((item) => item.section === section) });
    return [
      { title: t("qs.sectionChannels"), items: channelItems },
      { title: t("qs.sectionDms"), items: dmItems },
      { title: t("qs.sectionAgents"), items: agentItems },
      messageSection("channelMessages", t("qs.sectionChannelMessages")),
      messageSection("topicMessages", t("qs.sectionTopicMessages")),
      messageSection("dmMessages", t("qs.sectionDmMessages")),
    ].filter((section) => section.items.length > 0);
  }, [agents, channels, dms, isHome, messageResults, normalizedQuery, t]);

  const items = sections.flatMap((section) => section.items).slice(0, 60);
  const boundedHighlight = Math.min(highlighted, Math.max(0, items.length - 1));
  const pick = (item?: QuickItem) => {
    if (!item) return;
    item.go();
    onClose();
  };
  const move = (delta: number) => {
    if (!items.length) return;
    const next = Math.max(0, Math.min(boundedHighlight + delta, items.length - 1));
    setHighlighted(next);
    listRef.current?.querySelector<HTMLElement>(`[data-quick-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
    else if (event.key === "Enter") { event.preventDefault(); pick(items[boundedHighlight]); }
    else if (event.key === "Escape") { event.preventDefault(); onClose(); }
  };

  let itemIndex = -1;
  return (
    <div className="modal-bg qs-bg" onClick={onClose}>
      <div className="qs" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={t("qs.ariaLabel")}>
        <div className="qs-search">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setHighlighted(0); }}
            onKeyDown={onKeyDown}
            placeholder={t("qs.placeholder")}
            aria-label={t("qs.inputAriaLabel")}
          />
        </div>
        <div className="qs-list" ref={listRef}>
          {sections.map((section) => (
            <section className="qs-section" key={section.title}>
              <div className="qs-section__title">{section.title}</div>
              {section.items.map((item) => {
                itemIndex += 1;
                const index = itemIndex;
                if (index >= 60) return null;
                return (
                  <button
                    key={item.key}
                    type="button"
                    data-quick-index={index}
                    className={`qs-item${index === boundedHighlight ? " on" : ""}`}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => pick(item)}
                  >
                    <span className="qs-item__icon">{item.icon}</span>
                    <span className="qs-label">{item.label}</span>
                    {item.detail ? <span className="qs-detail">{item.detail}</span> : null}
                  </button>
                );
              })}
            </section>
          ))}
          {!sections.length && searchingMessages ? <div className="qs-empty">{t("qs.searching")}</div> : null}
          {!sections.length && !searchingMessages ? <div className="qs-empty">{t("qs.noMatch")}</div> : null}
        </div>
      </div>
    </div>
  );
}
