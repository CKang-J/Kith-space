import { Reply } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar } from "../../Avatar.tsx";
import { relativeTimeLabel } from "../../relativeTime.ts";
import type { ThreadMeta, ThreadReplyPreview } from "../../threadUnread.ts";

interface MessageTopicPreviewProps {
  meta: ThreadMeta;
  onOpen(): void;
  avatarUrlFor?(reply: ThreadReplyPreview): string | null | undefined;
}

export function MessageTopicPreview({ meta, onOpen, avatarUrlFor }: MessageTopicPreviewProps) {
  const { t } = useTranslation();
  const previews = (meta.previews ?? []).filter((reply) => reply.senderType !== "system");
  const latest = relativeTimeLabel(meta.lastReplyAt, t);

  return (
    <button type="button" className="message-topic-preview" onClick={onOpen} aria-label={t("chat.openThread")}>
      {previews.length ? <span className="message-topic-preview__replies">
        {previews.map((reply) => <span key={reply.id} className="message-topic-preview__reply">
          <span className="message-topic-preview__reply-avatar" aria-hidden="true"><Avatar seed={reply.senderName} url={avatarUrlFor?.(reply)} size={16} /></span>
          <strong>{reply.senderName}</strong>
          {reply.senderDeleted ? <span className="message-topic-preview__deleted">{t("chat.deletedAgent")}</span> : null}
          <span className="message-topic-preview__reply-text">{reply.content}</span>
        </span>)}
      </span> : null}
      <span className="message-topic-preview__footer">
        <span className="message-topic-preview__action"><Reply size={13} aria-hidden="true" />{t("chat.replyInThread")}</span>
        <span className="message-topic-preview__count">{t("chat.replyCount", { count: meta.replyCount })}</span>
        {latest ? <span className="message-topic-preview__latest">{t("chat.latestReply", { time: latest })}</span> : null}
      </span>
    </button>
  );
}
