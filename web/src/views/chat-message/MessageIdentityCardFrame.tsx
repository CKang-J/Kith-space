import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface MessageCardAnchor {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface MessageIdentityCardFrameProps {
  anchor: MessageCardAnchor;
  trigger: HTMLElement;
  className: string;
  labelledBy: string;
  placementKey?: string;
  busy?: boolean;
  onClose(): void;
  children: ReactNode;
}

const VIEWPORT_MARGIN = 8;
const CARD_GAP = 8;

export function MessageIdentityCardFrame({
  anchor,
  trigger,
  className,
  labelledBy,
  placementKey = "",
  busy = false,
  onClose,
  children,
}: MessageIdentityCardFrameProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });

  const place = useCallback(() => {
    const card = cardRef.current;
    if (!card) return;
    const cardRect = card.getBoundingClientRect();
    const canFitRight = window.innerWidth - anchor.right >= cardRect.width + CARD_GAP + VIEWPORT_MARGIN;
    const left = canFitRight
      ? anchor.right + CARD_GAP
      : Math.max(VIEWPORT_MARGIN, anchor.left - cardRect.width - CARD_GAP);
    const top = Math.max(
      VIEWPORT_MARGIN,
      Math.min(anchor.top, window.innerHeight - cardRect.height - VIEWPORT_MARGIN),
    );
    setPosition({ left, top, visibility: "visible" });
  }, [anchor.left, anchor.right, anchor.top]);

  useLayoutEffect(() => place(), [place, placementKey]);

  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (cardRef.current?.contains(target) || trigger.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
      trigger.focus({ preventScroll: true });
    };
    const onViewportChange = () => onClose();
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [onClose, trigger]);

  return createPortal(
    <div
      ref={cardRef}
      className={`message-identity-card ${className}`}
      style={position}
      role="dialog"
      aria-modal="false"
      aria-labelledby={labelledBy}
      aria-busy={busy}
      tabIndex={-1}
    >
      {children}
    </div>,
    document.body,
  );
}
