import { useEffect, useState } from "react";
import { Bell, MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { fmtDateTime } from "../../format.ts";
import { useStore } from "../../store.tsx";
import { sortConversationTopics } from "./conversationAggregateData.ts";
import type { ThreadSummary } from "./types.ts";

interface ConversationTopicsProps {
  conversationId: string;
  onOpenTopic(parentMessageId: string): void;
}

interface TopicLoadState {
  conversationId: string;
  status: "loading" | "ready" | "error";
  topics: ThreadSummary[];
}

export function ConversationTopics({ conversationId, onOpenTopic }: ConversationTopicsProps) {
  const { t } = useTranslation();
  const { api, onEvent } = useStore();
  const [loadState, setLoadState] = useState<TopicLoadState>({ conversationId, status: "loading", topics: [] });
  const [retryVersion, setRetryVersion] = useState(0);
  const load = loadState.conversationId === conversationId
    ? loadState
    : { conversationId, status: "loading" as const, topics: [] };

  useEffect(() => {
    let active = true;
    let requestVersion = 0;
    const loadTopics = async (showLoading: boolean) => {
      const version = ++requestVersion;
      if (showLoading) setLoadState({ conversationId, status: "loading", topics: [] });
      try {
        const response = await api("GET", `/api/channels/${encodeURIComponent(conversationId)}/thread-summaries`);
        if (!active || version !== requestVersion) return;
        if (!Array.isArray(response?.threads)) throw new Error(response?.error || "Invalid topic response");
        setLoadState({ conversationId, status: "ready", topics: sortConversationTopics(response.threads as ThreadSummary[]) });
      } catch {
        if (active && version === requestVersion) setLoadState((current) => ({
          conversationId,
          status: showLoading ? "error" : current.status,
          topics: current.conversationId === conversationId ? current.topics : [],
        }));
      }
    };

    void loadTopics(true);
    const unsubscribe = onEvent((event) => {
      if (event.type !== "thread:updated") return;
      if (typeof event.parentChannelId === "string" && event.parentChannelId !== conversationId) return;
      void loadTopics(false);
    });
    return () => {
      active = false;
      unsubscribe();
    };
    // Store callbacks are recreated with provider renders; conversationId is the data scope and onEvent supplies live refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, retryVersion]);

  return (
    <section className="conversation-topics" aria-label={t("conversationAggregate.topics.title")}>
      <div className="conversation-aggregate__scroll">
        {load.status === "loading" ? <div className="conversation-aggregate__status">{t("conversationAggregate.loading")}</div> : null}
        {load.status === "error" ? (
          <div className="conversation-aggregate__status">
            <p>{t("conversationAggregate.topics.loadFailed")}</p>
            <button type="button" onClick={() => setRetryVersion((version) => version + 1)}>{t("conversationAggregate.retry")}</button>
          </div>
        ) : null}
        {load.status === "ready" && load.topics.length === 0 ? (
          <div className="conversation-aggregate__status">{t("conversationAggregate.topics.empty")}</div>
        ) : null}
        {load.status === "ready" && load.topics.length > 0 ? (
          <div className="conversation-topics__list">
            {load.topics.map((topic) => {
              const activityAt = topic.lastReplyAt || topic.createdAt;
              return (
                <button
                  key={topic.threadChannelId}
                  type="button"
                  className="conversation-topic"
                  aria-label={t("conversationAggregate.topics.open", { author: topic.parentSender.name })}
                  onClick={() => onOpenTopic(topic.parentMessageId)}
                >
                  <span className="conversation-topic__head">
                    <strong>{topic.parentSender.name}</strong>
                    <span>{fmtDateTime(activityAt)}</span>
                  </span>
                  <span className="conversation-topic__summary">{topic.parentMessageText || t("conversationAggregate.topics.noContent")}</span>
                  <span className="conversation-topic__meta">
                    <span><MessageCircle size={13} aria-hidden="true" />{t("conversationAggregate.topics.replies", { count: topic.replyCount })}</span>
                    {topic.unreadCount > 0 ? <span className="conversation-topic__unread">{t("conversationAggregate.topics.unread", { count: topic.unreadCount })}</span> : null}
                    {topic.followed ? <span title={t("conversationAggregate.topics.followed")} aria-label={t("conversationAggregate.topics.followed")}><Bell size={13} aria-hidden="true" /></span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
