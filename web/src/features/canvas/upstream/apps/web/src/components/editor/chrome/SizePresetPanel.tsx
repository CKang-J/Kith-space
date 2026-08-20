/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/chrome/SizePresetPanel.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useMemo, useState, type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  A4_PORTRAIT
} from '@recombyn-native/components/rcb/scene/document/sceneDocument';
import { cn } from '@recombyn-native/utils/classnames';

/** Frame / artboard size presets (toolbar dropdown + tabs). */
export type FramePresetCategory =
  | 'website'
  | 'mobile'
  | 'image'
  | 'poster'
  | 'custom'
  | 'ratio';

export type SizePresetCategory = Exclude<FramePresetCategory, 'ratio'> | 'auto';

export type FrameSizePreset = {
  key: string;
  label: string;
  category: FramePresetCategory;
  /** Fixed pixel size when set (canonical portrait / listed orientation). */
  width?: number;
  height?: number;
  /** Aspect ratio w/h when set (applied against current width) */
  ratio?: number;
  icon: 'square' | 'portrait' | 'tall' | 'landscape' | 'wide' | 'doc' | 'web' | 'phone' | 'tablet';
};

/** Category tabs — product categories + custom.
 * Order: 海报 → UI(移动) → 网站 → 自定义（智能为右侧开关；无 Image tab）
 */
export const FRAME_PRESET_TABS: { id: Exclude<SizePresetCategory, 'auto' | 'image'> }[] = [
  { id: 'poster' },
  { id: 'mobile' },
  { id: 'website' },
  { id: 'custom' },
];

