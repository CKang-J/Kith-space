/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/chrome/EditorOnboardingTour.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  memo,
} from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { HiOutlineXMark } from 'react-icons/hi2';
import { cn } from '@recombyn-native/utils/classnames';

/** Bump when tour content/layout changes so returning users see the new flow. */
const STORAGE_PREFIX = 'recombyn-editor-tour-v3';

export type TourStepId = 'welcome' | 'tools' | 'done';

type Placement = 'center' | 'above' | 'left' | 'below' | 'right';

type StepDef = {
  id: TourStepId;
  /** Query `data-tour` attribute; null = center modal only. */
  target: string | null;
  /** `modal` = welcome surface card; `spotlight` = themed roaming popover. */
  variant: 'modal' | 'spotlight';
  placement: Placement;
};

const STEPS: StepDef[] = [
  { id: 'welcome', target: null, variant: 'modal', placement: 'center' },
  { id: 'tools', target: 'editor-tools', variant: 'spotlight', placement: 'above' },
  { id: 'done', target: 'editor-help', variant: 'spotlight', placement: 'above' },
];

const POPOVER_W = 300;
const POPOVER_GAP = 14;
const ARROW = 10;

function storageKey(userId?: string | null) {
  return userId ? `${STORAGE_PREFIX}:${userId}` : STORAGE_PREFIX;
}

export function hasCompletedEditorTour(userId?: string | null) {
  try {
    return localStorage.getItem(storageKey(userId)) === '1';
  } catch {
    return true;
  }
}

export function markEditorTourComplete(userId?: string | null) {
  try {
    localStorage.setItem(storageKey(userId), '1');
  } catch {
    /* ignore */
  }
}

export function clearEditorTourComplete(userId?: string | null) {
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    /* ignore */
  }
}

type Spot = { left: number; top: number; width: number; height: number };

type Props = {
  /** Start after boot overlay finishes. */
  ready: boolean;
  /** Force show (e.g. from help button), ignoring storage. */
  forceOpen?: boolean;
  onForceOpenConsumed?: () => void;
  /** Notify parent when the tour overlay is shown/hidden (home-agent auto-send waits). */
  onActiveChange?: (active: boolean) => void;
  className?: string;
};

function computePopoverStyle(
  spot: Spot | null,
  placement: Placement
): { left: number; top: number; transform?: string } {
  if (!spot || placement === 'center') {
    return {
      left: window.innerWidth / 2,
      top: window.innerHeight * 0.42,
      transform: 'translate(-50%, -50%)',
    };
  }

  const cx = spot.left + spot.width / 2;
  const cy = spot.top + spot.height / 2;
  const maxLeft = window.innerWidth - POPOVER_W - 16;

  if (placement === 'above') {
    return {
      left: Math.min(maxLeft, Math.max(16, cx - POPOVER_W / 2)),
      top: Math.max(16, spot.top - POPOVER_GAP),
      transform: 'translateY(-100%)',
    };
  }
  if (placement === 'below') {
    return {
      left: Math.min(maxLeft, Math.max(16, cx - POPOVER_W / 2)),
      top: Math.min(window.innerHeight - 16, spot.top + spot.height + POPOVER_GAP),
    };
  }
  if (placement === 'left') {
    return {
      left: Math.max(16, spot.left - POPOVER_GAP),
      top: Math.min(window.innerHeight - 200, Math.max(80, cy - 80)),
      transform: 'translateX(-100%)',
    };
  }
  // right
  return {
    left: Math.min(maxLeft, spot.left + spot.width + POPOVER_GAP),
    top: Math.min(window.innerHeight - 200, Math.max(80, cy - 80)),
  };
}

function Arrow({ placement }: { placement: Placement }) {
  if (placement === 'center') return null;
  const base = 'pointer-events-none absolute h-0 w-0 border-solid';
  // Match popover fill (`--accent`).
  const fill = 'var(--accent)';
  if (placement === 'above') {
    return (
      <span
        className={cn(base, 'left-1/2 top-full -translate-x-1/2')}
        style={{
          borderWidth: `${ARROW}px ${ARROW}px 0 ${ARROW}px`,
          borderColor: `${fill} transparent transparent transparent`,
        }}
        aria-hidden
      />
    );
  }
  if (placement === 'below') {
    return (
      <span
        className={cn(base, 'bottom-full left-1/2 -translate-x-1/2')}
        style={{
          borderWidth: `0 ${ARROW}px ${ARROW}px ${ARROW}px`,
          borderColor: `transparent transparent ${fill} transparent`,
        }}
        aria-hidden
      />
    );
  }
  if (placement === 'left') {
    return (
      <span
        className={cn(base, 'left-full top-10')}
        style={{
          borderWidth: `${ARROW}px 0 ${ARROW}px ${ARROW}px`,
          borderColor: `transparent transparent transparent ${fill}`,
        }}
        aria-hidden
      />
    );
  }
  return (
    <span
      className={cn(base, 'right-full top-10')}
      style={{
        borderWidth: `${ARROW}px ${ARROW}px ${ARROW}px 0`,
        borderColor: `transparent ${fill} transparent transparent`,
      }}
      aria-hidden
    />
  );
}

/**
 * Roaming product tour: welcome modal → spotlight popovers on tools / Agent / help.
 * Completion is stored per user in localStorage.
 */
