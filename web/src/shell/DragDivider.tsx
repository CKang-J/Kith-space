import type { CSSProperties } from "react";
import { VerticalDragDivider } from "../components/VerticalDragDivider.tsx";

interface DragDividerProps {
  disabled?: boolean;
  value: number;
  min: number;
  max: number;
  style?: CSSProperties;
  onChange: (width: number) => void;
}

export function DragDivider({ disabled = false, value, min, max, style, onChange }: DragDividerProps) {
  return (
    <VerticalDragDivider
      className="shell-drag-divider"
      ariaLabel="调整模块区宽度"
      disabled={disabled}
      value={value}
      min={min}
      max={max}
      style={style}
      onChange={onChange}
    />
  );
}
