/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/panels/agent/ImageAspectRatioPicker.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useMemo, useState, type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineLink, HiOutlineLinkSlash, HiOutlineQuestionMarkCircle } from 'react-icons/hi2';
import { Icon } from '@recombyn-native/components/base/icon';
import Tooltip from '@recombyn-native/components/base/tooltip';
import {
  SizeAspectGlyph,
  isCanvasSizeAutoHint,
} from '@recombyn-native/components/editor/chrome/SizePresetPanel';
import type { ImageLimits } from '@recombyn-native/service/chat';
import { cn } from '@recombyn-native/utils/classnames';

/**
 * Image-gen ratio row: Smart + common landscape → square → portrait.
 * `smart` lets the model pick; pixel tables treat it as 1:1.
 */
export const IMAGE_ASPECT_RATIOS = [
  'smart',
  '21:9',
  '16:9',
  '3:2',
  '4:3',
  '1:1',
  '3:4',
  '2:3',
  '9:16',
] as const;

export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];

export const DEFAULT_IMAGE_ASPECT_RATIO: ImageAspectRatio = '1:1';

export const IMAGE_QUALITY_IDS = ['low', 'standard', 'high'] as const;

export type ImageQuality = (typeof IMAGE_QUALITY_IDS)[number];

export const DEFAULT_IMAGE_QUALITY: ImageQuality = 'standard';

export const IMAGE_RESOLUTIONS = [
  { id: '512', labelKey: 'agent.resolution512' as const },
  { id: '1K', labelKey: 'agent.resolution1k' as const },
  { id: '2K', labelKey: 'agent.resolution2k' as const },
  { id: '3K', labelKey: 'agent.resolution3k' as const },
  { id: '4K', labelKey: 'agent.resolution4k' as const },
] as const;

export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number]['id'];

export const DEFAULT_IMAGE_RESOLUTION: ImageResolution = '2K';

/** Client fallback when catalog has not yet returned imageLimits (Ark docs). */
const CLIENT_IMAGE_LIMIT_PRESETS: Record<string, ImageLimits> = {
  seedream_5_pro: {
    preset: 'seedream_5_pro',
    transport: 'doubao',
    min_pixels: 1280 * 720,
    max_pixels: Math.floor(2048 * 2048 * 1.1025),
    resolutions: ['1K', '2K'],
    default_resolution: '2K',
  },
  seedream_5_lite: {
    preset: 'seedream_5_lite',
    transport: 'doubao',
    min_pixels: 2560 * 1440,
    max_pixels: 4096 * 4096,
    resolutions: ['2K', '3K', '4K'],
    default_resolution: '2K',
  },
  seedream_4_5: {
    preset: 'seedream_4_5',
    transport: 'doubao',
    min_pixels: 2560 * 1440,
    max_pixels: 4096 * 4096,
    resolutions: ['2K', '4K'],
    default_resolution: '2K',
  },
  seedream_4_0: {
    preset: 'seedream_4_0',
    transport: 'doubao',
    min_pixels: 1280 * 720,
    max_pixels: 4096 * 4096,
    resolutions: ['1K', '2K', '4K'],
    default_resolution: '2K',
  },
};

export function inferImageLimitPreset(
  modelId?: string | null,
  apiModel?: string | null,
  provider?: string | null
): string | null {
  const blob = `${modelId || ''} ${apiModel || ''}`.toLowerCase();
  const prov = String(provider || '').toLowerCase();
  if (blob.includes('seedream-5-0-pro') || blob.includes('seedream_5_0_pro')) {
    return 'seedream_5_pro';
  }
  if (blob.includes('seedream-5-0-lite') || blob.includes('seedream_5_0_lite')) {
    return 'seedream_5_lite';
  }
  if (
    (blob.includes('seedream-5-0') || blob.includes('seedream_5_0')) &&
    !blob.includes('pro')
  ) {
    return 'seedream_5_lite';
  }
  if (blob.includes('seedream-4-5') || blob.includes('seedream_4_5')) {
    return 'seedream_4_5';
  }
  if (blob.includes('seedream-4-0') || blob.includes('seedream_4_0')) {
    return 'seedream_4_0';
  }
  if (prov === 'openrouter' || blob.startsWith('or-') || blob.includes('openrouter')) {
    if (blob.includes('gpt-image') || blob.includes('gpt_image')) {
      return 'openrouter_gpt_image';
    }
    if (blob.includes('gemini') || blob.includes('banana')) {
      return 'openrouter_gemini_image';
    }
    return 'openrouter_image';
  }
  return null;
}

