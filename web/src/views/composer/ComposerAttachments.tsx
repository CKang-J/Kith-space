import { useTranslation } from "react-i18next";
import { AttachmentCard } from "../../components/AttachmentCard.tsx";

export interface PendingAttachment {
  id: string;
  filename: string;
  mimeType?: string | null;
  localUrl?: string;
  status?: "uploading" | "done" | "error";
  progress?: number;
}

interface ComposerAttachmentsProps {
  attachments: PendingAttachment[];
  attachmentUrl(id: string): string;
  onRemove(id: string): void;
}

function isImage(mimeType?: string | null) {
  return !!mimeType && mimeType.startsWith("image/");
}

export function ComposerAttachments({ attachments, attachmentUrl, onRemove }: ComposerAttachmentsProps) {
  const { t } = useTranslation();

  if (!attachments.length) return null;

  return (
    <div className="attachment-list" aria-label={t("chat.pendingAttachments")} aria-live="polite">
      {attachments.map((attachment) => {
        const image = isImage(attachment.mimeType);
        const src = attachment.localUrl || (attachment.status !== "uploading" ? attachmentUrl(attachment.id) : "");
        return (
          <AttachmentCard
            key={attachment.id}
            filename={attachment.filename}
            mimeType={attachment.mimeType}
            imageSrc={image && src ? src : undefined}
            status={attachment.status}
            progress={attachment.progress}
            onRemove={() => onRemove(attachment.id)}
          />
        );
      })}
    </div>
  );
}
