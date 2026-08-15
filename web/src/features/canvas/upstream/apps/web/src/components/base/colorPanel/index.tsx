/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/colorPanel/index.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode, memo } from 'react';
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  type Placement,
} from '@/features/canvas/adapters/recombynFloatingUi';
import { BiExit } from 'react-icons/bi';
import { HiOutlineEyeDropper } from 'react-icons/hi2';
import { AlphaSlider } from '@recombyn-native/components/base/colorPicker/AlphaSlider';
import { HueSlider } from '@recombyn-native/components/base/colorPicker/HueSlider';
import { SaturationValueArea } from '@recombyn-native/components/base/colorPicker/SaturationValueArea';
import Tooltip from '@recombyn-native/components/base/tooltip';
import { pickScreenColor } from './pickScreenColor';
import { cn } from '@recombyn-native/utils/classnames';

export type Rgba = { r: number; g: number; b: number; a: number };
export type Hsv = { h: number; s: number; v: number };

/** Two rows × 9 square swatches — shared by fill / stroke / artboard / canvas. */
export const FILL_SOLID_PRESETS = [
  '#FFFFFF',
  '#E5E5E5',
  '#A6A6A6',
  '#808080',
  '#383838',
  '#000000',
  '#FF5733',
  '#D43030',
  '#E33C64',
  '#FFEB3B',
  '#FFC300',
  '#FF8D1A',
  '#A5D63F',
  '#43CF7C',
  '#00BAAD',
  '#2A82E4',
  '#7948EA',
  '#AC33C1',
];

/** Same grid + transparent (artboard / alpha-capable pickers). */
export const FILL_ALPHA_PRESETS = ['transparent', ...FILL_SOLID_PRESETS];

/** Fixed panel width — same as opacity / eraser / font / blend popovers. */
export const COLOR_PANEL_WIDTH = 240;
/** Preset grid: 9 square swatches per row (2×9). */
export const COLOR_PANEL_PRESET_COLS = 9;
export const COLOR_PANEL_SWATCH_PX = 20;
export const COLOR_PANEL_SWATCH_GAP_PX = 4;
export const COLOR_PANEL_PAD_X_PX = 12; // p-3
export const COLOR_PANEL_CONTENT_WIDTH =
  COLOR_PANEL_PRESET_COLS * COLOR_PANEL_SWATCH_PX +
  (COLOR_PANEL_PRESET_COLS - 1) * COLOR_PANEL_SWATCH_GAP_PX;

const CHECKER = 'linear-gradient(45deg, #d0d0d0 25%, transparent 25%), linear-gradient(-45deg, #d0d0d0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d0d0d0 75%), linear-gradient(-45deg, transparent 75%, #d0d0d0 75%)';

export function hexToRgba(hex: string): Rgba {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return { r: 245, g: 245, b: 245, a: 1 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16), a: 1 };
}

export function rgbaToHex({ r, g, b }: Rgba) {
  return `#${[r, g, b]
    .map((n) => Math.round(n).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

export function normalizeHex(input: string, fallback = '#F5F5F5') {
  const raw = input.trim();
  if (raw === 'transparent') return 'transparent';
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return raw.toUpperCase();
  if (/^[0-9A-Fa-f]{6}$/.test(raw)) return `#${raw.toUpperCase()}`;
  return fallback;
}

export function rgbToHsv(rgb: Rgba): Hsv {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

export function hsvToRgb(hsv: Hsv): Rgba {
  const { h, s, v } = hsv;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255, a: 1 };
}

