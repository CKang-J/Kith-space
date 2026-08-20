import type { SVGProps } from "react";

interface PanelVisibilityIconProps extends SVGProps<SVGSVGElement> {
  open: boolean;
}

export function PanelVisibilityIcon({ open, ...props }: PanelVisibilityIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="3.5" y="4" width="17" height="16" rx="3" />
      <path d={open ? "M12 4v16" : "M8.5 4v16"} />
    </svg>
  );
}
