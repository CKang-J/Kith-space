import { useRef, useState, type CSSProperties, type FocusEventHandler, type MouseEventHandler, type PointerEventHandler, type ReactNode } from "react";
import type { ChatMessageSurface, ChatMessageTone } from "./messagePresentation.ts";

interface ChatMessageItemProps {
  id?: string;
  surface: ChatMessageSurface;
  tone?: ChatMessageTone;
  avatar?: ReactNode;
  header?: ReactNode;
  toolbar?: ReactNode;
  continuationTimestamp?: ReactNode;
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
  children,
  className = "",
  style,
  onContextMenu,
}: ChatMessageItemProps) {
  const bubbleWrapRef = useRef<HTMLDivElement>(null);
  const toolbarSlotRef = useRef<HTMLDivElement>(null);
  const [toolbarPlacement, setToolbarPlacement] = useState<"side" | "above">("side");
  const classes = [
    "chat-message",
    `chat-message--${surface}`,
    tone ? `chat-message--${tone}` : "",
    toolbar ? "chat-message--has-toolbar" : "",
    className,
  ].filter(Boolean).join(" ");

  const updateToolbarPlacement = () => {
    const bubbleWrap = bubbleWrapRef.current;
    const toolbarSlot = toolbarSlotRef.current;
    if (!bubbleWrap || !toolbarSlot) return;
    const bubbleRect = bubbleWrap.getBoundingClientRect();
    const scrollBoundary = bubbleWrap.closest<HTMLElement>(".scroll")?.getBoundingClientRect().right ?? window.innerWidth;
    const rightBoundary = Math.min(window.innerWidth, scrollBoundary);
    const next = rightBoundary - bubbleRect.right >= toolbarSlot.getBoundingClientRect().width + 8 ? "side" : "above";
    setToolbarPlacement((current) => current === next ? current : next);
  };

  const handleBubblePointerEnter: PointerEventHandler<HTMLDivElement> = () => updateToolbarPlacement();
  const handleBubbleFocus: FocusEventHandler<HTMLDivElement> = () => updateToolbarPlacement();

  return (
    <article id={id} className={classes} style={style} onContextMenu={onContextMenu}>
      <div className="chat-message__avatar">
        {avatar}
        {continuationTimestamp ? <span className="chat-message__continuation-timestamp ts">{continuationTimestamp}</span> : null}
      </div>
      <div className="chat-message__content">
        {header ? <div className="chat-message__header">{header}</div> : null}
        <div ref={bubbleWrapRef} className="chat-message__bubble-wrap" onPointerEnter={handleBubblePointerEnter} onFocusCapture={handleBubbleFocus}>
          <div className="chat-message__bubble">{children}</div>
          {toolbar ? <div ref={toolbarSlotRef} className={`chat-message__toolbar-slot chat-message__toolbar-slot--${toolbarPlacement}`}>{toolbar}</div> : null}
        </div>
      </div>
    </article>
  );
}

export function MessageHeader({
  sender,
  badge,
  timestamp,
}: {
  sender: ReactNode;
  badge?: ReactNode;
  timestamp?: ReactNode;
}) {
  return (
    <>
      {sender}
      {badge}
      {timestamp ? <span className="chat-message__timestamp ts">{timestamp}</span> : null}
    </>
  );
}

export function MessageToolbar({ children }: { children: ReactNode }) {
  return <div className="chat-message__toolbar">{children}</div>;
}
