import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

interface VerticalDragDividerProps {
  ariaLabel: string;
  className: string;
  disabled?: boolean;
  value: number;
  min: number;
  max: number;
  style?: CSSProperties;
  onChange: (width: number) => void;
}

export function VerticalDragDivider({
  ariaLabel,
  className,
  disabled = false,
  value,
  min,
  max,
  style,
  onChange,
}: VerticalDragDividerProps) {
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const clamp = (width: number) => Math.min(max, Math.max(min, width));
  const startDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
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
    const move = (pointerEvent: PointerEvent) => onChange(clamp(startWidth + startX - pointerEvent.clientX));

    cleanupRef.current?.();
    cleanupRef.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const adjustWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    onChange(clamp(value + (event.key === "ArrowLeft" ? 16 : -16)));
  };

  return (
    <div
      className={className}
      role="separator"
      aria-label={ariaLabel}
      aria-disabled={disabled}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      style={style}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={startDragging}
      onKeyDown={adjustWithKeyboard}
    />
  );
}
