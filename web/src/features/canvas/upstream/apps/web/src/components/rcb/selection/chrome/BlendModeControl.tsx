/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/selection/chrome/BlendModeControl.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  memo,
} from 'react';
import { useTranslation } from 'react-i18next';
import { BiExit } from 'react-icons/bi';
import { HiOutlineArrowPath, HiOutlineCheck, HiOutlineChevronDown } from 'react-icons/hi2';
import { MdOutlineOpacity } from 'react-icons/md';
import { Dropdown } from '@recombyn-native/components/base';
import type { MenuItemType } from '@recombyn-native/components/base/dropdown';
import Slider from '@recombyn-native/components/base/slider';
import Tooltip from '@recombyn-native/components/base/tooltip';
import { cn } from '@recombyn-native/utils/classnames';
import { SEL_ICON_BTN_ACTIVE, SEL_TOOL_BTN } from './ToolbarValueSlider';

/** Layer blend modes (CSS mix-blend-mode). */
export type BlendModeId =
  | 'pass-through'
  | 'normal'
  | 'darken'
  | 'multiply'
  | 'color-burn'
  | 'lighten'
  | 'screen'
  | 'color-dodge'
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export type BlendModeOption = {
  id: BlendModeId;
  groupStart?: boolean;
};

export const BLEND_MODE_OPTIONS: BlendModeOption[] = [
  { id: 'pass-through' },
  { id: 'normal' },
  { id: 'darken', groupStart: true },
  { id: 'multiply' },
  { id: 'color-burn' },
  { id: 'lighten', groupStart: true },
  { id: 'screen' },
  { id: 'color-dodge' },
  { id: 'overlay', groupStart: true },
  { id: 'soft-light' },
  { id: 'hard-light' },
  { id: 'difference', groupStart: true },
  { id: 'exclusion' },
  { id: 'hue', groupStart: true },
  { id: 'saturation' },
  { id: 'color' },
  { id: 'luminosity' },
];

const BLEND_MODE_SET = new Set(BLEND_MODE_OPTIONS.map((o) => o.id));

export function parseBlendMode(raw: unknown, opts?: { allowPassThrough?: boolean }): BlendModeId {
  const s = String(raw || '').trim().toLowerCase();
  const normalized =
    s === 'passthrough' || s === 'pass_through' ? 'pass-through' : s;
  if (BLEND_MODE_SET.has(normalized as BlendModeId)) {
    const id = normalized as BlendModeId;
    if (id === 'pass-through' && !opts?.allowPassThrough) return 'normal';
    return id;
  }
  return 'normal';
}

export function blendModeLabel(id: BlendModeId): string {
  return id;
}

export function blendModeToCss(id: BlendModeId): string {
  if (id === 'pass-through') return '';
  return id;
}

export function parseLayerOpacity(raw: unknown, fallback = 1): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  if (n > 1) return Math.min(1, Math.max(0, n / 100));
  return Math.min(1, Math.max(0, n));
}

export function layerOpacityToPct(opacity01: number): number {
  return Math.round(Math.min(1, Math.max(0, opacity01)) * 100);
}