const CLIENT_OPENROUTER_LIMIT_PRESETS: Record<string, ImageLimits> = {
  openrouter_image: {
    transport: 'openrouter',
    resolutions: ['512', '1K', '2K', '4K'],
    default_resolution: '2K',
  },
  openrouter_gemini_image: {
    transport: 'openrouter_chat',
    resolutions: ['1K', '2K', '4K'],
    default_resolution: '2K',
  },
  openrouter_gpt_image: {
    transport: 'openrouter',
    resolutions: ['1K', '2K', '4K'],
    default_resolution: '2K',
  },
};

function ensureOpenRouterTransport(
  limits: ImageLimits,
  modelId?: string | null,
  apiModel?: string | null,
  provider?: string | null
): ImageLimits {
  if (isOpenRouterTransport(limits)) return limits;
  const prov = String(provider || '').toLowerCase();
  const blob = `${modelId || ''} ${apiModel || ''}`.toLowerCase();
  if (!(prov === 'openrouter' || blob.startsWith('or-') || blob.includes('openrouter'))) {
    return limits;
  }
  const preset = inferImageLimitPreset(modelId, apiModel, provider);
  const transport =
    (preset && CLIENT_OPENROUTER_LIMIT_PRESETS[preset]?.transport) || 'openrouter';
  return { ...limits, transport };
}

export function modelImageLimits(m?: {
  id?: string;
  provider?: string | null;
  api_model?: string | null;
  apiModel?: string | null;
  imageLimits?: ImageLimits | null;
  image_limits?: ImageLimits | null;
} | null): ImageLimits | null {
  const fromApi = m?.imageLimits || m?.image_limits || null;
  const provider = m?.provider;
  const apiModel = m?.apiModel || m?.api_model;
  const preset = inferImageLimitPreset(m?.id, apiModel, provider);

  if (fromApi?.resolutions?.length) {
    return ensureOpenRouterTransport({ ...fromApi }, m?.id, apiModel, provider);
  }

  if (preset && CLIENT_IMAGE_LIMIT_PRESETS[preset]) {
    return ensureOpenRouterTransport(
      { ...CLIENT_IMAGE_LIMIT_PRESETS[preset], ...fromApi },
      m?.id,
      apiModel,
      provider
    );
  }
  if (preset && CLIENT_OPENROUTER_LIMIT_PRESETS[preset]) {
    return { ...CLIENT_OPENROUTER_LIMIT_PRESETS[preset], ...fromApi };
  }
  if (fromApi) {
    return ensureOpenRouterTransport({ ...fromApi }, m?.id, apiModel, provider);
  }
  return null;
}

/** Resolutions this model accepts (falls back to 1K/2K/4K). */
export function resolutionsForLimits(limits?: ImageLimits | null): string[] {
  const list = (limits?.resolutions || [])
    .map((x) => String(x || '').trim().toUpperCase())
    .filter(Boolean);
  if (list.length) return list;
  return ['1K', '2K', '4K'];
}

export function defaultResolutionForLimits(limits?: ImageLimits | null): string {
  const allowed = resolutionsForLimits(limits);
  const d = String(limits?.default_resolution || '').trim().toUpperCase();
  if (d && allowed.includes(d)) return d;
  if (allowed.includes('2K')) return '2K';
  return allowed[0] || DEFAULT_IMAGE_RESOLUTION;
}

