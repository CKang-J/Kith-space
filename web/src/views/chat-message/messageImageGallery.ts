import type { LightboxImage } from "../../Lightbox.tsx";
import type { Att, Msg } from "../../store.tsx";

const isImageAttachment = (attachment: Att) => !!attachment.mimeType?.startsWith("image/");

export function buildMessageImageGallery(messages: readonly Msg[], attachmentUrl: (id: string) => string): LightboxImage[] {
  const seen = new Set<string>();
  const images: LightboxImage[] = [];
  for (const message of messages) {
    for (const attachment of message.attachments || []) {
      if (!isImageAttachment(attachment) || seen.has(attachment.id)) continue;
      seen.add(attachment.id);
      images.push({ id: attachment.id, src: attachmentUrl(attachment.id), alt: attachment.filename });
    }
  }
  return images;
}

export function isSingleImageMessage(attachments?: readonly Att[]): boolean {
  return attachments?.length === 1 && isImageAttachment(attachments[0]!);
}