function clampOpacity(n: number) {
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function cssSolidWithOpacity(hex: string, opacityPct = 100): string {
  const raw = String(hex || '').trim();
  if (!raw || raw === 'transparent' || opacityPct <= 0) return 'transparent';
  const solid = normalizeHex(raw, '#FFFFFF');
  const a = Math.max(0, Math.min(100, opacityPct)) / 100;
  if (a >= 1) return solid;
  const { r, g, b } = hexToRgba(solid);
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
}

const INPUT_NO_SPIN =
  '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

export { INPUT_NO_SPIN };

export type ColorPanelProps = {
  value: string;
  onChange: (hex: string) => void;
  /** 0–100; shown when showAlpha is true. */
  opacity?: number;
  onOpacityChange?: (opacity: number) => void;
  /** Show transparency slider + % input. */
  showAlpha?: boolean;
  /** Panel title, e.g. 画布背景色 / 填充颜色 */
  title?: string;
  onClose?: () => void;
  presets?: string[];
  showHeader?: boolean;
  /** When false, omit content padding (for embedding in a shared box). */
  padded?: boolean;
  /** Mini swatch beside hue/alpha (default true). Use false when a side preview exists. */
  showColorPreview?: boolean;
  className?: string;
};

/**
 * Encapsulated color editor panel (SV pad + hue + optional alpha + presets + hex).
 */
function ColorPanel({
  value,
  onChange,
  opacity = 100,
  onOpacityChange,
  showAlpha = false,
  title = '颜色',
  onClose,
  presets,
  showHeader = true,
  padded = true,
  showColorPreview = true,
  className,
}: ColorPanelProps) {
  // One swatch set everywhere — artboard / fill / stroke stay visually identical.
  const presetList = presets ?? (showAlpha ? FILL_ALPHA_PRESETS : FILL_SOLID_PRESETS);
  const hex = normalizeHex(value, '#333333');
  const solidHex = hex === 'transparent' ? '#333333' : hex;
  const opacityPct = clampOpacity(opacity);
  const [hsv, setHsv] = useState(() => rgbToHsv(hexToRgba(solidHex)));
  const [draft, setDraft] = useState(solidHex.replace(/^#/, ''));
  const [opacityDraft, setOpacityDraft] = useState(String(opacityPct));

  useEffect(() => {
    setHsv(rgbToHsv(hexToRgba(solidHex)));
    setDraft(solidHex.replace(/^#/, ''));
  }, [solidHex]);

  useEffect(() => {
    setOpacityDraft(String(opacityPct));
  }, [opacityPct]);

  const rgb = hsvToRgb(hsv);

  const emit = useCallback(
    (next: Hsv) => {
      setHsv(next);
      const out = rgbaToHex(hsvToRgb(next));
      setDraft(out.replace(/^#/, ''));
      onChange(out);
    },
    [onChange]
  );

  const setOpacity = (next: number) => {
    const pct = clampOpacity(next);
    setOpacityDraft(String(pct));
    onOpacityChange?.(pct);
  };

  const fillWidth = Boolean(className && /\bw-full\b/.test(className));

  return (
    <div
      data-color-panel
      className={cn(
        // Same chrome as Fill/Stroke StylePanelShell (rounded-xl).
        'rounded-xl bg-[var(--surface)] shadow-[0_12px_40px_rgba(15,23,42,0.16)] ring-1 ring-[var(--line)]',
        className
      )}
      style={{ width: fillWidth ? '100%' : COLOR_PANEL_WIDTH }}
    >
      {showHeader ? (
        <div className="flex h-11 items-center justify-between px-3">
          <span className="text-[13px] font-medium text-[var(--ink)]">{title}</span>
          <div className="flex items-center gap-0.5">
            {onClose ? (
              <Tooltip tip={'退出'} placement="bottom">
                <button
                  type="button"
                  aria-label={'退出'}
                  onClick={onClose}
                  className="inline-flex h-8 w-8 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
                >
                  <BiExit className="h-[18px] w-[18px]" />
                </button>
              </Tooltip>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className={cn('space-y-3', padded && 'p-3')}>
        <SaturationValueArea hsv={hsv} onChange={(s, v) => emit({ ...hsv, s, v })} />

        {showAlpha ? (
          <div className="flex w-full flex-col gap-1.5">
            <HueSlider value={hsv.h} onChange={(h) => emit({ ...hsv, h })} />
            <AlphaSlider
              value={opacityPct / 100}
              color={{ r: rgb.r, g: rgb.g, b: rgb.b, a: opacityPct / 100 }}
              onChange={(a) => setOpacity(a * 100)}
            />
          </div>
        ) : (
          <HueSlider value={hsv.h} onChange={(h) => emit({ ...hsv, h })} />
        )}

        {presetList.length > 0 ? (
          <div
            className="grid w-full pt-0.5"
            style={{
              gridTemplateColumns: `repeat(${COLOR_PANEL_PRESET_COLS}, minmax(0, 1fr))`,
              gap: COLOR_PANEL_SWATCH_GAP_PX,
            }}
          >
            {presetList.map((c) => {
              const p = normalizeHex(c, c);
              const isTransparent = p === 'transparent';
              const active = isTransparent
                ? hex === 'transparent' || opacityPct === 0
                : hex === p && opacityPct > 0;
              return (
                <button
                  key={String(c)}
                  type="button"
                  aria-label={isTransparent ? '透明' : p}
                  onClick={() => {
                    if (isTransparent) {
                      onChange(solidHex);
                      setOpacity(0);
                      return;
                    }
                    onChange(p);
                    setHsv(rgbToHsv(hexToRgba(p)));
                    setDraft(p.replace(/^#/, ''));
                    if (showAlpha && opacityPct === 0) setOpacity(100);
                  }}
                  className={cn(
                    // Same radius as hex / opacity / eyedropper chips in this panel.
                    'aspect-square w-full rounded transition-opacity hover:opacity-90',
                    active && 'outline outline-2 outline-[var(--ink)] outline-offset-1'
                  )}
                  style={
                    isTransparent
                      ? {
                          backgroundImage: CHECKER,
                          backgroundSize: '5px 5px',
                          backgroundPosition: '0 0, 0 2.5px, 2.5px -2.5px, -2.5px 0',
                          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
                        }
                      : {
                          background: p,
                          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
                        }
                  }
                />
              );
            })}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Tooltip tip={'取色'} placement="top">
            <button
              type="button"
              aria-label={'取色'}
              onClick={() => {
                async function pickColor() {
                  const picked = await pickScreenColor();
                  if (!picked) return;
                  const next = normalizeHex(picked, solidHex);
                  onChange(next);
                  setHsv(rgbToHsv(hexToRgba(next)));
                  setDraft(next.replace(/^#/, ''));
                  if (showAlpha && opacityPct === 0) setOpacity(100);
                }
                void pickColor();
              }}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[var(--accent-soft)] text-[var(--muted)] hover:text-[var(--ink)]"
            >
              <HiOutlineEyeDropper className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <div className="flex h-7 min-w-0 flex-1 items-center rounded bg-[var(--accent-soft)] px-2.5">
            <span className="mr-1 text-[12px] text-[var(--muted)]">#</span>
            <input
              value={draft}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6);
                setDraft(raw);
                if (raw.length === 6) {
                  const next = `#${raw.toUpperCase()}`;
                  onChange(next);
                  setHsv(rgbToHsv(hexToRgba(next)));
                }
              }}
              className="w-full bg-transparent text-[13px] tracking-wider text-[var(--ink)] outline-none"
              spellCheck={false}
            />
          </div>
          {showAlpha ? (
            <div className="flex h-7 w-[64px] shrink-0 items-center rounded bg-[var(--accent-soft)] px-2">
              <input
                value={opacityDraft}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^\d]/g, '').slice(0, 3);
                  setOpacityDraft(raw);
                  if (raw === '') return;
                  setOpacity(Number(raw));
                }}
                onBlur={() => setOpacity(Number(opacityDraft) || 0)}
                className={cn(
                  'w-full bg-transparent text-center text-[13px] text-[var(--ink)] outline-none',
                  INPUT_NO_SPIN
                )}
                inputMode="numeric"
              />
              <span className="shrink-0 text-[11px] text-[var(--muted)]">%</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export type ColorPanelPopoverProps = {
  value: string;
  onChange: (hex: string) => void;
  opacity?: number;
  onOpacityChange?: (opacity: number) => void;
  showAlpha?: boolean;
  title?: string;
  presets?: string[];
  placement?: Placement;
  /** Gap between trigger and panel (px). @default 10 */
  offset?: number;
  /**
   * When false, skip shifting along the main axis so the panel stays clear of
   * the trigger (important for bottom-edge HUDs).
   * @default true
   */
  shiftMainAxis?: boolean;
  disabled?: boolean;
  className?: string;
  /** Extra classes on the default circular swatch trigger */
  triggerClassName?: string;
  /** Controlled open state */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Custom trigger; defaults to a circular swatch */
  children?: ReactNode | ((ctx: { open: boolean; hex: string; opacity: number }) => ReactNode);
  /** Optional style on the floating layer */
  floatingStyle?: CSSProperties;
};

/**
 * Floating portal wrapper around {@link ColorPanel}. Click outside to dismiss.
 */
function ColorPanelPopover({
  value,
  onChange,
  opacity = 100,
  onOpacityChange,
  showAlpha = false,
  title = '颜色',
  presets,
  placement = 'bottom-start',
  offset: offsetDistance = 10,
  shiftMainAxis = true,
  disabled = false,
  className,
  triggerClassName,
  open: controlledOpen,
  onOpenChange,
  children,
  floatingStyle,
}: ColorPanelPopoverProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setLocalOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange]
  );

  const hex = normalizeHex(value, '#333333');
  const opacityPct = clampOpacity(opacity);
  const swatchHex = hex === 'transparent' ? '#333333' : hex;

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(offsetDistance),
      flip({
        padding: 12,
        fallbackPlacements: ['top-start', 'top-end', 'right-start', 'left-start'],
      }),
      shift({ padding: 12, mainAxis: shiftMainAxis }),
    ],
  });
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

  const trigger =
    typeof children === 'function'
      ? children({ open, hex: swatchHex, opacity: opacityPct })
      : children ?? (
          <span
            className={cn(
              'relative inline-flex h-4 w-4 overflow-hidden rounded-full ring-1 ring-black/10',
              triggerClassName
            )}
          >
            <span
              aria-hidden
              className="absolute inset-0"
              style={{
                backgroundImage: CHECKER,
                backgroundSize: '6px 6px',
                backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0',
              }}
            />
            <span
              className="absolute inset-0"
              style={{
                background: swatchHex,
                opacity: showAlpha ? opacityPct / 100 : 1,
              }}
            />
          </span>
        );

  return (
    <>
      <Tooltip tip={title} placement="top" disabled={open || !title}>
        <button
          type="button"
          ref={refs.setReference}
          disabled={disabled}
          aria-label={title}
          aria-expanded={open}
          className={cn(
            'inline-flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-40',
            className
          )}
          {...getReferenceProps({
            onClick: () => {
              if (!disabled) setOpen(!open);
            },
          })}
        >
          {trigger}
        </button>
      </Tooltip>

      <FloatingPortal>
        {open ? (
          <div
            ref={refs.setFloating}
            style={{ ...floatingStyles, ...floatingStyle }}
            className="z-[80]"
            {...getFloatingProps()}
          >
            <ColorPanel
              value={swatchHex}
              onChange={onChange}
              opacity={opacityPct}
              onOpacityChange={onOpacityChange}
              showAlpha={showAlpha}
              title={title}
              presets={presets}
              onClose={() => setOpen(false)}
            />
          </div>
        ) : null}
      </FloatingPortal>
    </>
  );
}

export default memo(ColorPanel);
const MemoizedColorPanel = memo(ColorPanel);
export { MemoizedColorPanel as ColorPanel };
const MemoizedColorPanelPopover = memo(ColorPanelPopover);
export { MemoizedColorPanelPopover as ColorPanelPopover };