export const IMAGE_COUNT_OPTIONS = [1, 2, 3, 4] as const;

export type ImageCount = (typeof IMAGE_COUNT_OPTIONS)[number];

export const DEFAULT_IMAGE_COUNT: ImageCount = 1;

/** Mirrors apps/api/services/llm/image.py size tables. */
const SIZE_1K: Record<string, string> = {
  '1:1': '1024x1024',
  '1:2': '768x1536',
  '2:1': '1536x768',
  '9:16': '720x1280',
  '16:9': '1280x720',
  '3:4': '864x1152',
  '4:3': '1152x864',
  '3:2': '1248x832',
  '2:3': '832x1248',
  '5:4': '1280x1024',
  '4:5': '1024x1280',
  '21:9': '1680x720',
  '9:21': '720x1680',
};

const SIZE_2K: Record<string, string> = {
  '1:1': '2048x2048',
  '4:3': '2304x1728',
  '3:4': '1728x2304',
  '16:9': '2560x1440',
  '9:16': '1440x2560',
  '3:2': '2496x1664',
  '2:3': '1664x2496',
  '21:9': '3024x1296',
  '9:21': '1296x3024',
  '5:4': '2304x1792',
  '4:5': '1792x2304',
  '1:2': '1440x2880',
  '2:1': '2880x1440',
};

const SIZE_4K: Record<string, string> = {
  '1:1': '4096x4096',
  '4:3': '4704x3520',
  '3:4': '3520x4704',
  '16:9': '5504x3040',
  '9:16': '3040x5504',
  '3:2': '4992x3328',
  '2:3': '3328x4992',
  '21:9': '6240x2656',
  '9:21': '2656x6240',
  '5:4': '4608x3584',
  '4:5': '3584x4608',
  '1:2': '2880x5760',
  '2:1': '5760x2880',
};

const SIZE_TABLES: Record<string, Record<string, string>> = {
  '1K': SIZE_1K,
  '2K': SIZE_2K,
  '4K': SIZE_4K,
};

const BASE_AREA: Record<string, number> = {
  '512': 512 * 512,
  '1K': 1024 * 1024,
  '2K': 2048 * 2048,
  '3K': 3072 * 3072,
  '4K': 4096 * 4096,
};

function roundDim(n: number) {
  return Math.max(16, Math.round(n / 16) * 16);
}

function isOpenRouterTransport(limits?: ImageLimits | null): boolean {
  const t = String(limits?.transport || '').toLowerCase();
  return t.startsWith('openrouter');
}

/** Compact total-pixel label for size-range tips (e.g. 0.92M, 16.8M). */
function formatPixelBudget(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    const s = m >= 10 ? m.toFixed(1) : m.toFixed(2);
    return `${s.replace(/\.?0+$/, '')}M`;
  }
  if (n >= 1000) return `${Math.round(n).toLocaleString()}`;
  return String(Math.round(n));
}

