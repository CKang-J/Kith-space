export type ConversationAggregateTab = "trace" | "topics" | "files";

export type ConversationFileCategory = "all" | "image" | "video" | "file";
export type ClassifiedConversationFileCategory = Exclude<ConversationFileCategory, "all">;

export interface ConversationFileUploader {
  type?: string;
  id?: string | null;
  name?: string | null;
  displayName?: string | null;
}

export interface ConversationFile {
  id: string;
  filename: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  createdAt?: string | null;
  channelId?: string | null;
  messageId?: string | null;
  sourceMessageText?: string | null;
  uploader?: ConversationFileUploader | null;
}

export interface ThreadSummarySender {
  type: string;
  id: string | null;
  name: string;
}

export interface ThreadSummary {
  threadChannelId: string;
  parentMessageId: string;
  parentChannelId: string;
  parentMessageText: string;
  parentSender: ThreadSummarySender;
  replyCount: number;
  unreadCount: number;
  followed: boolean;
  lastReplyAt?: string | null;
  createdAt: string;
}
