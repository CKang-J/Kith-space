import type { CSSProperties } from "react";
import { FileText, X } from "lucide-react";
import { useTranslation } from "react-i18next";

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

function fileKind(filename: string) {
  const extension = filename.includes(".") ? filename.split(".").pop() : null;
  return extension?.toLocaleUpperCase() || "FILE";
}

export function ComposerAttachments({ attachments, attachmentUrl, onRemove }: ComposerAttachmentsProps) {
  const { t } = useTranslation();

  if (!attachments.length) return null;

  return (
    <div className="composer-attachments" aria-label={t("chat.pendingAttachments")} aria-live="polite">
      {attachments.map((attachment) => {
        const image = isImage(attachment.mimeType);
        const src = attachment.localUrl || (attachment.status !== "uploading" ? attachmentUrl(attachment.id) : "");
        const progress = Math.max(0, Math.min(100, attachment.progress || 0));
        return (
          <div
            key={attachment.id}
            className={`composer-attachment ${image && src ? "is-image" : "is-file"}${attachment.status ? ` is-${attachment.status}` : ""}`}
            title={attachment.filename}
          >
            {image && src ? (
              <img src={src} alt={attachment.filename} />
            ) : (
              <>
                <span className="composer-attachment__file-icon"><FileText size={18} aria-hidden="true" /></span>
                <span className="composer-attachment__copy">
                  <strong>{attachment.filename}</strong>
                  <small>{fileKind(attachment.filename)}</small>
                </span>
              </>
            )}
            {attachment.status === "uploading" ? <span className="composer-attachment__status">{progress}%</span> : null}
            {attachment.status === "error" ? <span className="composer-attachment__status is-error">!</span> : null}
            {attachment.status === "uploading" ? (
              <span
                className="composer-attachment__progress"
                style={{ ["--attachment-progress" as string]: `${progress}%` } as CSSProperties}
              />
            ) : null}
            <button
              type="button"
              className="composer-attachment__remove"
              aria-label={t("chat.removeAttachment", { name: attachment.filename })}
              onClick={() => onRemove(attachment.id)}
            >
              <X size={11} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
