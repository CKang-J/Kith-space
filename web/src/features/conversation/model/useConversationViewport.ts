import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Msg } from "../../../store.tsx";
import { nextScrollState } from "../../../lib/msgPaging.ts";
import type { ConversationMessageModel } from "./useConversationMessages.ts";

export const BACK_TO_BOTTOM_SCROLL_MS = 800;
export const MESSAGE_ENTER_PIN_MS = 1000;
export const backToBottomEase = (time: number) => 1 - Math.pow(1 - time, 3);

export function animateBackToBottom(
  element: Pick<HTMLDivElement, "scrollTop" | "scrollHeight">,
  done?: () => void,
) {
  const start = element.scrollTop;
  const target = element.scrollHeight;
  const delta = target - start;
  if (!delta) { done?.(); return; }
  const startTime = performance.now();
  const step = (now: number) => {
    const time = Math.min(1, (now - startTime) / BACK_TO_BOTTOM_SCROLL_MS);
    element.scrollTop = start + delta * backToBottomEase(time);
    if (time < 1) requestAnimationFrame(step);
    else { element.scrollTop = target; done?.(); }
  };
  requestAnimationFrame(step);
}

export function keepPinnedToBottomDuringEnter(
  element: Pick<HTMLDivElement, "scrollTop" | "scrollHeight">,
  shouldContinue: () => boolean,
  durationMs = MESSAGE_ENTER_PIN_MS,
) {
  const startTime = performance.now();
  const pin = () => { element.scrollTop = element.scrollHeight; };
  pin();
  const step = (now: number) => {
    if (!shouldContinue()) return;
    pin();
    if (now - startTime < durationMs) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export interface ConversationViewportModel {
  scrollRef: RefObject<HTMLDivElement | null>;
  showJump: boolean;
  onScroll(): void;
  toBottom(): void;
}

export function useConversationViewport(
  channelId: string | undefined,
  messages: Msg[],
  messageId: string | null,
  messageModel: Pick<ConversationMessageModel,
    "hasMore" | "loadOlder" | "loadingOlderRef" | "atBottomRef" | "forceBottomPinRef" |
    "beforePrependRef" | "newMessageOrderRef" | "burstCountRef">,
): ConversationViewportModel {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showJump, setShowJump] = useState(false);
  const showJumpRef = useRef(false);
  const scrollingToBottomRef = useRef(false);
  const prependRestoreHeightRef = useRef<number | null>(null);
  const highlightedMessageRef = useRef<string | null>(null);
  const loadOlderRef = useRef(messageModel.loadOlder);
  const hasMoreRef = useRef(messageModel.hasMore);
  loadOlderRef.current = messageModel.loadOlder;
  hasMoreRef.current = messageModel.hasMore;

  messageModel.beforePrependRef.current = () => {
    prependRestoreHeightRef.current = scrollRef.current?.scrollHeight ?? null;
  };

  const setJumpVisible = useCallback((visible: boolean) => {
    showJumpRef.current = visible;
    setShowJump(visible);
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || messageId) return;
    const force = messageModel.forceBottomPinRef.current;
    if (force) {
      messageModel.forceBottomPinRef.current = false;
      messageModel.atBottomRef.current = true;
      setJumpVisible(false);
    }
    if (force || messageModel.atBottomRef.current) {
      keepPinnedToBottomDuringEnter(element, () => !messageId && (force || messageModel.atBottomRef.current));
    }
  }, [messageId, messages, messageModel.atBottomRef, messageModel.forceBottomPinRef, setJumpVisible]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || prependRestoreHeightRef.current == null) return;
    element.scrollTop = element.scrollHeight - prependRestoreHeightRef.current;
    prependRestoreHeightRef.current = null;
  }, [messages]);

  useEffect(() => {
    messageModel.atBottomRef.current = true;
    setJumpVisible(false);
    messageModel.newMessageOrderRef.current.clear();
    messageModel.burstCountRef.current = 0;
    highlightedMessageRef.current = null;
  }, [channelId, messageModel.atBottomRef, messageModel.burstCountRef, messageModel.newMessageOrderRef, setJumpVisible]);

  useEffect(() => {
    if (!messageId || highlightedMessageRef.current === messageId) return;
    const element = document.getElementById(`m-${messageId}`);
    if (element) {
      highlightedMessageRef.current = messageId;
      element.scrollIntoView({ block: "center" });
      element.classList.add("msg-hl");
      setTimeout(() => element.classList.remove("msg-hl"), 2200);
    } else if (messageModel.hasMore && !messageModel.loadingOlderRef.current) {
      void messageModel.loadOlder();
    }
  }, [messageId, messages, messageModel.hasMore, messageModel.loadOlder, messageModel.loadingOlderRef]);

  const toBottom = useCallback(() => {
    const element = scrollRef.current;
    if (!element) {
      messageModel.atBottomRef.current = true;
      setJumpVisible(false);
      return;
    }
    scrollingToBottomRef.current = true;
    setJumpVisible(false);
    animateBackToBottom(element, () => {
      scrollingToBottomRef.current = false;
      messageModel.atBottomRef.current = true;
      setJumpVisible(false);
    });
  }, [messageModel.atBottomRef, setJumpVisible]);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (element.scrollTop < 80 && hasMoreRef.current && !messageModel.loadingOlderRef.current) {
      void loadOlderRef.current();
    }
    const next = nextScrollState(element, showJumpRef.current);
    messageModel.atBottomRef.current = next.atBottom;
    if (!scrollingToBottomRef.current && next.changed) setJumpVisible(next.showJump);
  }, [messageModel.atBottomRef, messageModel.loadingOlderRef, setJumpVisible]);

  return { scrollRef, showJump, onScroll, toBottom };
}
