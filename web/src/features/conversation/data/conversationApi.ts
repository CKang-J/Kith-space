import { useMemo, useRef } from "react";
import { useStore, type Msg } from "../../../store.tsx";
import type { ThreadMeta } from "../../../threadUnread.ts";
import { fetchThreadMetadata } from "../../../views/chat-message/threadPreviewApi.ts";

export type ConversationApiClient = (method: string, path: string, body?: unknown) => Promise<any>;

export interface FollowedThread {
  threadChannelId: string;
  parentMessageId: string;
  parentChannelId: string;
  unreadCount: number;
}

export interface ConversationPage {
  messages: Msg[];
  hasMore: boolean;
}

export interface ConversationApi {
  listMessages(channelId: string, limit: number, before?: number): Promise<ConversationPage>;
  getMessage(messageId: string): Promise<Msg | undefined>;
  listFollowedThreads(): Promise<FollowedThread[]>;
  getThreadMetadata(channelId: string, parentMessageIds: string[]): Promise<Record<string, ThreadMeta>>;
  unarchiveChannel(channelId: string): Promise<void>;
  setThreadFollowed(threadChannelId: string, followed: boolean): Promise<void>;
  markThreadDone(threadChannelId: string): Promise<void>;
}

export function createConversationApi(api: ConversationApiClient): ConversationApi {
  return {
    async listMessages(channelId, limit, before) {
      const beforeQuery = before === undefined ? "" : `&before=${before}`;
      const result = await api("GET", `/api/messages/channel/${encodeURIComponent(channelId)}?limit=${limit}${beforeQuery}`);
      return {
        messages: Array.isArray(result?.messages) ? result.messages : [],
        hasMore: !!result?.hasMore,
      };
    },
    async getMessage(messageId) {
      const result = await api("GET", `/api/messages/${encodeURIComponent(messageId)}`);
      return result?.message as Msg | undefined;
    },
    async listFollowedThreads() {
      const result = await api("GET", "/api/channels/threads/followed");
      return Array.isArray(result?.threads) ? result.threads : [];
    },
    getThreadMetadata(channelId, parentMessageIds) {
      return fetchThreadMetadata(api, channelId, parentMessageIds);
    },
    async unarchiveChannel(channelId) {
      const result = await api("POST", `/api/channels/${encodeURIComponent(channelId)}/unarchive`);
      if (result?.error) throw new Error(String(result.error));
    },
    async setThreadFollowed(threadChannelId, followed) {
      await api("POST", `/api/channels/threads/${followed ? "follow" : "unfollow"}`, { threadChannelId });
    },
    async markThreadDone(threadChannelId) {
      await api("POST", "/api/channels/threads/done", { threadChannelId });
    },
  };
}

export function useConversationApi(): ConversationApi {
  const { api } = useStore();
  const apiRef = useRef(api);
  apiRef.current = api;
  return useMemo(() => createConversationApi((method, path, body) => apiRef.current(method, path, body)), []);
}