export const FRAME_SIZE_PRESETS: FrameSizePreset[] = [
  // Website
  { key: 'web-1280', label: '1280 × 720', category: 'website', width: 1280, height: 720, icon: 'web' },
  { key: 'web-1366', label: '1366 × 768', category: 'website', width: 1366, height: 768, icon: 'web' },
  { key: 'web-1440', label: '1440 × 900', category: 'website', width: 1440, height: 900, icon: 'web' },
  { key: 'web-1600', label: '1600 × 900', category: 'website', width: 1600, height: 900, icon: 'web' },
  { key: 'web-1920', label: '1920 × 1080', category: 'website', width: 1920, height: 1080, icon: 'web' },
  { key: 'web-2560', label: '2560 × 1440', category: 'website', width: 2560, height: 1440, icon: 'web' },

  // Mobile app (phones + tablets)
  { key: 'iphone-14-pro-max', label: 'iPhone 14 Pro Max', category: 'mobile', width: 430, height: 932, icon: 'phone' },
  { key: 'iphone-14-pro', label: 'iPhone 14 Pro', category: 'mobile', width: 393, height: 852, icon: 'phone' },
  { key: 'iphone-14-plus', label: 'iPhone 14 Plus / 13 Pro Max', category: 'mobile', width: 428, height: 926, icon: 'phone' },
  { key: 'iphone-14', label: 'iPhone 14 / 13 / 12', category: 'mobile', width: 390, height: 844, icon: 'phone' },
  { key: 'iphone-13-mini', label: 'iPhone 13 mini', category: 'mobile', width: 375, height: 812, icon: 'phone' },
  { key: 'iphone-x', label: 'iPhone X / XS / 11 Pro', category: 'mobile', width: 375, height: 812, icon: 'phone' },
  { key: 'iphone-xr', label: 'iPhone XR / XS Max / 11', category: 'mobile', width: 414, height: 896, icon: 'phone' },
  { key: 'pixel-7-pro', label: 'Google Pixel 7 Pro / 6 Pro', category: 'mobile', width: 412, height: 892, icon: 'phone' },
  { key: 'pixel-7', label: 'Google Pixel 7 / 6 / 6a', category: 'mobile', width: 412, height: 915, icon: 'phone' },
  { key: 'galaxy-s10', label: 'Samsung Galaxy S10', category: 'mobile', width: 360, height: 760, icon: 'phone' },
  { key: 'ipad-pro-12', label: 'iPad Pro 12.9"', category: 'mobile', width: 1024, height: 1366, icon: 'tablet' },
  { key: 'ipad-pro-11', label: 'iPad Pro 11"', category: 'mobile', width: 834, height: 1194, icon: 'tablet' },
  { key: 'ipad-air', label: 'iPad Air', category: 'mobile', width: 820, height: 1180, icon: 'tablet' },
  { key: 'ipad-mini', label: 'iPad mini', category: 'mobile', width: 744, height: 1133, icon: 'tablet' },
  { key: 'surface-pro-8', label: 'Surface Pro 8', category: 'mobile', width: 1440, height: 960, icon: 'tablet' },

  // Image
  { key: 'img-1-1', label: '1:1', category: 'image', width: 1080, height: 1080, icon: 'square' },
  { key: 'img-4-3', label: '4:3', category: 'image', width: 1600, height: 1200, icon: 'landscape' },
  { key: 'img-3-4', label: '3:4', category: 'image', width: 1200, height: 1600, icon: 'portrait' },
  { key: 'img-16-9', label: '16:9', category: 'image', width: 1920, height: 1080, icon: 'wide' },
  { key: 'img-9-16', label: '9:16', category: 'image', width: 1080, height: 1920, icon: 'tall' },
  { key: 'img-3-2', label: '3:2', category: 'image', width: 1620, height: 1080, icon: 'landscape' },
  { key: 'img-2-3', label: '2:3', category: 'image', width: 1080, height: 1620, icon: 'portrait' },

  // Poster (print + common promo sizes)
  { key: 'poster-1080x1920', label: '竖版海报', category: 'poster', width: 1080, height: 1920, icon: 'tall' },
  { key: 'poster-1242x2208', label: '竖版海报 · 大', category: 'poster', width: 1242, height: 2208, icon: 'tall' },
  { key: 'poster-1920x1080', label: '横版海报', category: 'poster', width: 1920, height: 1080, icon: 'wide' },
  { key: 'a0', label: 'A0', category: 'poster', width: 3179, height: 4494, icon: 'doc' },
  { key: 'a1', label: 'A1', category: 'poster', width: 2245, height: 3179, icon: 'doc' },
  { key: 'a2', label: 'A2', category: 'poster', width: 1587, height: 2245, icon: 'doc' },
  { key: 'a3', label: 'A3', category: 'poster', width: 1123, height: 1588, icon: 'doc' },
  { key: 'a4', label: 'A4', category: 'poster', width: A4_PORTRAIT.width, height: A4_PORTRAIT.height, icon: 'doc' },
  { key: 'a5', label: 'A5', category: 'poster', width: 559, height: 794, icon: 'doc' },
  { key: 'a6', label: 'A6', category: 'poster', width: 397, height: 559, icon: 'doc' },
  { key: 'b4', label: 'B4', category: 'poster', width: 945, height: 1334, icon: 'doc' },
  { key: 'b5', label: 'B5', category: 'poster', width: 665, height: 945, icon: 'doc' },
  { key: 'letter', label: 'Letter', category: 'poster', width: 816, height: 1056, icon: 'doc' },
  { key: 'legal', label: 'Legal', category: 'poster', width: 816, height: 1344, icon: 'doc' },
  { key: 'tabloid', label: 'Tabloid', category: 'poster', width: 1056, height: 1632, icon: 'doc' },

  // Ratio (separate toolbar)
  { key: 'original', label: '自由', category: 'ratio', icon: 'square' },
  { key: '1:1', label: '1:1', category: 'ratio', ratio: 1, icon: 'square' },
  { key: '4:3', label: '4:3', category: 'ratio', ratio: 4 / 3, icon: 'landscape' },
  { key: '3:4', label: '3:4', category: 'ratio', ratio: 3 / 4, icon: 'portrait' },
  { key: '16:9', label: '16:9', category: 'ratio', ratio: 16 / 9, icon: 'wide' },
  { key: '9:16', label: '9:16', category: 'ratio', ratio: 9 / 16, icon: 'tall' },
];

