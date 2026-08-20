/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/segmented/index.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, memo } from 'react';
import Tooltip from '@recombyn-native/components/base/tooltip';
import { cn } from '@recombyn-native/utils/classnames';

export type SegmentedOption<T extends string = string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  /** Tooltip on the chip */
  title?: string;
  /** Small unread / attention dot */
  badge?: boolean;
};

/** Default soft rect (panels); `full` = pill (home category tabs). */
export type SegmentedRadius = 'xl' | 'full';

export type SegmentedControlProps<T extends string = string> = {
  /** Option ids — `NoInfer` so T is driven by `value` / `onChange`, not widened option literals. */
  options: SegmentedOption<NoInfer<T>>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** sm = tighter horizontal padding; md = default */
  size?: 'xs' | 'sm' | 'md';
  /** Stretch segments evenly across the track width. */
  fullWidth?: boolean;
  /**
   * Track + chip corner radius.
   * - `xl` (default): soft rectangle for editor / account panels
   * - `full`: pill ends for home hero categories
   */
  radius?: SegmentedRadius;
  'aria-label'?: string;
};

const TRACK_RADIUS: Record<SegmentedRadius, string> = {
  /** Soft rect — fill type / stroke icon tracks. */
  xl: 'rounded-md',
  full: 'rounded-full',
};

const CHIP_RADIUS: Record<SegmentedRadius, string> = {
  xl: 'rounded-[4px]',
  full: 'rounded-full',
};

/** Shared track chrome without radius — pair with `segmentedTrackClass`. */
export const SEGMENTED_TRACK_BASE =
  'relative inline-flex items-center bg-[var(--accent-soft)]';

/** Equal inset around chips (same on all sides). */
const TRACK_PAD: Record<'xs' | 'sm' | 'md', string> = {
  xs: 'p-[2px]',
  sm: 'p-[3px]',
  md: 'p-[3px]',
};

/** @deprecated Prefer `segmentedTrackClass('xl')` — kept for StylePanelChrome default. */
export const SEGMENTED_TRACK = cn(SEGMENTED_TRACK_BASE, TRACK_RADIUS.xl, TRACK_PAD.md);

/** Shared chip chrome without radius. */
export const SEGMENTED_CHIP_BASE =
  'relative z-[1] flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-medium leading-none transition-colors duration-200 outline-none focus-visible:outline-none';

/** @deprecated Prefer `segmentedChipClass('xl')`. */
export const SEGMENTED_CHIP = cn(SEGMENTED_CHIP_BASE, CHIP_RADIUS.xl, 'h-7');

/** Active chip fill lives on the sliding thumb — keep text/shadow tokens here for callers. */
export const SEGMENTED_CHIP_ACTIVE = 'text-[var(--ink)]';
export const SEGMENTED_CHIP_IDLE = 'text-[var(--muted)] hover:text-[var(--ink)]';

export function segmentedTrackClass(radius: SegmentedRadius = 'xl'): string {
  return cn(SEGMENTED_TRACK_BASE, TRACK_RADIUS[radius]);
}

export function segmentedChipClass(radius: SegmentedRadius = 'xl'): string {
  return cn(SEGMENTED_CHIP_BASE, CHIP_RADIUS[radius]);
}

type ThumbBox = { left: number; top: number; width: number; height: number };

/**
 * Unified segmented tabs — notices / wallet / multi-angle / fill / adjust / home.
 * Active pill slides with a short transform transition.
 */
function SegmentedControlInner<const T extends string = string>({
  options,
  value,
  onChange,
  className,
  size = 'md',
  fullWidth = false,
  radius = 'xl',
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>): ReactNode {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const btnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [thumb, setThumb] = useState<ThumbBox | null>(null);
  const [thumbReady, setThumbReady] = useState(false);

  const measureThumb = useCallback(() => {
    const track = trackRef.current;
    const btn = btnRefs.current.get(String(value));
    if (!track || !btn) return;
    const tr = track.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    setThumb({
      left: br.left - tr.left,
      top: br.top - tr.top,
      width: br.width,
      height: br.height,
    });
  }, [value]);

  useLayoutEffect(() => {
    measureThumb();
    // Enable slide only after the first layout pass (avoid animating from 0,0).
    const id = window.requestAnimationFrame(() => setThumbReady(true));
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === 'undefined') {
      return () => window.cancelAnimationFrame(id);
    }
    const ro = new ResizeObserver(() => measureThumb());
    ro.observe(track);
    for (const btn of btnRefs.current.values()) ro.observe(btn);
    window.addEventListener('resize', measureThumb);
    return () => {
      window.cancelAnimationFrame(id);
      ro.disconnect();
      window.removeEventListener('resize', measureThumb);
    };
  }, [measureThumb, options]);

  return (
    <div
      ref={trackRef}
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        segmentedTrackClass(radius),
        TRACK_PAD[size],
        fullWidth && 'flex w-full',
        className
      )}
    >
      {thumb ? (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute left-0 top-0 z-0 bg-[var(--surface)] shadow-sm ring-1 ring-[var(--line)]',
            CHIP_RADIUS[radius],
            thumbReady &&
              'transition-[transform,width,height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'
          )}
          style={{
            width: thumb.width,
            height: thumb.height,
            transform: `translate(${thumb.left}px, ${thumb.top}px)`,
          }}
        />
      ) : null}

      {options.map((opt) => {
        const active = value === opt.value;
        const chip = (
          <button
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={opt.title}
            disabled={opt.disabled}
            ref={(el) => {
              const key = String(opt.value);
              if (el) btnRefs.current.set(key, el);
              else btnRefs.current.delete(key);
            }}
            onClick={() => {
              if (!opt.disabled && opt.value !== value) onChange(opt.value);
            }}
            className={cn(
              segmentedChipClass(radius),
              size === 'xs'
                ? 'h-[22px] px-2 text-[11px]'
                : size === 'sm'
                  ? 'h-7 px-1.5 text-[12px]'
                  : 'h-7 px-3 text-[12px]',
              fullWidth && 'w-full min-w-0',
              active ? SEGMENTED_CHIP_ACTIVE : SEGMENTED_CHIP_IDLE,
              opt.disabled && 'cursor-not-allowed opacity-50'
            )}
          >
            {opt.label}
            {opt.badge ? (
              <span
                className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#e5484d]"
                aria-hidden
              />
            ) : null}
          </button>
        );
        if (!opt.title) {
          return (
            <div key={opt.value} className={cn('inline-flex items-center', fullWidth && 'min-w-0 flex-1')}>
              {chip}
            </div>
          );
        }
        return (
          <Tooltip
            key={opt.value}
            tip={opt.title}
            placement="top"
            asChild
            triggerClassName={cn('inline-flex items-center', fullWidth && 'min-w-0 flex-1')}
          >
            {chip}
          </Tooltip>
        );
      })}
    </div>
  );
}

const SegmentedControlMemo = memo(SegmentedControlInner);

/**
 * Generic wrapper around the memoized control — `memo()` erases type params, so call sites
 * would otherwise see `onChange: (value: string) => void` and reject `setState` setters.
 */
export function SegmentedControl<const T extends string = string>(
  props: SegmentedControlProps<T>
): ReactNode {
  return <SegmentedControlMemo {...(props as SegmentedControlProps<string>)} />;
}

export default SegmentedControl;
