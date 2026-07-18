import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { useStore, type Agent, type Msg } from "../../../store.tsx";
import { PAGE_SIZE, appendWithCap } from "../../../lib/msgPaging.ts";
import {
  AGENT_REPLY_STREAM_TICK_MS,
  absorbPersistedAgentMessagePreview,
  applyAgentReplyPreview,
  dropAgentReplyPreviewForThreadReply,
  dropAgentReplyPreviewsForMessage,
  hasStreamingAgentReplyPreview,
  tickAgentReplyPreviews,
  type AgentReplyEvent,
} from "../../../lib/agentReplyPreview.ts";
import type { ThreadMeta } from "../../../threadUnread.ts";
import { useConversationApi } from "../data/conversationApi.ts";

export interface ConversationPageSignal {
  channelId?: string;
  messageIds: string[];
  revision: number;
  threadMetadata?: Record<string, ThreadMeta>;
}

export interface ConversationMessageModel {
  messages: Msg[];
  loaded: boolean;
  loadError: boolean;
  hasMore: boolean;
  initialPage: ConversationPageSignal;
  olderPage: ConversationPageSignal;
  atBottomRef: MutableRefObject<boolean>;
  forceBottomPinRef: MutableRefObject<boolean>;
  loadingOlderRef: MutableRefObject<boolean>;
  beforePrependRef: MutableRefObject<(() => void) | null>;
  newMessageOrderRef: MutableRefObject<Map<string, number>>;
  burstCountRef: MutableRefObject<number>;
  reload(): Promise<void>;
  loadOlder(): Promise<void>;
}