function EditorOnboardingTour({
  ready,
  forceOpen = false,
  onForceOpenConsumed,
  onActiveChange,
  className,
}: Props) {
  const { t } = useTranslation();
  const userId = useSelector((s: any) => s.auth?.user?.id as string | undefined);
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<Spot | null>(null);

  const step = STEPS[index] || STEPS[0];
  const isSpotlight = step.variant === 'spotlight';
  const onForceOpenConsumedRef = useRef(onForceOpenConsumed);
  onForceOpenConsumedRef.current = onForceOpenConsumed;
  const onActiveChangeRef = useRef(onActiveChange);
  onActiveChangeRef.current = onActiveChange;

  useEffect(() => {
    onActiveChangeRef.current?.(active);
  }, [active]);

  useEffect(() => {
    if (!ready) return;
    if (forceOpen) {
      setIndex(0);
      setActive(true);
      onForceOpenConsumedRef.current?.();
      return;
    }
    if (!hasCompletedEditorTour(userId)) {
      setIndex(0);
      setActive(true);
    }
  }, [ready, forceOpen, userId]);

  const measure = useCallback(() => {
    if (!active || !step.target) {
      setSpot(null);
      return;
    }
    const el = document.querySelector(`[data-tour="${step.target}"]`) as HTMLElement | null;
    if (!el) {
      setSpot(null);
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) {
      setSpot(null);
      return;
    }
    const pad = 8;
    setSpot({
      left: Math.max(4, r.left - pad),
      top: Math.max(4, r.top - pad),
      width: Math.min(window.innerWidth - 8, r.width + pad * 2),
      height: Math.min(window.innerHeight - 8, r.height + pad * 2),
    });
  }, [active, step.target]);

  useLayoutEffect(() => {
    measure();
    if (!active) return;
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const id = window.setInterval(measure, 280);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      window.clearInterval(id);
    };
  }, [active, measure, step.id]);

  const finish = useCallback(() => {
    markEditorTourComplete(userId);
    setActive(false);
  }, [userId]);

  const next = () => {
    if (index >= STEPS.length - 1) {
      finish();
      return;
    }
    setIndex((i) => i + 1);
  };

  const title = t(`editor.tour.${step.id}.title`);
  const body = t(`editor.tour.${step.id}.body`);
  const progress = useMemo(() => `${index + 1} / ${STEPS.length}`, [index]);
  const cardStyle = useMemo(
    () => computePopoverStyle(spot, step.placement),
    [spot, step.placement]
  );

  if (!active) return null;

  return (
    <div className={cn('fixed inset-0 z-[700]', className)} role="dialog" aria-modal="true">
      {spot && isSpotlight ? (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-white/95 transition-all duration-300"
          style={{
            left: spot.left,
            top: spot.top,
            width: spot.width,
            height: spot.height,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.55)',
          }}
          aria-hidden
        />
      ) : (
        <div className="absolute inset-0 bg-[rgba(15,23,42,0.5)]" aria-hidden />
      )}

      {isSpotlight ? (
        <div
          className="pointer-events-auto absolute w-[min(300px,calc(100vw-32px))] rounded-xl bg-[var(--accent)] px-4 pb-3.5 pt-3 text-[var(--on-brand)] shadow-[0_16px_40px_rgba(12,12,13,0.28)]"
          style={cardStyle}
        >
          <Arrow placement={step.placement} />
          <div className="mb-2 flex items-start justify-between gap-2">
            <h2 className="min-w-0 text-[15px] font-semibold leading-snug tracking-tight">
              {title}
            </h2>
            <button
              type="button"
              aria-label={t('editor.tour.skip')}
              onClick={finish}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--on-brand)]/75 transition hover:bg-[var(--on-brand)]/12 hover:text-[var(--on-brand)]"
            >
              <HiOutlineXMark className="h-4 w-4" />
            </button>
          </div>
          <p className="text-[12px] leading-relaxed text-[var(--on-brand)]/85">{body}</p>
          <div className="mt-3.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5" aria-label={progress}>
              {STEPS.map((s, i) => (
                <span
                  key={s.id}
                  className={cn(
                    'h-1.5 rounded-full transition-all',
                    i === index ? 'w-4 bg-[var(--on-brand)]' : 'w-1.5 bg-[var(--on-brand)]/35'
                  )}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={next}
              className="rounded-lg bg-[var(--surface)] px-3 py-1.5 text-[12px] font-semibold text-[var(--ink)] shadow-sm ring-1 ring-[var(--line)] transition hover:bg-[var(--accent-soft)]"
            >
              {index >= STEPS.length - 1 ? t('editor.tour.finish') : t('editor.tour.next')}
            </button>
          </div>
        </div>
      ) : (
        <div
          className="pointer-events-auto absolute w-[min(340px,calc(100vw-32px))] overflow-hidden rounded-2xl bg-[var(--surface)] shadow-[0_20px_50px_rgba(12,12,13,0.28)] ring-1 ring-[var(--line)]"
          style={cardStyle}
        >
          <div className="flex items-start justify-between gap-2 px-4 pb-1 pt-3.5">
            <div className="min-w-0">
              <p className="text-[11px] font-medium tabular-nums text-[var(--muted)]">{progress}</p>
              <h2 className="mt-0.5 text-[15px] font-semibold tracking-tight text-[var(--ink)]">
                {title}
              </h2>
            </div>
            <button
              type="button"
              aria-label={t('editor.tour.skip')}
              onClick={finish}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
            >
              <HiOutlineXMark className="h-4 w-4" />
            </button>
          </div>
          <p className="px-4 pb-3 text-[12px] leading-relaxed text-[var(--muted)]">{body}</p>
          <div className="flex items-center justify-between gap-2 border-t border-[var(--line)] px-3 py-2.5">
            <button
              type="button"
              onClick={finish}
              className="rounded-lg px-2.5 py-1.5 text-[12px] text-[var(--muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
            >
              {t('editor.tour.skip')}
            </button>
            <button
              type="button"
              onClick={next}
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--on-brand)] transition hover:opacity-90"
            >
              {t('editor.tour.next')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(EditorOnboardingTour);
