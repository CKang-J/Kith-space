import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useSearchParams } from "react-router-dom";
import { useStore, type Agent, type Channel, type Msg } from "../../../store.tsx";
import {
  AGENT_REPLY_STREAM_TICK_MS,
  absorbPersistedAgentMessagePreview,
  applyAgentReplyPreview,
  dropAgentReplyPreviewsForMessage,
  hasStreamingAgentReplyPreview,
  tickAgentReplyPreviews,
  type AgentReplyEvent,
} from "../../../lib/agentReplyPreview.ts";
import { nextThreadMeta, type ThreadMeta } from "../../../threadUnread.ts";
import { useConversationApi, type FollowedThread } from "../data/conversationApi.ts";
import type { ConversationMessageModel, ConversationPageSignal } from "./useConversationMessages.ts";

export interface OpenConversationThread {
  channelId: string;
  parent: Msg;
  followed: boolean;
}

export interface ConversationThreadModel {
  thread: OpenConversationThread | null;
  threadMeta: Record<string, ThreadMeta>;
  unreadThreads: FollowedThread[];
  threadMessageId: string | null;
  initialMetadataLoaded: boolean;
  startThread(message: Msg): Promise<void>;
  closeThread(): void;
  openUnreadThread(thread: Pick<FollowedThread, "threadChannelId" | "parentMessageId">): Promise<void>;
  setThreadFollowed(followed: boolean): void;
}

interface ConversationThreadsOptions {
  channel?: Pick<Channel, "id" | "type">;
  isArchived: boolean;
  unreadCount: number;
  currentUserId?: string;
  messages: Msg[];
  initialPage: ConversationPageSignal;
  olderPage: ConversationPageSignal;
  hasMore: boolean;
  loadingOlderRef: ConversationMessageModel["loadingOlderRef"];
  loadOlder: ConversationMessageModel["loadOlder"];
}