/** Ratio presets live in a separate toolbar control (not in device tabs). */
export const FRAME_RATIO_PRESETS = FRAME_SIZE_PRESETS.filter((p) => p.category === 'ratio');

export function presetsByCategory(category: FramePresetCategory): FrameSizePreset[] {
  if (category === 'custom') return [];
  return FRAME_SIZE_PRESETS.filter((p) => p.category === category);
}

/** Swap width/height (portrait ↔ landscape). */
export function swapFrameOrientation(current: {
  width: number;
  height: number;
}): { width: number; height: number } {
  return {
    width: Math.max(40, Math.round(current.height)),
    height: Math.max(40, Math.round(current.width)),
  };
}

/**
 * Apply a size preset. Keeps the current landscape/portrait orientation when
 * the preset has a fixed size (so A4 + landscape toggle stays consistent).
 */
export function applyFramePreset(
  current: { width: number; height: number },
  preset: FrameSizePreset
): { width: number; height: number } {
  if (preset.width && preset.height) {
    const wantLandscape = current.width > current.height;
    const presetLandscape = preset.width > preset.height;
    if (wantLandscape !== presetLandscape) {
      return { width: preset.height, height: preset.width };
    }
    return { width: preset.width, height: preset.height };
  }
  if (preset.ratio && preset.ratio > 0) {
    const width = Math.max(40, Math.round(current.width));
    const height = Math.max(40, Math.round(width / preset.ratio));
    return { width, height };
  }
  return current;
}

export function matchFramePreset(
  width: number,
  height: number,
  preferredCategory?: FramePresetCategory
): string {
  let fallback = '';
  for (const p of FRAME_SIZE_PRESETS) {
    if (p.key === 'original') continue;
    let hit = false;
    if (p.width && p.height) {
      hit =
        (Math.abs(p.width - width) <= 1 && Math.abs(p.height - height) <= 1) ||
        (Math.abs(p.width - height) <= 1 && Math.abs(p.height - width) <= 1);
    } else if (p.ratio) {
      const r = width / Math.max(1, height);
      hit = Math.abs(r - p.ratio) < 0.02;
    }
    if (!hit) continue;
    if (preferredCategory && p.category === preferredCategory) return p.key;
    if (!fallback) fallback = p.key;
  }
  return fallback || 'custom';
}

export function findFramePreset(key: string): FrameSizePreset | undefined {
  return FRAME_SIZE_PRESETS.find((p) => p.key === key);
}

/** Normalize canvas size chip: `1440x900` | `auto` | `400xauto` | `autox600`. */
export function normalizeCanvasSizeChip(raw: unknown): string {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[×*]/g, 'x')
    .replace(/\s+/g, '');
  if (!s || s === 'auto') return 'auto';
  const m = s.match(/^(\d+|auto)x(\d+|auto)$/);
  if (!m) return s;
  const [, a, b] = m;
  if (a === 'auto' && b === 'auto') return 'auto';
  return `${a}x${b}`;
}

/** True when both sides are fixed pixels (client must not let LLM rewrite). */
export function isCanvasSizeFullyLocked(raw: unknown): boolean {
  const s = normalizeCanvasSizeChip(raw);
  return /^\d+x\d+$/.test(s);
}

/** True when chip is auto or one side is auto (LLM may confirm / fill). */
export function isCanvasSizeAutoHint(raw: unknown): boolean {
  const s = normalizeCanvasSizeChip(raw);
  if (s === 'auto') return true;
  return /^(?:\d+xauto|autox\d+)$/.test(s);
}

/** Chip label: `1440 × 900` | `Smart` | `400 × Smart`. */
export function formatCanvasSizeChipLabel(
  raw: unknown,
  t: (key: string) => string
): string {
  const s = normalizeCanvasSizeChip(raw);
  const auto = t('editor.frameToolbar.auto');
  if (s === 'auto') return auto;
  const m = s.match(/^(\d+|auto)x(\d+|auto)$/);
  if (!m) return String(raw || '');
  const left = m[1] === 'auto' ? auto : m[1];
  const right = m[2] === 'auto' ? auto : m[2];
  return `${left} × ${right}`;
}