/** Keep custom WxH inside catalog min/max total pixels (Seedream). */
export function clampPixelSize(
  w: number,
  h: number,
  limits?: ImageLimits | null
): { w: number; h: number } {
  let nw = roundDim(w);
  let nh = roundDim(h);
  if (!(nw > 0 && nh > 0)) return { w: 16, h: 16 };
  if (isOpenRouterTransport(limits)) return { w: nw, h: nh };
  const minPx = limits?.min_pixels;
  const maxPx = limits?.max_pixels;
  let area = nw * nh;
  if (typeof minPx === 'number' && minPx > 0 && area < minPx) {
    const scale = Math.sqrt(minPx / area);
    nw = roundDim(nw * scale);
    nh = roundDim(nh * scale);
    while (nw * nh < minPx) {
      if (nw <= nh) nw += 16;
      else nh += 16;
    }
    area = nw * nh;
  }
  if (typeof maxPx === 'number' && maxPx > 0 && area > maxPx) {
    const scale = Math.sqrt(maxPx / area);
    nw = roundDim(nw * scale);
    nh = roundDim(nh * scale);
    while (nw * nh > maxPx && (nw > 16 || nh > 16)) {
      if (nw >= nh && nw > 16) nw -= 16;
      else if (nh > 16) nh -= 16;
      else break;
    }
  }
  return { w: nw, h: nh };
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

/** Canonical `w:h` after reducing (1080×1920 → 9:16). */
function simplifiedAspectKey(w: number, h: number): string {
  if (!(w > 0 && h > 0)) return '';
  const g = gcd(w, h);
  return `${Math.round(w / g)}:${Math.round(h / g)}`;
}

/** Map custom WxH back to a named chip so resolution tiers can drive pixel size. */
function nearestNamedAspectRatio(aspectRatio: string): string {
  const parts = parseAspectParts(aspectRatio);
  if (!(parts.w > 0 && parts.h > 0)) return DEFAULT_IMAGE_ASPECT_RATIO;
  const key = simplifiedAspectKey(parts.w, parts.h);
  const named = IMAGE_ASPECT_RATIOS.filter((r) => r !== 'smart');
  for (const r of named) {
    const p = parseAspectParts(r);
    if (simplifiedAspectKey(p.w, p.h) === key) return r;
  }
  const target = parts.w / parts.h;
  let best: string = DEFAULT_IMAGE_ASPECT_RATIO;
  let bestDiff = Infinity;
  for (const r of named) {
    const p = parseAspectParts(r);
    const diff = Math.abs(p.w / p.h - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = r;
    }
  }
  return best;
}

function parseAspectParts(aspectRatio: string): { w: number; h: number } {
  const raw = String(aspectRatio || '1:1').trim();
  if (/^\d+x\d+$/i.test(raw)) {
    const [a, b] = raw.toLowerCase().split('x').map(Number);
    if (a > 0 && b > 0) return { w: a, h: b };
  }
  if (raw.includes(':')) {
    const [a, b] = raw.split(':').map(Number);
    if (a > 0 && b > 0) return { w: a, h: b };
  }
  return { w: 1, h: 1 };
}

function sizeFromArea(area: number, aspectRatio: string) {
  const { w: wr, h: hr } = parseAspectParts(aspectRatio);
  const ratio = wr / hr;
  const h = Math.sqrt(area / ratio);
  const w = h * ratio;
  return { w: roundDim(w), h: roundDim(h) };
}

/** Area of a catalog `WxH` cell, or 0 when missing/invalid. */
function areaFromSizeCell(cell: string | undefined): number {
  if (typeof cell !== 'string') return 0;
  const [a, b] = cell.split('x').map(Number);
  return a > 0 && b > 0 ? a * b : 0;
}

/** Resolve pixel size for a ratio + resolution (catalog tables when present). */
export function resolveImagePixelSize(
  aspectRatio: string,
  resolution: string,
  limits?: ImageLimits | null
): { w: number; h: number } {
  const raw = String(aspectRatio || '1:1').trim();
  if (raw === 'smart' || raw.toLowerCase() === 'auto') {
    return resolveImagePixelSize('1:1', resolution, limits);
  }
  if (/^\d+x\d+$/i.test(raw)) {
    const [a, b] = raw.toLowerCase().split('x').map(Number);
    if (a > 0 && b > 0) return clampPixelSize(a, b, limits);
  }
  const allowed = resolutionsForLimits(limits);
  let resKey = String(resolution || '').trim().toUpperCase();
  if (!allowed.includes(resKey)) {
    resKey = defaultResolutionForLimits(limits);
  }
  const catalogTable = limits?.size_tables?.[resKey];
  const table = catalogTable || SIZE_TABLES[resKey] || SIZE_TABLES['2K'];
  const hit = table?.[raw];
  if (hit) {
    const [a, b] = hit.split('x').map(Number);
    return clampPixelSize(a, b, limits);
  }
  const area =
    areaFromSizeCell(catalogTable?.['1:1']) || BASE_AREA[resKey] || BASE_AREA['2K'];
  const sized = sizeFromArea(area, raw);
  return clampPixelSize(sized.w, sized.h, limits);
}

/** Chip label uses colon: `2560:1440`. */
export function formatImageSizeLabel(
  aspectRatio: string,
  resolution: string,
  limits?: ImageLimits | null
) {
  const { w, h } = resolveImagePixelSize(aspectRatio, resolution, limits);
  return `${w}:${h}`;
}

/**
 * Visual glyph for a ratio key (`smart` / `3:2` / `1248x832`).
 * Equal-area fit so 21:9 / 1:1 / 9:16 read at similar visual weight.
 */
function AspectRatioGlyph({
  ratio,
  className,
  size = 18,
}: {
  ratio: string;
  className?: string;
  size?: number;
}) {
  const raw = String(ratio || '1:1').trim();
  if (raw === 'smart' || raw.toLowerCase() === 'auto' || /auto/i.test(raw)) {
    return (
      <Icon
        name="editor-aspect-smart"
        width={size}
        height={size}
        className={cn('shrink-0', className)}
      />
    );
  }
  const parts = parseAspectParts(raw);
  return (
    <SizeAspectGlyph
      width={parts.w}
      height={parts.h}
      box={size}
      equalArea
      className={className}
    />
  );
}

/** Whether the current value matches a preset ratio (by key, pixels, or reduced ratio). */
function isRatioActive(current: string, preset: string, resolution: string) {
  const curRaw = String(current || '').trim();
  const preRaw = String(preset || '').trim();
  if (!curRaw || !preRaw) return false;
  // `smart` only highlights the Smart chip — never 1:1 (pixel fallback is display-only).
  const curSmart = curRaw === 'smart' || curRaw.toLowerCase() === 'auto';
  const preSmart = preRaw === 'smart' || preRaw.toLowerCase() === 'auto';
  if (curSmart || preSmart) return curSmart && preSmart;
  if (curRaw === preRaw) return true;

  const cur = parseAspectParts(curRaw);
  const pre = parseAspectParts(preRaw);
  if (cur.w > 0 && cur.h > 0 && pre.w > 0 && pre.h > 0) {
    if (simplifiedAspectKey(cur.w, cur.h) === simplifiedAspectKey(pre.w, pre.h)) {
      return true;
    }
  }

  // Pixel chip from another resolution (e.g. 720x1280 vs 9:16 @ 2K table).
  if (/^\d+x\d+$/i.test(curRaw)) {
    const px = resolveImagePixelSize(preRaw, resolution);
    return px.w === cur.w && px.h === cur.h;
  }
  return false;
}

type Props = {
  /** design = agent canvas WxH; image = ratio / resolution / count / px. */
  variant?: 'design' | 'image';
  /** Kept for API callers; image UI no longer exposes quality. */
  quality?: string;
  /** Required for `variant="image"` pixel labels; unused for design size. */
  resolution?: string;
  aspectRatio: string;
  imageCount?: number;
  /** Current image model catalog limits — filters resolutions + clamps custom WxH. */
  imageLimits?: ImageLimits | null;
  onQualityChange?: (quality: string) => void;
  onResolutionChange?: (resolution: string) => void;
  onAspectRatioChange: (ratio: string, opts?: { keepOpen?: boolean }) => void;
  onImageCountChange?: (count: number) => void;
  disabled?: boolean;
  className?: string;
};

/** Pill track — light gray rail; selected cell is white with a soft shadow. */
function SegmentedTrack({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex rounded-xl bg-[var(--rail)] p-1', className)}>
      {children}
    </div>
  );
}

function SegmentPill({
  active,
  disabled,
  onClick,
  children,
  className,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'flex flex-1 items-center justify-center rounded-lg px-2 py-2 text-[12px] font-medium transition disabled:opacity-40',
        active
          ? 'bg-[var(--surface)] text-[var(--ink)] shadow-[0_1px_3px_rgba(15,23,42,0.12)]'
          : 'bg-transparent text-[var(--muted)] hover:text-[var(--ink)]',
        className
      )}
    >
      {children}
    </button>
  );
}

