import { useMemo, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Lightbox, type LightboxImage } from "../Lightbox.tsx";
import { composerAttachmentVisual } from "../views/composer/composerAttachmentKind.ts";

export interface AttachmentCardProps {
  filename: string;
  mimeType?: string | null;
  imageSrc?: string;
  imageId?: string;
  imageGallery?: readonly LightboxImage[];
  href?: string;
  sizeLabel?: string;
  status?: "uploading" | "done" | "error";
  progress?: number;
  onRemove?(): void;
}

export function AttachmentTypeIcon({ filename, mimeType }: { filename: string; mimeType?: string | null }) {
  const visual = composerAttachmentVisual(filename, mimeType);
  return <span className="attachment-card__file-icon" data-file-kind={visual.kind} aria-hidden="true">{visual.label}</span>;
}

export function AttachmentCard({ filename, mimeType, imageSrc, imageId, imageGallery, href, sizeLabel, status, progress = 0, onRemove }: AttachmentCardProps) {
  const { t } = useTranslation();
  const [previewOpen, setPreviewOpen] = useState(false);
  const image = !!imageSrc && !!mimeType?.startsWith("image/");
  const visual = composerAttachmentVisual(filename, mimeType);
  const viewerImages = useMemo<readonly LightboxImage[]>(() => {
    if (imageGallery?.length) return imageGallery;
    return imageSrc ? [{ id: imageId || imageSrc, src: imageSrc, alt: filename }] : [];
  }, [filename, imageGallery, imageId, imageSrc]);
  const percent = Math.max(0, Math.min(100, progress));
  const meta = [visual.label, sizeLabel].filter(Boolean).join(" · ");
  const copy = (
    <>
      <AttachmentTypeIcon filename={filename} mimeType={mimeType} />
      <span className="attachment-card__copy">
        <strong>{filename}</strong>
        <small>{meta}</small>
      </span>
    </>
  );

  return (
    <div className={`attachment-card ${image ? "is-image" : "is-file"}${onRemove ? " has-remove" : ""}${status ? ` is-${status}` : ""}`} title={filename}>
      {image ? (
        <button type="button" className="attachment-card__preview" aria-label={t("chat.previewImage", { name: filename })} onClick={() => setPreviewOpen(true)}>
          <img src={imageSrc} alt={filename} />
        </button>
      ) : href ? (
        <a className="attachment-card__body" href={href} target="_blank" rel="noreferrer">{copy}</a>
      ) : (
        <span className="attachment-card__body">{copy}</span>
      )}
      {status === "uploading" ? <span className="attachment-card__status">{percent}%</span> : null}
      {status === "error" ? <span className="attachment-card__status is-error">!</span> : null}
      {status === "uploading" ? (
        <span className="attachment-card__progress" style={{ ["--attachment-progress" as string]: `${percent}%` } as CSSProperties} />
      ) : null}
      {onRemove ? (
        <button type="button" className="attachment-card__remove" aria-label={t("chat.removeAttachment", { name: filename })} onClick={onRemove}>
          <X size={10} aria-hidden="true" />
        </button>
      ) : null}
      {previewOpen && viewerImages.length ? <Lightbox images={viewerImages} initialImageId={imageId || viewerImages[0]!.id} onClose={() => setPreviewOpen(false)} /> : null}
    </div>
  );
}
