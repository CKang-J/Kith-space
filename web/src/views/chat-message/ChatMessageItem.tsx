import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEventHandler, type MouseEventHandler, type PointerEventHandler, type ReactNode } from "react";
import type { ChatMessageSurface, ChatMessageTone } from "./messagePresentation.ts";

interface ChatMessageItemProps {
  id?: string;
  surface: ChatMessageSurface;
  tone?: ChatMessageTone;
  avatar?: ReactNode;
  header?: ReactNode;
  toolbar?: ReactNode;
  continuationTimestamp?: ReactNode;
  footerTimestamp?: ReactNode;
  afterBubble?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onContextMenu?: MouseEventHandler<HTMLElement>;
}

export function ChatMessageItem({
  id,
  surface,
  tone,
  avatar,
  header,
  toolbar,
  continuationTimestamp,
  footerTimestamp,
  afterBubble,
  children,
  className = "",
  style,
  onContextMenu,
}: ChatMessageItemProps) {
  const bubbleWrapRef = useRef<HTMLDivElement>(null);
  const toolbarSlotRef = useRef<HTMLDivElement>(null);
  const isHuman = (tone ?? surface) === "human";
  const [toolbarPlacement, setToolbarPlacement] = useState<"side" | "above" | "below">("below");
  const [toolbarActive, setToolbarActive] = useState(false);
  const classes = [
    "chat-message",
    `chat-message--${surface}`,
    tone ? `chat-message--${tone}` : "",
    toolbar ? "chat-message--has-toolbar" : "",
    className,
  ].filter(Boolean).join(" ");

  const updateToolbarPlacement = useCallback(() => {
    const bubbleWrap = bubbleWrapRef.current;
    const toolbarSlot = toolbarSlotRef.current;
    if (!bubbleWrap || !toolbarSlot) return;
    const bubbleRect = bubbleWrap.getBoundingClientRect();
    const scrollRect = bubbleWrap.closest<HTMLElement>(".scroll")?.getBoundingClientRect();
    const leftBoundary = Math.max(0, scrollRect?.left ?? 0);
    const rightBoundary = Math.min(window.innerWidth, scrollRect?.right ?? window.innerWidth);
    const toolbarRect = toolbarSlot.getBoundingClientRect();
    const sideSpace = isHuman
      ? bubbleRect.left - leftBoundary
      : rightBoundary - bubbleRect.right;
    const topBoundary = Math.max(0, scrollRect?.top ?? 0);
    const bottomBoundary = Math.min(window.innerHeight, scrollRect?.bottom ?? window.innerHeight);
    const topSpace = bubbleRect.top - topBoundary;
    const bottomSpace = bottomBoundary - bubbleRect.bottom;
    const toolbarGap = 6;
    const next = sideSpace >= toolbarRect.width + 8
      ? "side"
      : topSpace >= toolbarRect.height + toolbarGap
        ? "above"
        : bottomSpace >= toolbarRect.height + toolbarGap
          ? "below"
          : topSpace >= bottomSpace ? "above" : "below";
    setToolbarPlacement((current) => current === next ? current : next);
  }, [isHuman]);

  useLayoutEffect(() => {
    if (!toolbarActive) return;
    const bubbleWrap = bubbleWrapRef.current;
    const toolbarSlot = toolbarSlotRef.current;
    if (!bubbleWrap || !toolbarSlot) return;
    const scroll = bubbleWrap.closest<HTMLElement>(".scroll");
    let frame = 0;
    const schedulePlacementUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateToolbarPlacement);
    };
    const observer = new ResizeObserver(schedulePlacementUpdate);
    observer.observe(bubbleWrap);
    observer.observe(toolbarSlot);
    if (scroll) {
      observer.observe(scroll);
      scroll.addEventListener("scroll", schedulePlacementUpdate, { passive: true });
    }
    window.addEventListener("resize", schedulePlacementUpdate);
    updateToolbarPlacement();
    return () => {
      observer.disconnect();
      if (scroll) scroll.removeEventListener("scroll", schedulePlacementUpdate);
      window.removeEventListener("resize", schedulePlacementUpdate);
      window.cancelAnimationFrame(frame);
    };
  }, [toolbarActive, updateToolbarPlacement]);

  const handleBubblePointerEnter: PointerEventHandler<HTMLDivElement> = () => setToolbarActive(true);
  const handleBubblePointerLeave: PointerEventHandler<HTMLDivElement> = () => setToolbarActive(false);
  const handleBubbleFocus: FocusEventHandler<HTMLDivElement> = () => setToolbarActive(true);
  const handleBubbleBlur: FocusEventHandler<HTMLDivElement> = (event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setToolbarActive(false);
  };

  return (
    <article id={id} className={classes} style={style} onContextMenu={onContextMenu}>
      <div className="chat-message__avatar">
        {avatar}
        {continuationTimestamp ? <span className="chat-message__continuation-timestamp ts">{continuationTimestamp}</span> : null}
      </div>
      <div className="chat-message__content">
        {header ? <div className="chat-message__header">{header}</div> : null}
        <div
          ref={bubbleWrapRef}
          className="chat-message__bubble-wrap"
          onPointerEnter={handleBubblePointerEnter}
          onPointerLeave={handleBubblePointerLeave}
          onFocusCapture={handleBubbleFocus}
          onBlurCapture={handleBubbleBlur}
        >
          <div className="chat-message__bubble">{children}</div>
          {toolbar ? <div ref={toolbarSlotRef} className={`chat-message__toolbar-slot chat-message__toolbar-slot--${toolbarPlacement}`}>{toolbar}</div> : null}
        </div>
        {afterBubble ? <div className="chat-message__after-bubble">{afterBubble}</div> : null}
        {footerTimestamp ? <div className="chat-message__footer-timestamp ts">{footerTimestamp}</div> : null}
      </div>
    </article>
  );
}

export function MessageHeader({
  sender,
  badge,
}: {
  sender: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <>
      {sender}
      {badge}
    </>
  );
}

export function MessageToolbar({ children }: { children: ReactNode }) {
  return <div className="chat-message__toolbar">{children}</div>;
}
