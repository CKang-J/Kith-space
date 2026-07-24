import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import {
  SlidingTabs,
  slidingTabId,
  slidingTabPanelId,
  type SlidingTabOption,
} from "../../components/SlidingTabs.tsx";
import { ConversationFiles } from "./ConversationFiles.tsx";
import { ConversationTopics } from "./ConversationTopics.tsx";
import type { ConversationAggregateTab } from "./types.ts";
import "./conversationAggregate.css";

export interface ConversationAggregatePanelProps {
  conversationId: string;
  trace: ReactNode;
  settings?: ReactNode;
  settingsOpen?: boolean;
  onClose(): void;
  onOpenTopic(parentMessageId: string): void;
  onJumpToMessage(messageId: string): void;
}

export function ConversationAggregatePanel({
  conversationId,
  trace,
  settings,
  settingsOpen = false,
  onClose,
  onOpenTopic,
  onJumpToMessage,
}: ConversationAggregatePanelProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ConversationAggregateTab>("trace");
  const tabsId = `conversation-aggregate-tabs-${useId().replace(/:/g, "")}`;
  const tabs: readonly SlidingTabOption<ConversationAggregateTab>[] = [
    { value: "trace", label: t("conversationAggregate.tabs.trace") },
    { value: "topics", label: t("conversationAggregate.tabs.topics") },
    { value: "files", label: t("conversationAggregate.tabs.files") },
  ];

  return (
    <section className="conversation-aggregate" aria-label={t("conversationAggregate.title")}>
      <div className="conversation-aggregate__content" hidden={settingsOpen}>
        <div className="conversation-aggregate__topbar">
          <h2>{t("conversationAggregate.title")}</h2>
          <button
            type="button"
            className="conversation-aggregate__close"
            title={t("conversationAggregate.close")}
            aria-label={t("conversationAggregate.close")}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <header className="conversation-aggregate__header">
          <SlidingTabs<ConversationAggregateTab>
            id={tabsId}
            className="conversation-aggregate__tabs"
            value={activeTab}
            options={tabs}
            onChange={(tab) => setActiveTab(tab)}
            ariaLabel={t("conversationAggregate.tabs.label")}
          />
        </header>
        {tabs.map((tab) => {
          const selected = tab.value === activeTab;
          return (
            <div
              key={tab.value}
              id={slidingTabPanelId(tabsId, tab.value)}
              className="conversation-aggregate__panel"
              role="tabpanel"
              aria-labelledby={slidingTabId(tabsId, tab.value)}
              hidden={!selected}
            >
              {tab.value === "trace" ? trace : null}
              {tab.value === "topics" ? (
                <ConversationTopics key={conversationId} conversationId={conversationId} onOpenTopic={onOpenTopic} />
              ) : null}
              {tab.value === "files" ? (
                <ConversationFiles key={conversationId} conversationId={conversationId} onJumpToMessage={onJumpToMessage} />
              ) : null}
            </div>
          );
        })}
      </div>
      {settingsOpen ? <div className="conversation-aggregate__settings">{settings}</div> : null}
    </section>
  );
}
