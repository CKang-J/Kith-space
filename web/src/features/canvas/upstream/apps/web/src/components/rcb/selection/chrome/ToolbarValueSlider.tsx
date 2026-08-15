/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/selection/chrome/ToolbarValueSlider.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useRef, useState, type ReactNode, memo } from 'react';
import Slider from '@recombyn-native/components/base/slider';
import Tooltip from '@recombyn-native/components/base/tooltip';
import { cn } from '@recombyn-native/utils/classnames';

/** Shared icon-button size for selection chrome (hover / selected bg must match). */
export const SEL_ICON_BTN =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-40';

export const SEL_ICON_BTN_ACTIVE = 'bg-[var(--accent-soft)]';

export const SEL_TOOL_BTN =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[4px] px-2 text-[12px] text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-40';

/** W/H number fields — centered digits; focus = bottom underline only (no layout shift / side borders). */
export const SEL_SIZE_INPUT =
  'w-11 border-0 bg-transparent text-center text-[12px] tabular-nums outline-none ring-0 shadow-[inset_0_-1px_0_0_transparent] focus:border-0 focus:outline-none focus:ring-0 focus:shadow-[inset_0_-1px_0_0_var(--ink)]';

type Props = {
  /** Shown before the number, e.g. "R" */
  prefix?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  title?: string;
  className?: string;
  /** Extra label in the popover header */
  panelLabel?: ReactNode;
};

/**
 * Compact toolbar control: click label → floating slider (not a dropdown list).
 */
function ToolbarValueSlider({
  prefix,
  value,
  min = 0,
  max = 64,
  step = 1,
  onChange,
  title,
  className,
  panelLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const safe = Number.isFinite(value) ? Math.round(value) : min;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const trigger = (
    <button
      type="button"
      aria-label={title}
      onClick={() => setOpen((v) => !v)}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-[12px] tabular-nums text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)]',
        open && SEL_ICON_BTN_ACTIVE,
        className
      )}
    >
      {prefix ? <span className="text-[var(--muted)]">{prefix}</span> : null}
      <span>{safe}</span>
    </button>
  );

  return (
    <div ref={rootRef} className="relative inline-flex">
      {title ? (
        <Tooltip tip={title} placement="top">
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}

      {open ? (
        <div
          className="absolute left-1/2 top-[calc(100%+8px)] z-[80] w-[168px] -translate-x-1/2 rounded-[4px] bg-[var(--surface)] px-3 py-2.5 shadow-[0_8px_28px_rgba(15,23,42,0.16)] ring-1 ring-[var(--line)]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between text-[11px] text-[var(--muted)]">
            <span>{panelLabel ?? prefix ?? 'Value'}</span>
            <span className="tabular-nums text-[var(--ink)]">{safe}</span>
          </div>
          <Slider
            min={min}
            max={max}
            step={step}
            value={Math.min(max, Math.max(min, safe))}
            onChange={onChange}
          />
        </div>
      ) : null}
    </div>
  );
}

export default memo(ToolbarValueSlider);