/** Localized display label for a size/ratio preset. */
export function framePresetDisplayLabel(
  preset: Pick<FrameSizePreset, 'key' | 'label'>,
  t: (key: string) => string
): string {
  if (preset.key === 'original') return t('editor.frameToolbar.original');
  if (preset.key === 'custom') return t('editor.frameToolbar.custom');
  if (preset.key === 'auto') return t('editor.frameToolbar.auto');
  if (preset.key === 'poster-1080x1920') return t('editor.frameToolbar.posterPortrait');
  if (preset.key === 'poster-1242x2208') return t('editor.frameToolbar.posterPortraitLarge');
  if (preset.key === 'poster-1920x1080') return t('editor.frameToolbar.posterLandscape');
  return preset.label;
}

const TAB_I18N: Record<SizePresetCategory, string> = {
  auto: 'editor.frameToolbar.auto',
  website: 'editor.frameToolbar.tabWebsite',
  mobile: 'editor.frameToolbar.tabMobile',
  image: 'editor.frameToolbar.tabImage',
  poster: 'editor.frameToolbar.tabPoster',
  custom: 'editor.frameToolbar.tabCustom',
};

/**
 * Proportional frame outline. Optionally shrink/grow by area vs `relativeToMaxArea`
 * (e.g. A0 vs A6 within the paper tab).
 * `equalArea` keeps similar ink weight across extreme ratios (21:9 vs 1:1 vs 9:16).
 */
function SizeAspectGlyph({
  width,
  height,
  box = 20,
  relativeToMaxArea,
  equalArea = false,
  className,
}: {
  width: number;
  height: number;
  box?: number;
  relativeToMaxArea?: number;
  equalArea?: boolean;
  className?: string;
}) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const ar = w / h;
  const pad = 1.5;
  const inner = box - pad * 2;
  let gw: number;
  let gh: number;
  if (equalArea) {
    // Same visual mass inside the box; then fit so nothing clips.
    const area = inner * inner * 0.5;
    gw = Math.sqrt(area * ar);
    gh = Math.sqrt(area / ar);
    const fit = Math.min(1, inner / gw, inner / gh);
    gw *= fit;
    gh *= fit;
  } else if (ar >= 1) {
    gw = inner;
    gh = Math.max(3, inner / ar);
  } else {
    gh = inner;
    gw = Math.max(3, inner * ar);
  }
  if (relativeToMaxArea && relativeToMaxArea > 0) {
    const t = Math.sqrt((w * h) / relativeToMaxArea);
    const scale = 0.42 + 0.58 * Math.min(1, Math.max(0.15, t));
    gw *= scale;
    gh *= scale;
  }
  const x = (box - gw) / 2;
  const y = (box - gh) / 2;
  return (
    <svg
      width={box}
      height={box}
      viewBox={`0 0 ${box} ${box}`}
      className={cn('shrink-0 text-current', className)}
      aria-hidden
    >
      <rect
        x={x}
        y={y}
        width={gw}
        height={gh}
        rx={Math.min(2, Math.min(gw, gh) * 0.12)}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
      />
    </svg>
  );
}

type SizePresetPanelProps = {
  /** Highlight matching preset key (e.g. `iphone-14`). */
  activeKey?: string;
  /** Fallback when `activeKey` is empty — match by pixel size. */
  activeWidth?: number;
  activeHeight?: number;
  initialCategory?: SizePresetCategory;
  disabled?: boolean;
  className?: string;
  /** Called when user picks a fixed-size preset (or custom WxH). */
  onPick: (preset: FrameSizePreset, opts?: { keepOpen?: boolean }) => void;
};

function resolveTabForKey(key: string): SizePresetCategory {
  if (!key || key === 'custom' || key === 'auto') return 'custom';
  const cat = findFramePreset(key)?.category;
  // Image presets have no tab — open Custom with the current WxH.
  if (cat === 'image') return 'custom';
  if (cat && cat !== 'ratio') return cat;
  return 'website';
}