function clampOpacityPct(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Mini two-circle preview — monochrome so it matches the rest of the toolbar. */
function BlendModeIcon({ mode, className }: { mode: BlendModeId; className?: string }) {
  const cssMode: CSSProperties['mixBlendMode'] =
    mode === 'pass-through' ? 'normal' : (mode as CSSProperties['mixBlendMode']);
  return (
    <span
      className={cn(
        'relative inline-block h-3.5 w-3.5 shrink-0 overflow-hidden rounded-[2px] bg-[var(--canvas)] ring-1 ring-[var(--line)]',
        className
      )}
      style={{ isolation: 'isolate' }}
      aria-hidden
    >
      <span
        className="absolute left-0 top-0 h-[10px] w-[10px] rounded-full"
        style={{ background: '#737373' }}
      />
      <span
        className="absolute bottom-0 right-0 h-[10px] w-[10px] rounded-full"
        style={{ background: '#b0b0b0', mixBlendMode: cssMode }}
      />
    </span>
  );
}

const opacityPanelBtn =
  'inline-flex h-7 min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-xl px-2 text-[12px] font-medium leading-none transition-colors';

type Props = {
  blendMode?: unknown;
  opacity?: unknown;
  /** Pass-through is only meaningful for groups/frames. */
  allowPassThrough?: boolean;
  onBlendModeChange: (mode: BlendModeId) => void;
  onOpacityChange: (opacity01: number) => void;
  /**
   * When set (e.g. image selection), opacity opens a docked side panel and the
   * selection toolbar hides — same pattern as Eraser. Trigger shows label text.
   */
  onOpacityOpen?: () => void;
  /** Inserted between blend-mode dropdown and opacity (e.g. corner radius). */
  afterBlendSlot?: ReactNode;
  className?: string;
};

function BlendModeControl({
  blendMode,
  opacity,
  allowPassThrough = false,
  onBlendModeChange,
  onOpacityChange,
  onOpacityOpen,
  afterBlendSlot,
  className,
}: Props) {
  const { t } = useTranslation();
  const [blendOpen, setBlendOpen] = useState(false);
  const [opacityOpen, setOpacityOpen] = useState(false);
  const opacityRootRef = useRef<HTMLDivElement>(null);
  const baselinePctRef = useRef(100);
  const mode = parseBlendMode(blendMode, { allowPassThrough });
  const pct = layerOpacityToPct(parseLayerOpacity(opacity, 1));
  const opacityLabel = t('editor.imageToolbar.opacity');

  const labelOf = (id: BlendModeId) => t(`editor.blendMode.${id}`);

  const items: MenuItemType[] = useMemo(() => {
    const out: MenuItemType[] = [];
    for (const opt of BLEND_MODE_OPTIONS) {
      if (opt.id === 'pass-through' && !allowPassThrough) continue;
      if (opt.groupStart && out.length > 0) {
        out.push({ key: `div-${opt.id}`, type: 'divider', label: '' });
      }
      out.push({
        key: opt.id,
        label: (
          <span className="flex w-full items-center gap-2">
            <BlendModeIcon mode={opt.id} />
            <span className="min-w-0 flex-1 truncate">{labelOf(opt.id)}</span>
            {mode === opt.id ? (
              <HiOutlineCheck className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
            ) : (
              <span className="h-3.5 w-3.5 shrink-0" />
            )}
          </span>
        ),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t + mode drive labels
  }, [mode, t, allowPassThrough]);

  const applyPct = (nextPct: number) => {
    onOpacityChange(clampOpacityPct(nextPct) / 100);
  };

  const openOpacityPanel = () => {
    if (onOpacityOpen) {
      onOpacityOpen();
      return;
    }
    baselinePctRef.current = pct;
    setBlendOpen(false);
    setOpacityOpen(true);
  };

  const closeOpacityKeep = () => {
    setOpacityOpen(false);
  };

  const closeOpacityRevert = () => {
    applyPct(baselinePctRef.current);
    setOpacityOpen(false);
  };

  useEffect(() => {
    if (!opacityOpen || onOpacityOpen) return undefined;
    const onDown = (e: PointerEvent) => {
      if (opacityRootRef.current?.contains(e.target as Node)) return;
      setOpacityOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeOpacityRevert();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opacityOpen, onOpacityOpen]);

  return (
    <div className={cn('inline-flex h-8 items-center gap-0.5', className)}>
      <Dropdown
        trigger="click"
        open={blendOpen}
        onOpenChange={(next) => {
          setBlendOpen(next);
          if (next) setOpacityOpen(false);
        }}
        placement="bottom-start"
        offset={6}
        strategy="fixed"
        items={items}
        selectedKeys={[mode]}
        onClick={(key) => {
          if (key.startsWith('div-')) return;
          onBlendModeChange(parseBlendMode(key, { allowPassThrough }));
          setBlendOpen(false);
        }}
        popupClassName="min-w-[11rem] max-h-[min(70vh,22rem)] overflow-y-auto"
        floatingClassName="z-[80]"
        referenceClassName="inline-flex"
      >
        <button
          type="button"
          aria-label={t('editor.imageToolbar.blendMode')}
          aria-expanded={blendOpen}
          className={cn(
            'inline-flex h-8 max-w-[8.5rem] items-center gap-1.5 rounded-[4px] px-1.5 text-[12px] text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)]',
            blendOpen && 'bg-[var(--accent-soft)]'
          )}
        >
          <BlendModeIcon mode={mode} />
          <span className="min-w-0 truncate">{labelOf(mode)}</span>
          <HiOutlineChevronDown className="h-3.5 w-3.5 shrink-0 text-current" />
        </button>
      </Dropdown>
      {afterBlendSlot}
      <div ref={opacityRootRef} className="relative inline-flex">
        <button
          type="button"
          aria-label={opacityLabel}
          aria-expanded={onOpacityOpen ? undefined : opacityOpen}
          onClick={openOpacityPanel}
          className={cn(
            SEL_TOOL_BTN,
            'relative',
            !onOpacityOpen && opacityOpen && SEL_ICON_BTN_ACTIVE
          )}
        >
          <MdOutlineOpacity className="h-4 w-4" />
          <span>{opacityLabel}</span>
        </button>

        {!onOpacityOpen && opacityOpen ? (
          <div
            className="absolute left-1/2 top-[calc(100%+8px)] z-[80] w-[240px] -translate-x-1/2 overflow-hidden rounded-xl bg-[var(--surface)] text-left shadow-[0_8px_28px_rgba(15,23,42,0.14)] ring-1 ring-[var(--line)]"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation?.();
            }}
          >
            <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-3.5">
              <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight text-[var(--ink)]">
                {opacityLabel}
              </h3>
              <div className="flex shrink-0 items-center gap-1">
                <Tooltip tip={t('editor.imageToolbar.reset')} placement="top">
                  <button
                    type="button"
                    aria-label={t('editor.imageToolbar.reset')}
                    onClick={() => applyPct(100)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-xl text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
                  >
                    <HiOutlineArrowPath className="h-4 w-4" />
                  </button>
                </Tooltip>
                <Tooltip tip={t('common.cancel')} placement="top">
                  <button
                    type="button"
                    aria-label={t('common.cancel')}
                    onClick={closeOpacityRevert}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-xl text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
                  >
                    <BiExit className="h-[18px] w-[18px]" />
                  </button>
                </Tooltip>
              </div>
            </div>

            <div className="flex flex-col items-stretch gap-3 px-4 py-3">
              <Slider
                min={0}
                max={100}
                step={1}
                value={pct}
                onChange={applyPct}
                trackHeight={6}
                thumbWidth={16}
                thumbHeight={16}
              />
            </div>

            <div className="flex flex-nowrap items-center gap-1.5 px-4 pb-2.5 pt-0.5">
              <button
                type="button"
                className={cn(
                  opacityPanelBtn,
                  'border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--accent-soft)]'
                )}
                onClick={closeOpacityRevert}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className={cn(
                  opacityPanelBtn,
                  'bg-[var(--ink)] text-[var(--on-brand)] hover:opacity-90'
                )}
                onClick={closeOpacityKeep}
              >
                {t('editor.imageToolbar.useNow')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default memo(BlendModeControl);
