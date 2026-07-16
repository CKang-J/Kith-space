import { Hash, MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar } from "../Avatar.tsx";
import { relativeTimeLabel } from "../relativeTime.ts";
import { messageSearchTextSegments, type MessageSearchResult } from "./messageSearchPresentation.ts";

interface MessageSearchResultRowProps {
  result: MessageSearchResult;
  query: string;
}

function HighlightedSearchText({ text, query }: { text: string; query: string }) {
  return messageSearchTextSegments(text, query).map((segment, index) => segment.matched
    ? <mark className="qs-message-result__match" key={`${index}:${segment.text}`}>{segment.text}</mark>
    : <span key={`${index}:${segment.text}`}>{segment.text}</span>);
}

export function MessageSearchResultRow({ result, query }: MessageSearchResultRowProps) {
  const { t } = useTranslation();
  const isTopic = result.channelType === "thread";
  const isDm = result.channelType === "dm";
  const fallbackTitle = isTopic ? t("qs.topic") : isDm ? t("qs.unknownAgent") : t("qs.subChannel");
  const title = result.conversationName || result.channelName || fallbackTitle;
  const titleText = isTopic
    ? t("qs.topicTitleWithReplies", { title, count: result.replyCount ?? 0 })
    : title;
  const time = relativeTimeLabel(result.createdAt, t);
  const source = isTopic && result.parentChannelName ? `# ${result.parentChannelName}` : isDm ? t("qs.subDm") : "";
  const meta = [source, time].filter(Boolean).join(" · ");
  const preview = result.snippet || result.content;

  return <span className="qs-message-result">
    <span className="qs-message-result__icon" aria-hidden="true">
      {isDm
        ? <Avatar seed={title} url={result.conversationAvatarUrl} size={24} />
        : isTopic
          ? <MessageCircle size={17} />
          : <Hash size={17} />}
    </span>
    <span className="qs-message-result__content">
      <span className="qs-message-result__heading">
        <span className="qs-message-result__title"><HighlightedSearchText text={titleText} query={query} /></span>
        {meta ? <span className="qs-message-result__meta">{meta}</span> : null}
      </span>
      <span className="qs-message-result__preview">
        <strong>{result.senderName}</strong>
        {result.senderDeleted ? <span className="qs-message-result__deleted">{t("chat.deletedAgent")}</span> : null}
        <span aria-hidden="true">：</span>
        <span className="qs-message-result__snippet"><HighlightedSearchText text={preview} query={query} /></span>
      </span>
    </span>
  </span>;
}