export function useConversationMessages(
  channelId: string | undefined,
  agents: Agent[],
  currentUserId?: string,
): ConversationMessageModel {
  const conversationApi = useConversationApi();
  const { onEvent, subscribeChannel, markRead } = useStore();
  const onEventRef = useRef(onEvent);
  const subscribeChannelRef = useRef(subscribeChannel);
  const markReadRef = useRef(markRead);
  const agentsRef = useRef(agents);
  const currentUserIdRef = useRef(currentUserId);
  onEventRef.current = onEvent;
  subscribeChannelRef.current = subscribeChannel;
  markReadRef.current = markRead;
  agentsRef.current = agents;
  currentUserIdRef.current = currentUserId;

  const [messages, setMessages] = useState<Msg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [initialPage, setInitialPage] = useState<ConversationPageSignal>({ channelId, messageIds: [], revision: 0 });
  const [olderPage, setOlderPage] = useState<ConversationPageSignal>({ channelId, messageIds: [], revision: 0 });
  const currentChannelIdRef = useRef(channelId);
  currentChannelIdRef.current = channelId;
  const atBottomRef = useRef(true);
  const forceBottomPinRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const beforePrependRef = useRef<(() => void) | null>(null);
  const trimmedRef = useRef(false);
  const newMessageOrderRef = useRef(new Map<string, number>());
  const burstCountRef = useRef(0);
  const burstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [shownChannelId, setShownChannelId] = useState(channelId);
  if (channelId !== shownChannelId) {
    setShownChannelId(channelId);
    setMessages([]);
    setLoaded(false);
    setLoadError(false);
    setHasMore(false);
    setInitialPage({ channelId, messageIds: [], revision: 0 });
    setOlderPage({ channelId, messageIds: [], revision: 0 });
  }

  const reload = useCallback(async () => {
    if (!channelId) return;
    const requestedChannelId = channelId;
    setLoaded(false);
    setLoadError(false);
    try {
      const page = await conversationApi.listMessages(requestedChannelId, PAGE_SIZE);
      if (currentChannelIdRef.current !== requestedChannelId) return;
      setMessages(page.messages);
      setHasMore(page.hasMore);
      markReadRef.current(requestedChannelId);
      const messageIds = page.messages.map((message) => message.id);
      let threadMetadata: Record<string, ThreadMeta> = {};
      if (messageIds.length) {
        try {
          threadMetadata = await conversationApi.getThreadMetadata(requestedChannelId, messageIds);
        } catch {
          // Thread previews are optional; preserve the visible message page when they are unavailable.
        }
      }
      if (currentChannelIdRef.current !== requestedChannelId) return;
      setInitialPage((current) => ({
        channelId: requestedChannelId,
        messageIds,
        revision: current.revision + 1,
        threadMetadata,
      }));
    } catch {
      if (currentChannelIdRef.current !== requestedChannelId) return;
      setMessages([]);
      setHasMore(false);
      setInitialPage((current) => ({
        channelId: requestedChannelId,
        messageIds: [],
        revision: current.revision + 1,
        threadMetadata: {},
      }));
      setLoadError(true);
    } finally {
      if (currentChannelIdRef.current === requestedChannelId) setLoaded(true);
    }
  }, [channelId, conversationApi]);

  useEffect(() => {
    if (!channelId) return;
    loadingOlderRef.current = false;
    beforePrependRef.current = null;
    subscribeChannelRef.current(channelId);
    void reload();
  }, [channelId, reload]);

  useEffect(() => {
    if (!channelId) return;
    return onEventRef.current((event) => {
      if (event.type === "message" && event.channelId === channelId) {
        const message = event.message as Msg;
        if (message.senderType === "human" && message.senderId === currentUserIdRef.current) forceBottomPinRef.current = true;
        setMessages((current) => {
          const preview = absorbPersistedAgentMessagePreview(current, message);
          if (preview.consumed) {
            forceBottomPinRef.current = true;
            newMessageOrderRef.current.delete(message.id);
            return preview.messages;
          }
          const order = Math.min(burstCountRef.current, 7);
          newMessageOrderRef.current.set(message.id, order);
          burstCountRef.current += 1;
          if (burstTimerRef.current) clearTimeout(burstTimerRef.current);
          burstTimerRef.current = setTimeout(() => {
            burstCountRef.current = 0;
            burstTimerRef.current = null;
          }, 600);
          const { next, trimmed } = appendWithCap(
            dropAgentReplyPreviewsForMessage(current, message),
            message,
            atBottomRef.current && !loadingOlderRef.current,
          );
          if (trimmed) trimmedRef.current = true;
          return next;
        });
        markReadRef.current(channelId);
      } else if (event.type === "message:updated" && event.message) {
        setMessages((current) => current.map((message) => message.id === event.message.id ? { ...message, ...event.message } : message));
      } else if (event.type === "agent:deleted" && event.id) {
        setMessages((current) => current.map((message) => message.senderId === event.id ? { ...message, senderDeleted: true } : message));
      } else if (event.type === "agent:reply" && event.channelId === channelId) {
        forceBottomPinRef.current = true;
        setMessages((current) => applyAgentReplyPreview(
          current,
          event as AgentReplyEvent,
          agentsRef.current.find((agent) => agent.id === event.agentId),
        ));
      } else if (event.type === "thread:updated" && event.parentMessageId) {
        setMessages((current) => dropAgentReplyPreviewForThreadReply(current, {
          parentMessageId: event.parentMessageId,
          senderId: event.senderId,
          senderType: event.senderType,
          replyCount: event.replyCount,
        }));
      }
    });
  }, [channelId]);

  const streamingPreviewActive = hasStreamingAgentReplyPreview(messages);
  useEffect(() => {
    if (!streamingPreviewActive) return;
    const timer = window.setInterval(() => {
      setMessages((current) => {
        const tick = tickAgentReplyPreviews(current);
        if (tick.changed) forceBottomPinRef.current = true;
        return tick.changed ? tick.messages : current;
      });
    }, AGENT_REPLY_STREAM_TICK_MS);
    return () => window.clearInterval(timer);
  }, [streamingPreviewActive]);

  useEffect(() => {
    if (!trimmedRef.current) return;
    trimmedRef.current = false;
    setHasMore(true);
  }, [messages]);

  useEffect(() => () => {
    if (burstTimerRef.current) clearTimeout(burstTimerRef.current);
  }, []);

  const loadOlder = useCallback(async () => {
    if (!channelId || loadingOlderRef.current || !hasMore || !messages.length) return;
    const requestedChannelId = channelId;
    loadingOlderRef.current = true;
    try {
      const page = await conversationApi.listMessages(requestedChannelId, PAGE_SIZE, messages[0]!.seq);
      if (currentChannelIdRef.current !== requestedChannelId) return;
      if (page.messages.length) {
        beforePrependRef.current?.();
        setMessages((current) => [...page.messages, ...current]);
        setOlderPage((current) => ({
          channelId: requestedChannelId,
          messageIds: page.messages.map((message) => message.id),
          revision: current.revision + 1,
        }));
      }
      setHasMore(page.hasMore);
    } catch {
      // Transient history failures retry on the next scroll-to-top.
    } finally {
      loadingOlderRef.current = false;
    }
  }, [channelId, conversationApi, hasMore, messages]);

  return {
    messages,
    loaded,
    loadError,
    hasMore,
    initialPage,
    olderPage,
    atBottomRef,
    forceBottomPinRef,
    loadingOlderRef,
    beforePrependRef,
    newMessageOrderRef,
    burstCountRef,
    reload,
    loadOlder,
  };
}