export function useConversationThreads({
  channel,
  isArchived,
  unreadCount,
  currentUserId,
  messages,
  initialPage,
  olderPage,
  hasMore,
  loadingOlderRef,
  loadOlder,
}: ConversationThreadsOptions): ConversationThreadModel {
  const conversationApi = useConversationApi();
  const { onEvent, markRead, openThread } = useStore();
  const onEventRef = useRef(onEvent);
  const markReadRef = useRef(markRead);
  const openThreadRef = useRef(openThread);
  const currentUserIdRef = useRef(currentUserId);
  onEventRef.current = onEvent;
  markReadRef.current = markRead;
  openThreadRef.current = openThread;
  currentUserIdRef.current = currentUserId;
  const currentChannelIdRef = useRef(channel?.id);
  currentChannelIdRef.current = channel?.id;
  const loadOlderRef = useRef(loadOlder);
  loadOlderRef.current = loadOlder;

  const [thread, setThread] = useState<OpenConversationThread | null>(null);
  const [threadMeta, setThreadMeta] = useState<Record<string, ThreadMeta>>({});
  const [unreadThreads, setUnreadThreads] = useState<FollowedThread[]>([]);
  const [initialMetadataPage, setInitialMetadataPage] = useState<{ channelId?: string; revision: number }>({ revision: -1 });
  const [searchParams, setSearchParams] = useSearchParams();
  const threadParam = searchParams.get("thread");
  const threadMessageId = searchParams.get("threadMsg");
  const initialMetadataAvailable = initialPage.revision > 0
    && initialPage.threadMetadata !== undefined
    && initialPage.channelId === channel?.id;
  if (initialMetadataAvailable && (
    initialMetadataPage.channelId !== channel?.id
    || initialMetadataPage.revision !== initialPage.revision
  )) {
    setThreadMeta(initialPage.threadMetadata!);
    setInitialMetadataPage({ channelId: channel?.id, revision: initialPage.revision });
  }
  const initialMetadataLoaded = initialMetadataAvailable
    && initialMetadataPage.channelId === channel?.id
    && initialMetadataPage.revision === initialPage.revision;

  useEffect(() => { setThread(null); }, [channel?.id]);

  useEffect(() => {
    if (!channel?.id || olderPage.channelId !== channel.id || !olderPage.revision || !olderPage.messageIds.length) return;
    const channelId = channel.id;
    void conversationApi.getThreadMetadata(channelId, olderPage.messageIds).then((metadata) => {
      if (currentChannelIdRef.current === channelId) {
        setThreadMeta((current) => ({ ...metadata, ...current }));
      }
    }).catch(() => {});
  }, [channel?.id, conversationApi, olderPage]);

  useEffect(() => {
    if (!channel || isArchived || channel.type === "dm" || channel.type === "thread") {
      setUnreadThreads([]);
      return;
    }
    const channelId = channel.id;
    let cancelled = false;
    void conversationApi.listFollowedThreads().then((threads) => {
      if (cancelled) return;
      setUnreadThreads(threads.filter((item) =>
        item.parentChannelId === channelId && item.unreadCount > 0 && !!item.parentMessageId));
    }).catch(() => {
      if (!cancelled) setUnreadThreads([]);
    });
    return () => { cancelled = true; };
  }, [channel, conversationApi, isArchived, unreadCount]);

  useEffect(() => onEventRef.current((event) => {
    if (event.type === "agent:deleted" && event.id) {
      setThread((current) => {
        if (!current || current.parent.senderId !== event.id) return current;
        return { ...current, parent: { ...current.parent, senderDeleted: true } };
      });
      setThreadMeta((current) => Object.fromEntries(Object.entries(current).map(([messageId, metadata]) => [messageId, {
        ...metadata,
        previews: metadata.previews?.map((preview) => preview.senderId === event.id ? { ...preview, senderDeleted: true } : preview),
      }])));
    } else if (event.type === "thread:updated" && event.parentMessageId) {
      setThreadMeta((current) => ({
        ...current,
        [event.parentMessageId]: nextThreadMeta(current[event.parentMessageId], {
          threadChannelId: event.threadChannelId,
          replyCount: event.replyCount,
          senderId: event.senderId,
        }, currentUserIdRef.current),
      }));
      const channelId = currentChannelIdRef.current;
      if (channelId) void conversationApi.getThreadMetadata(channelId, [event.parentMessageId]).then((fresh) => {
        if (currentChannelIdRef.current !== channelId || !fresh[event.parentMessageId]) return;
        setThreadMeta((current) => ({ ...current, [event.parentMessageId]: fresh[event.parentMessageId]! }));
      }).catch(() => {});
    }
  }), [conversationApi]);

  const startThread = useCallback(async (message: Msg) => {
    if (!channel) return;
    const metadata = threadMeta[message.id];
    if (isArchived && !metadata?.threadChannelId) return;
    const threadChannelId = metadata?.threadChannelId || await openThreadRef.current(channel.id, message.id);
    if (!threadChannelId) return;
    const followed = metadata?.followed ?? true;
    setThread({ channelId: threadChannelId, parent: message, followed });
    setThreadMeta((current) => current[message.id] ? {
      ...current,
      [message.id]: { ...current[message.id]!, unreadCount: 0 },
    } : current);
    markReadRef.current(threadChannelId);
  }, [channel, isArchived, threadMeta]);

  useEffect(() => {
    if (!threadParam || !messages.length) return;
    const shortId = threadParam.includes(":") ? threadParam.split(":").pop()! : threadParam;
    if (thread && (thread.parent.id === threadParam || thread.parent.id.startsWith(shortId))) return;
    const parent = messages.find((message) => message.id === threadParam || message.id.startsWith(shortId));
    if (parent) void startThread(parent);
    else if (hasMore && !loadingOlderRef.current) void loadOlderRef.current();
  }, [hasMore, loadingOlderRef, messages, startThread, thread, threadParam]);

  const closeThread = useCallback(() => {
    setThread(null);
    if (!searchParams.has("thread")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("thread");
    next.delete("threadMsg");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const openUnreadThread = useCallback(async (item: Pick<FollowedThread, "threadChannelId" | "parentMessageId">) => {
    if (!channel) return;
    try {
      const parent = await conversationApi.getMessage(item.parentMessageId);
      if (!parent) return;
      setThread({ channelId: item.threadChannelId, parent, followed: true });
      setThreadMeta((current) => current[parent.id] ? {
        ...current,
        [parent.id]: { ...current[parent.id]!, unreadCount: 0 },
      } : current);
      markReadRef.current(item.threadChannelId);
      setUnreadThreads((current) => current.filter((candidate) => candidate.threadChannelId !== item.threadChannelId));
    } catch {
      // Leave the unread affordance intact when its parent is unavailable.
    }
  }, [channel, conversationApi]);

  const setThreadFollowed = useCallback((followed: boolean) => {
    setThread((current) => current ? { ...current, followed } : current);
    setThreadMeta((current) => {
      if (!thread) return current;
      return {
        ...current,
        [thread.parent.id]: {
          threadChannelId: thread.channelId,
          replyCount: current[thread.parent.id]?.replyCount ?? 0,
          unreadCount: current[thread.parent.id]?.unreadCount,
          followed,
        },
      };
    });
  }, [thread]);

  return {
    thread,
    threadMeta,
    unreadThreads,
    threadMessageId,
    initialMetadataLoaded,
    startThread,
    closeThread,
    openUnreadThread,
    setThreadFollowed,
  };
}

export interface ThreadPanelModel {
  messages: Msg[];
  scrollRef: RefObject<HTMLDivElement | null>;
  followPending: boolean;
  toggleFollow(followed: boolean, onChange: (followed: boolean) => void): Promise<void>;
  markDone(onDone: () => void): Promise<void>;
}

export function useThreadPanelModel(
  channelId: string,
  agents: Agent[],
  focusMessageId?: string | null,
): ThreadPanelModel {
  const conversationApi = useConversationApi();
  const { onEvent, subscribeChannel } = useStore();
  const onEventRef = useRef(onEvent);
  const subscribeChannelRef = useRef(subscribeChannel);
  const agentsRef = useRef(agents);
  onEventRef.current = onEvent;
  subscribeChannelRef.current = subscribeChannel;
  agentsRef.current = agents;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [followPending, setFollowPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const highlightedReplyRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setMessages([]);
    subscribeChannelRef.current(channelId);
    void conversationApi.listMessages(channelId, 200).then((page) => {
      if (active) setMessages(page.messages);
    });
    return () => { active = false; };
  }, [channelId, conversationApi]);

  useEffect(() => onEventRef.current((event) => {
    if (event.type === "message" && event.channelId === channelId) {
      setMessages((current) => {
        const preview = absorbPersistedAgentMessagePreview(current, event.message);
        if (preview.consumed) return preview.messages;
        return [...dropAgentReplyPreviewsForMessage(current, event.message), event.message];
      });
    } else if (event.type === "message:updated" && event.message?.channelId === channelId) {
      setMessages((current) => current.map((message) => message.id === event.message.id ? { ...message, ...event.message } : message));
    } else if (event.type === "agent:deleted" && event.id) {
      setMessages((current) => current.map((message) => message.senderId === event.id ? { ...message, senderDeleted: true } : message));
    } else if (event.type === "agent:reply" && event.channelId === channelId) {
      setMessages((current) => applyAgentReplyPreview(
        current,
        event as AgentReplyEvent,
        agentsRef.current.find((agent) => agent.id === event.agentId),
      ));
    }
  }), [channelId]);

  const streamingPreviewActive = hasStreamingAgentReplyPreview(messages);
  useEffect(() => {
    if (!streamingPreviewActive) return;
    const timer = window.setInterval(() => {
      setMessages((current) => {
        const tick = tickAgentReplyPreviews(current);
        return tick.changed ? tick.messages : current;
      });
    }, AGENT_REPLY_STREAM_TICK_MS);
    return () => window.clearInterval(timer);
  }, [streamingPreviewActive]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => { highlightedReplyRef.current = null; }, [channelId]);
  useEffect(() => {
    if (!focusMessageId || highlightedReplyRef.current === focusMessageId) return;
    const element = document.getElementById(`m-${focusMessageId}`);
    if (!element) return;
    highlightedReplyRef.current = focusMessageId;
    element.scrollIntoView({ block: "center" });
    element.classList.add("msg-hl");
    window.setTimeout(() => element.classList.remove("msg-hl"), 2200);
  }, [focusMessageId, messages]);

  const toggleFollow = useCallback(async (followed: boolean, onChange: (followed: boolean) => void) => {
    if (followPending) return;
    const next = !followed;
    setFollowPending(true);
    try {
      await conversationApi.setThreadFollowed(channelId, next);
      onChange(next);
    } finally {
      setFollowPending(false);
    }
  }, [channelId, conversationApi, followPending]);

  const markDone = useCallback(async (onDone: () => void) => {
    await conversationApi.markThreadDone(channelId);
    onDone();
  }, [channelId, conversationApi]);

  return { messages, scrollRef, followPending, toggleFollow, markDone };
}
