import type {
  ClassifiedConversationFileCategory,
  ConversationFile,
  ConversationFileCategory,
  ThreadSummary,
} from "./types.ts";

export function classifyConversationFile(mimeType?: string | null): ClassifiedConversationFileCategory {
  const normalizedMime = mimeType?.trim().toLowerCase() ?? "";
  if (normalizedMime.startsWith("image/")) return "image";
  if (normalizedMime.startsWith("video/")) return "video";
  return "file";
}

export function filterConversationFiles(
  files: readonly ConversationFile[],
  category: ConversationFileCategory,
  query: string,
): ConversationFile[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return files.filter((file) => {
    if (category !== "all" && classifyConversationFile(file.mimeType) !== category) return false;
    if (!normalizedQuery) return true;

    const filename = file.filename.toLocaleLowerCase();
    const sourceMessageText = file.sourceMessageText?.toLocaleLowerCase() ?? "";
    return filename.includes(normalizedQuery) || sourceMessageText.includes(normalizedQuery);
  });
}

const activityTime = (topic: ThreadSummary): number => {
  const parsed = Date.parse(topic.lastReplyAt || topic.createdAt);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export function sortConversationTopics(topics: readonly ThreadSummary[]): ThreadSummary[] {
  return [...topics].sort((left, right) => activityTime(right) - activityTime(left));
}

export function formatConversationFileSize(sizeBytes?: number | null): string {
  if (!sizeBytes) return "";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
