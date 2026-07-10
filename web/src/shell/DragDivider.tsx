import { useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

interface DragDividerProps {
  value: number;
  min: number;
  max: number;
  onChange: (width: number) => void;
}

export function DragDivider({ value, min, max, onChange }: DragDividerProps) {
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const startDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = value;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      cleanupRef.current = null;
    };
    const move = (pointerEvent: PointerEvent) => onChange(Math.min(max, Math.max(min, startWidth + startX - pointerEvent.clientX)));

    cleanupRef.current?.();
    cleanupRef.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const adjustWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = value + (event.key === "ArrowLeft" ? 16 : -16);
    onChange(Math.min(max, Math.max(min, next)));
  };

  return (
    <div
      className="shell-drag-divider"
      role="separator"
      aria-label="调整模块区宽度"
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={startDragging}
      onKeyDown={adjustWithKeyboard}
    />
  );
}