/** Prefer the tab for the current WxH / preset; scene hint is only a fallback. */
function resolveInitialSizeCategory(opts: {
  preferredMatchCategory?: SizePresetCategory;
  matchedKey: string;
  activeWidth?: number;
  activeHeight?: number;
  initialCategory?: SizePresetCategory;
}): SizePresetCategory {
  if (opts.matchedKey && opts.matchedKey !== 'custom' && opts.matchedKey !== 'auto') {
    return resolveTabForKey(opts.matchedKey);
  }
  if (opts.activeWidth && opts.activeHeight) return 'custom';
  if (opts.initialCategory && opts.initialCategory !== 'auto' && opts.initialCategory !== 'image') {
    return opts.initialCategory;
  }
  return resolveTabForKey(opts.matchedKey);
}

/**
 * Frame toolbar size presets — underline category tabs + device list + custom WxH.
 * Agent composer uses DesignCanvasSizeManual instead (no preset list).
 */
function SizePresetPanel({
  activeKey,
  activeWidth,
  activeHeight,
  initialCategory,
  disabled,
  className,
  onPick,
}: SizePresetPanelProps): ReactNode {
  const { t } = useTranslation();
  const preferredMatchCategory =
    initialCategory && initialCategory !== 'auto' && initialCategory !== 'custom'
      ? initialCategory
      : undefined;
  const matchedKey =
    activeKey ||
    (activeWidth && activeHeight
      ? matchFramePreset(activeWidth, activeHeight, preferredMatchCategory)
      : '');

  const resolvedInitial = resolveInitialSizeCategory({
    preferredMatchCategory,
    matchedKey,
    activeWidth,
    activeHeight,
    initialCategory,
  });

  const [tab, setTab] = useState<SizePresetCategory>(() =>
    resolvedInitial === 'auto' || resolvedInitial === 'image' ? 'poster' : resolvedInitial
  );
  const [customW, setCustomW] = useState(() =>
    activeWidth && activeWidth > 0 ? String(Math.round(activeWidth)) : ''
  );
  const [customH, setCustomH] = useState(() =>
    activeHeight && activeHeight > 0 ? String(Math.round(activeHeight)) : ''
  );

  useEffect(() => {
    const next =
      resolvedInitial === 'auto' || resolvedInitial === 'image' ? 'poster' : resolvedInitial;
    setTab(next);
  }, [resolvedInitial]);

  useEffect(() => {
    if (activeWidth && activeWidth > 0) setCustomW(String(Math.round(activeWidth)));
    if (activeHeight && activeHeight > 0) setCustomH(String(Math.round(activeHeight)));
  }, [activeWidth, activeHeight]);

  const browseTab: Exclude<SizePresetCategory, 'auto' | 'image'> =
    tab === 'auto' || tab === 'image' ? 'poster' : tab;

  const list = useMemo(
    () => (browseTab === 'custom' ? [] : presetsByCategory(browseTab)),
    [browseTab]
  );
  const maxArea = useMemo(() => {
    let max = 0;
    for (const p of list) {
      if (p.width && p.height) max = Math.max(max, p.width * p.height);
    }
    return max || 1;
  }, [list]);

  const applyCustom = () => {
    const wRaw = String(customW).trim();
    const hRaw = String(customH).trim();
    const wNum = wRaw ? Math.round(Number(wRaw)) : NaN;
    const hNum = hRaw ? Math.round(Number(hRaw)) : NaN;
    const hasW = Number.isFinite(wNum) && wNum >= 40;
    const hasH = Number.isFinite(hNum) && hNum >= 40;
    if (!hasW && !hasH) return;
    onPick({
      key: 'custom',
      label: t('editor.frameToolbar.custom'),
      category: 'custom',
      ...(hasW ? { width: wNum } : {}),
      ...(hasH ? { height: hNum } : {}),
      icon: 'square',
    });
  };

  return (
    <div
      className={cn(
        'inline-flex w-max max-w-[calc(100vw-24px)] flex-col',
        browseTab !== 'custom' && 'min-h-[280px]',
        className
      )}
    >
      <div className="flex shrink-0 items-end gap-1 px-1.5 pt-1">
        <div
          role="tablist"
          aria-label={t('editor.frameToolbar.sizePresets')}
          className="flex min-w-0 flex-1 flex-nowrap gap-x-0.5 overflow-x-hidden"
        >
          {FRAME_PRESET_TABS.map((item) => {
            const active = browseTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  setTab(item.id);
                }}
                className={cn(
                  'relative shrink-0 px-2 pb-2.5 pt-1.5 text-[12px] font-medium tracking-tight transition-colors disabled:opacity-40',
                  active
                    ? 'text-[var(--ink)]'
                    : 'text-[var(--ink)]/55 hover:text-[var(--ink)]'
                )}
              >
                {t(TAB_I18N[item.id])}
                {active ? (
                  <span
                    className="absolute inset-x-1.5 bottom-0 h-[2px] rounded-full bg-[var(--ink)]"
                    aria-hidden
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      <div
        role="listbox"
        className="min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden px-1.5 py-1.5"
        style={{ maxHeight: 'min(320px, 50vh)' }}
      >
        {browseTab === 'custom' ? (
          <div className="flex w-full flex-col gap-3 p-3">
            <div className="flex w-full items-end gap-2">
              <label className="flex w-[120px] shrink-0 flex-col gap-1">
                <span className="text-[11px] font-medium text-[var(--ink)]/65">
                  {t('editor.frameToolbar.width')}
                </span>
                <input
                  type="number"
                  min={40}
                  inputMode="numeric"
                  disabled={disabled}
                  value={customW}
                  onChange={(e) => setCustomW(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      applyCustom();
                    }
                  }}
                  className="h-9 w-[120px] rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 text-[13px] tabular-nums text-[var(--ink)] outline-none [appearance:textfield] focus:border-[var(--ink)]/30 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </label>
              <span className="mb-2 shrink-0 text-[13px] text-[var(--muted)]">×</span>
              <label className="flex w-[120px] shrink-0 flex-col gap-1">
                <span className="text-[11px] font-medium text-[var(--ink)]/65">
                  {t('editor.frameToolbar.height')}
                </span>
                <input
                  type="number"
                  min={40}
                  inputMode="numeric"
                  disabled={disabled}
                  value={customH}
                  onChange={(e) => setCustomH(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      applyCustom();
                    }
                  }}
                  className="h-9 w-[120px] rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 text-[13px] tabular-nums text-[var(--ink)] outline-none [appearance:textfield] focus:border-[var(--ink)]/30 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </label>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                applyCustom();
              }}
              className="h-9 w-full rounded-xl bg-[var(--ink)] text-[13px] font-medium text-[var(--surface)] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {t('editor.frameToolbar.apply')}
            </button>
          </div>
        ) : (
          list.map((p) => {
            const selected = matchedKey === p.key;
            const sizeHint = p.width && p.height ? `${p.width} x ${p.height}` : '';
            return (
              <button
                key={p.key}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={disabled || !p.width || !p.height}
                onClick={(e) => {
                  e.stopPropagation();
                  if (p.width && p.height) onPick(p);
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] font-medium tracking-tight transition-colors disabled:opacity-40',
                  selected
                    ? 'bg-[var(--accent-soft)] text-[var(--ink)]'
                    : 'text-[var(--ink)] hover:bg-[var(--canvas)]'
                )}
              >
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-[var(--ink)]/70">
                  {p.width && p.height ? (
                    <SizeAspectGlyph
                      width={p.width}
                      height={p.height}
                      box={20}
                      relativeToMaxArea={maxArea}
                    />
                  ) : null}
                </span>
                <span className="min-w-0 truncate whitespace-nowrap">
                  {framePresetDisplayLabel(p, t)}
                </span>
                {sizeHint ? (
                  <span className="shrink-0 text-[12px] font-medium tabular-nums text-[var(--ink)]/50">
                    {sizeHint}
                  </span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export default memo(SizePresetPanel);

const MemoizedSizeAspectGlyph = memo(SizeAspectGlyph);
export { MemoizedSizeAspectGlyph as SizeAspectGlyph };