function DimField({
  label,
  value,
  disabled,
  onChange,
  onCommit,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (next: string) => void;
  onCommit: () => void;
}) {
  return (
    <label
      className={cn(
        'flex min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-[var(--rail)] px-2.5 py-2',
        disabled && 'opacity-40'
      )}
    >
      <span className="text-[12px] font-medium text-[var(--muted)]">{label}</span>
      <input
        type="number"
        min={16}
        inputMode="numeric"
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onCommit();
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-[13px] tabular-nums text-[var(--ink)] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </label>
  );
}

/** Image gen (ratio chips) / agent design canvas size (manual WxH). */
function ImageAspectRatioPicker({
  variant = 'image',
  resolution = DEFAULT_IMAGE_RESOLUTION,
  aspectRatio,
  imageCount = DEFAULT_IMAGE_COUNT,
  imageLimits = null,
  onResolutionChange,
  onAspectRatioChange,
  onImageCountChange,
  disabled,
  className,
}: Props): ReactNode {
  const { t } = useTranslation();

  const allowedResolutions = useMemo(
    () => resolutionsForLimits(imageLimits),
    [imageLimits]
  );
  const resolutionOptions = useMemo(() => {
    const byId = new Map<string, (typeof IMAGE_RESOLUTIONS)[number]>(
      IMAGE_RESOLUTIONS.map((r) => [r.id, r])
    );
    return allowedResolutions.map((id) => {
      const known = byId.get(id);
      return known
        ? { id: known.id, labelKey: known.labelKey }
        : { id, labelKey: null as null };
    });
  }, [allowedResolutions]);

  const openRouterLimits = isOpenRouterTransport(imageLimits);

  const limitsSignature = useMemo(
    () =>
      `${(imageLimits?.resolutions || []).join(',')}|${imageLimits?.default_resolution || ''}|${imageLimits?.min_pixels || ''}|${imageLimits?.transport || ''}`,
    [imageLimits]
  );

  // When model limits change: drop unsupported tiers and snap to that model's default.
  useEffect(() => {
    if (variant !== 'image') return;
    const cur = String(resolution || '').toUpperCase();
    const next = allowedResolutions.includes(cur)
      ? cur
      : defaultResolutionForLimits(imageLimits);
    if (next !== cur) {
      onResolutionChange?.(next);
    }
    // Custom WxH freezes pixel size across resolution tiers (esp. OpenRouter image_size).
    // Snap back to a named ratio so 1K/2K/4K can drive the preview again.
    if (/^\d+x\d+$/i.test(String(aspectRatio || ''))) {
      const named = nearestNamedAspectRatio(aspectRatio);
      if (named !== aspectRatio) onAspectRatioChange(named);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when catalog limits identity changes
  }, [variant, limitsSignature]);

  const pixels = useMemo(
    () => resolveImagePixelSize(aspectRatio, resolution, imageLimits),
    [aspectRatio, resolution, imageLimits]
  );

  const [draftW, setDraftW] = useState(String(pixels.w));
  const [draftH, setDraftH] = useState(String(pixels.h));
  const [sizeLinked, setSizeLinked] = useState(true);

  useEffect(() => {
    setDraftW(String(pixels.w));
    setDraftH(String(pixels.h));
  }, [pixels.w, pixels.h]);

  // Agent canvas size is Smart-by-default — no design size popover.
  if (variant === 'design') return null;

  const aspectParts = parseAspectParts(
    String(aspectRatio).trim() === 'smart' ? '1:1' : aspectRatio
  );
  const linkRatio = aspectParts.w / Math.max(1, aspectParts.h);
  const smartAspect =
    String(aspectRatio).trim() === 'smart' ||
    String(aspectRatio).trim().toLowerCase() === 'auto' ||
    isCanvasSizeAutoHint(aspectRatio);
  const sizeInputsDisabled = disabled || openRouterLimits || smartAspect;

  const commitDraftSize = (nextW: number, nextH: number) => {
    const clamped = clampPixelSize(nextW, nextH, imageLimits);
    setDraftW(String(clamped.w));
    setDraftH(String(clamped.h));
    if (clamped.w === pixels.w && clamped.h === pixels.h) return;
    // OpenRouter bills/sends image_size + aspect_ratio — never persist freeform WxH
    // or resolution chips appear stuck (pixels short-circuit ignore the tier).
    if (openRouterLimits) {
      onAspectRatioChange(nearestNamedAspectRatio(`${clamped.w}x${clamped.h}`));
      return;
    }
    onAspectRatioChange(`${clamped.w}x${clamped.h}`);
  };

  const onDraftWChange = (raw: string) => {
    setDraftW(raw);
    if (!sizeLinked) return;
    const w = Number(raw);
    if (!(w > 0)) return;
    setDraftH(String(roundDim(w / linkRatio)));
  };

  const onDraftHChange = (raw: string) => {
    setDraftH(raw);
    if (!sizeLinked) return;
    const h = Number(raw);
    if (!(h > 0)) return;
    setDraftW(String(roundDim(h * linkRatio)));
  };

  const onCommitDims = () => {
    const w = Number(draftW);
    const h = Number(draftH);
    if (!(w >= 16 && h >= 16)) {
      setDraftW(String(pixels.w));
      setDraftH(String(pixels.h));
      return;
    }
    commitDraftSize(w, h);
  };

  // Image generation settings — ratio chips.
  return (
    <div className={cn('space-y-4', className)}>
      <div>
        <p className="mb-2 text-[12px] font-medium text-[var(--muted)]">
          {t('agent.chooseRatio')}
        </p>
        <div className="flex items-start justify-between gap-0.5 rounded-xl bg-[var(--rail)] p-1">
          {IMAGE_ASPECT_RATIOS.map((ratio) => {
            const active =
              ratio === 'smart'
                ? String(aspectRatio).trim() === 'smart'
                : isRatioActive(aspectRatio, ratio, resolution);
            const label = ratio === 'smart' ? t('agent.ratioSmart') : ratio;
            return (
              <button
                key={ratio}
                type="button"
                disabled={disabled}
                title={label}
                onClick={(e) => {
                  e.stopPropagation();
                  onAspectRatioChange(ratio);
                }}
                className={cn(
                  'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-0.5 py-1.5 transition-colors disabled:opacity-40',
                  active
                    ? 'bg-[var(--surface)] text-[var(--ink)] shadow-[0_1px_3px_rgba(15,23,42,0.12)]'
                    : 'text-[var(--muted)] hover:text-[var(--ink)]'
                )}
              >
                <AspectRatioGlyph ratio={ratio} size={20} />
                <span className="max-w-full truncate text-[10px] font-medium tabular-nums">
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 text-[12px] font-medium text-[var(--muted)]">
          {t('agent.chooseResolution')}
        </p>
        <SegmentedTrack>
          {resolutionOptions.map((r) => (
            <SegmentPill
              key={r.id}
              active={String(resolution).toUpperCase() === r.id}
              disabled={disabled}
              onClick={() => {
                onResolutionChange?.(r.id);
                // Freeform WxH ignores resolution in resolveImagePixelSize — unlock tier.
                if (/^\d+x\d+$/i.test(String(aspectRatio || ''))) {
                  onAspectRatioChange(nearestNamedAspectRatio(aspectRatio));
                }
              }}
            >
              {r.labelKey ? t(r.labelKey) : r.id}
            </SegmentPill>
          ))}
        </SegmentedTrack>
        {imageLimits?.min_pixels && !openRouterLimits ? (
          <p className="mt-1.5 text-[11px] text-[var(--muted)]">
            {t('agent.imageSizeHint', {
              defaultValue: '自定义像素需满足模型总像素要求；过小会自动放大。',
            })}
          </p>
        ) : null}
        {openRouterLimits ? (
          <p className="mt-1.5 text-[11px] text-[var(--muted)]">
            {t('agent.openRouterResolutionHint', {
              defaultValue: 'OpenRouter 按分辨率档位（image_size）出图，下方像素为预览。',
            })}
          </p>
        ) : null}
      </div>

      {onImageCountChange ? (
        <div>
          <p className="mb-2 text-[12px] font-medium text-[var(--muted)]">
            {t('agent.chooseCount')}
          </p>
          <SegmentedTrack>
            {IMAGE_COUNT_OPTIONS.map((n) => (
              <SegmentPill
                key={n}
                active={imageCount === n}
                disabled={disabled}
                onClick={() => onImageCountChange(n)}
              >
                {n}
              </SegmentPill>
            ))}
          </SegmentedTrack>
        </div>
      ) : null}

      <div>
        <div className="mb-2 flex items-center gap-1 text-[12px] font-medium text-[var(--muted)]">
          <span>{t('agent.imageSize')}</span>
          {imageLimits?.min_pixels || imageLimits?.max_pixels ? (
            <Tooltip
              tip={t('agent.imageSizeRangeTip', {
                min: formatPixelBudget(Number(imageLimits.min_pixels) || 0),
                max: formatPixelBudget(Number(imageLimits.max_pixels) || 0),
              })}
              placement="top"
            >
              <button
                type="button"
                className="inline-flex h-4 w-4 items-center justify-center rounded text-[var(--muted)] transition hover:text-[var(--ink)]"
                aria-label={t('agent.imageSizeRangeTip', {
                  min: formatPixelBudget(Number(imageLimits.min_pixels) || 0),
                  max: formatPixelBudget(Number(imageLimits.max_pixels) || 0),
                })}
                onClick={(e) => e.stopPropagation()}
              >
                <HiOutlineQuestionMarkCircle className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </Tooltip>
          ) : null}
        </div>
        <div
          className={cn(
            'flex items-center gap-1.5',
            smartAspect && 'opacity-50'
          )}
        >
          <DimField
            label="W"
            value={draftW}
            disabled={sizeInputsDisabled}
            onChange={onDraftWChange}
            onCommit={onCommitDims}
          />
          <button
            type="button"
            disabled={sizeInputsDisabled}
            title={sizeLinked ? t('agent.sizeUnlock') : t('agent.sizeLock')}
            aria-pressed={sizeLinked}
            onClick={(e) => {
              e.stopPropagation();
              setSizeLinked((v) => !v);
            }}
            className={cn(
              'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--canvas)] hover:text-[var(--ink)] disabled:opacity-40',
              sizeLinked && 'text-[var(--ink)]'
            )}
          >
            {sizeLinked ? (
              <HiOutlineLink className="h-4 w-4" strokeWidth={2} />
            ) : (
              <HiOutlineLinkSlash className="h-4 w-4" strokeWidth={2} />
            )}
          </button>
          <DimField
            label="H"
            value={draftH}
            disabled={sizeInputsDisabled}
            onChange={onDraftHChange}
            onCommit={onCommitDims}
          />
          <span className="shrink-0 text-[12px] font-medium text-[var(--muted)]">PX</span>
        </div>
      </div>
    </div>
  );
}

export default memo(ImageAspectRatioPicker);

const MemoizedAspectRatioGlyph = memo(AspectRatioGlyph);
export { MemoizedAspectRatioGlyph as AspectRatioGlyph };
