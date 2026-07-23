import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface MenuPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  ready: boolean;
}

const VIEWPORT_MARGIN = 12;
const MENU_GAP = 6;
const MENU_MIN_WIDTH = 230;
const MENU_MAX_WIDTH = 300;
const MENU_MAX_HEIGHT = 360;

export function MemoryFilterMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MenuPosition>({
    left: VIEWPORT_MARGIN,
    top: VIEWPORT_MARGIN,
    width: MENU_MIN_WIDTH,
    maxHeight: MENU_MAX_HEIGHT,
    ready: false,
  });

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const triggerRect = trigger.getBoundingClientRect();
      const width = Math.min(
        MENU_MAX_WIDTH,
        Math.max(MENU_MIN_WIDTH, triggerRect.width),
        window.innerWidth - VIEWPORT_MARGIN * 2,
      );
      const availableBelow = Math.max(0, window.innerHeight - triggerRect.bottom - MENU_GAP - VIEWPORT_MARGIN);
      const availableAbove = Math.max(0, triggerRect.top - MENU_GAP - VIEWPORT_MARGIN);
      const desiredHeight = Math.min(menu.scrollHeight, MENU_MAX_HEIGHT);
      const openBelow = availableBelow >= Math.min(desiredHeight, 180) || availableBelow >= availableAbove;
      const availableHeight = openBelow ? availableBelow : availableAbove;
      const maxHeight = Math.max(80, Math.min(MENU_MAX_HEIGHT, availableHeight));
      const renderedHeight = Math.min(menu.scrollHeight, maxHeight);
      const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
      const left = Math.max(VIEWPORT_MARGIN, Math.min(triggerRect.left, maxLeft));
      const top = openBelow
        ? triggerRect.bottom + MENU_GAP
        : triggerRect.top - MENU_GAP - renderedHeight;
      setPosition({
        left,
        top: Math.max(VIEWPORT_MARGIN, top),
        width,
        maxHeight,
        ready: true,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  return (
    <div className="memory-filter-menu">
      <button
        ref={triggerRef}
        type="button"
        className="memory-filter-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          setPosition((current) => ({ ...current, ready: false }));
        }}
      >
        {label}
      </button>
      {open ? createPortal(
        <div
          ref={menuRef}
          className="memory-filter-popover"
          role="dialog"
          aria-label="记忆筛选"
          style={{
            left: position.left,
            top: position.top,
            width: position.width,
            maxHeight: position.maxHeight,
            visibility: position.ready ? "visible" : "hidden",
          }}
        >
          {children}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
