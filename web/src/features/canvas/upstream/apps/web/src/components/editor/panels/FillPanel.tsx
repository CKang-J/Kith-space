/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/panels/FillPanel.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, memo } from 'react';
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
import {
  HiOutlineArrowsRightLeft,
  HiOutlineArrowPath,
  HiOutlineChevronDown,
  HiOutlinePhoto,
} from 'react-icons/hi2';
import {
  COLOR_PANEL_WIDTH,
  ColorPanel,
  FILL_SOLID_PRESETS,
  INPUT_NO_SPIN,
  hexToRgba,
  normalizeHex,
  rgbaToHex,
} from '@recombyn-native/components/base/colorPanel';
import Slider from '@recombyn-native/components/base/slider';
import Tooltip from '@recombyn-native/components/base/tooltip';
import { DropdownPanel, DropdownPanelItem, SegmentedControl, Icon } from '@recombyn-native/components/base';
import DiffuseMeshEditor from '@recombyn-native/components/editor/panels/DiffuseMeshEditor';
import { StylePanelShell } from '@recombyn-native/components/editor/panels/StylePanelChrome';
import { cn } from '@recombyn-native/utils/classnames';
import { meshPreviewDataUrl } from '@recombyn-native/components/rcb/scene/document/sceneDiffuseMesh';
import {
  buildImageAdjustFilterCss,
  cssPreviewForGradient,
  DEFAULT_FILL_IMAGE_ADJUST,
  defaultGradient,
  FILL_PANEL_TYPES,
  parseFillGradient,
  parseFillImageFit,
  parseFillType,
  serializeFillGradient,
  type FillGradient,
  type FillImageAdjust,
  type FillImageFit,
  type FillImageRotate,
  type FillStop,
  type FillType,
} from '@recombyn-native/components/rcb/scene/document/sceneFill';
export type FillPanelValue = {
  fillType: FillType;
  fillColor: string;
  fillOpacity: number;
  fillGradient?: string;
  fillImageSrc?: string;
  fillImageFit?: FillImageFit;
  fillImageRotate?: FillImageRotate;
  fillImageAdjust?: FillImageAdjust;
};

const IMAGE_FIT_OPTIONS: Array<{ value: FillImageFit; label: string }> = [
  { value: 'fill', label: '填充' },
  { value: 'fit', label: '适应' },
  { value: 'crop', label: '裁剪' },
  { value: 'tile', label: '平铺' },
];

const FILL_TYPE_TIP: Record<FillType, string> = {
  solid: '纯色',
  linear: '线性渐变',
  radial: '径向渐变',
  angular: '角度渐变',
  diffuse: '弥散渐变',
  image: '图片填充',
};

const IMAGE_ADJUST_ROWS: Array<{ key: keyof FillImageAdjust; label: string }> = [
  { key: 'exposure', label: '曝光' },
  { key: 'contrast', label: '对比度' },
  { key: 'saturation', label: '饱和度' },
  { key: 'temperature', label: '色温' },
  { key: 'tint', label: '色调' },
  { key: 'hue', label: '色相' },
  { key: 'highlights', label: '高光' },
  { key: 'shadows', label: '阴影' },
];

function resolveFillTypePatch(
  next: FillType,
  value: FillPanelValue,
  solid: string,
  gradient: FillGradient
): Partial<FillPanelValue> {
  switch (next) {
    case 'solid':
      return { fillType: 'solid', fillColor: solid };
    case 'image':
      return {
        fillType: 'image',
        fillColor: solid,
        fillImageSrc: value.fillImageSrc || '',
        fillImageFit: value.fillImageFit ?? 'fill',
        fillImageRotate: value.fillImageRotate ?? 0,
        fillImageAdjust: value.fillImageAdjust ?? DEFAULT_FILL_IMAGE_ADJUST,
      };
    default: {
      const g =
        parseFillType(value.fillType) === next
          ? gradient.type === next
            ? gradient
            : defaultGradient(next, solid)
          : defaultGradient(next, solid);
      g.type = next;
      return {
        fillType: next,
        fillColor: solid,
        fillGradient: serializeFillGradient(g),
      };
    }
  }
}

function clampAdjustInput(n: number) {
  return Math.max(-100, Math.min(100, Math.round(n) || 0));
}

function imagePreviewStyle(
  src: string | undefined,
  fit: FillImageFit,
  rotate: FillImageRotate,
  adjust: FillImageAdjust,
  opacity: number
): CSSProperties {
  const filter = buildImageAdjustFilterCss(adjust);
  const base: CSSProperties = {
    opacity: opacity / 100,
    ...(filter !== 'none' ? { filter } : {}),
    ...(rotate ? { transform: `rotate(${rotate}deg)` } : {}),
  };
  if (!src) return base;
  if (fit === 'tile') {
    return {
      ...base,
      backgroundImage: `url(${src})`,
      backgroundRepeat: 'repeat',
      backgroundSize: '33%',
      backgroundPosition: 'center',
    };
  }
  return {
    ...base,
    backgroundImage: `url(${src})`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center',
    backgroundSize: fit === 'fit' ? 'contain' : 'cover',
  };
}

function ImageAdjustRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-[11px] text-[var(--muted)]">{label}</span>
      <Slider
        className="min-w-0 flex-1"
        min={-100}
        max={100}
        step={1}
        value={value}
        fillFromZero
        onChange={onChange}
      />
      <input
        type="number"
        min={-100}
        max={100}
        value={value}
        onChange={(e) => onChange(clampAdjustInput(Number(e.target.value)))}
        className={cn(
          'h-7 w-11 shrink-0 rounded bg-[var(--accent-soft)] px-1 text-center text-[11px] text-[var(--ink)] outline-none',
          INPUT_NO_SPIN
        )}
      />
    </div>
  );
}

/** Compact fit dropdown — portals to body so FillPanel never clips it. */
function FitModeSelect({
  value,
  onChange,
}: {
  value: FillImageFit;
  onChange: (v: FillImageFit) => void;
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);
  const current = IMAGE_FIT_OPTIONS.find((o) => o.value === value) ?? IMAGE_FIT_OPTIONS[0];

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        className="inline-flex h-7 min-w-0 flex-1 items-center justify-between gap-1 rounded bg-[var(--accent-soft)] px-2 text-[12px] text-[var(--ink)] outline-none hover:bg-[var(--line)]"
        {...getReferenceProps({
          onClick: () => setOpen((v) => !v),
        })}
      >
        <span className="truncate">{current.label}</span>
        <HiOutlineChevronDown
          className={cn('h-3.5 w-3.5 shrink-0 text-[var(--muted)] transition-transform', open && 'rotate-180')}
        />
      </button>
      <FloatingPortal>
        {open ? (
          <div
            ref={refs.setFloating}
            data-select-dropdown
            style={floatingStyles}
            className="z-[220]"
            {...getFloatingProps()}
          >
            <DropdownPanel className="min-w-[112px]">
              {IMAGE_FIT_OPTIONS.map((opt) => {
                const active = opt.value === value;
                return (
                  <DropdownPanelItem
                    key={opt.value}
                    selected={active}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                  >
                    {opt.label}
                  </DropdownPanelItem>
                );
              })}
            </DropdownPanel>
          </div>
        ) : null}
      </FloatingPortal>
    </>
  );
}

function TypeIcon({ type, active }: { type: FillType; active?: boolean }) {
  const tone = active ? 'text-[var(--ink)]' : 'text-[var(--muted)]';
  const name =
    type === 'solid'
      ? 'editor-fill-solid'
      : type === 'linear'
        ? 'editor-fill-linear'
        : type === 'radial'
          ? 'editor-fill-radial'
          : type === 'angular'
            ? 'editor-fill-angular'
            : type === 'diffuse'
              ? 'editor-fill-diffuse'
              : type === 'image'
                ? 'editor-fill-image'
                : null;
  if (!name) return null;
  return <Icon name={name} width={18} height={18} className={tone} />;
}

const CHECKER =
  'linear-gradient(45deg, #d0d0d0 25%, transparent 25%), linear-gradient(-45deg, #d0d0d0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d0d0d0 75%), linear-gradient(-45deg, transparent 75%, #d0d0d0 75%)';

const MAX_GRADIENT_STOPS = 8;

function interpolateStopColor(stops: FillStop[], offset: number): string {
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  if (sorted.length === 0) return '#CCCCCC';
  if (offset <= sorted[0].offset) return normalizeHex(sorted[0].color, '#CCCCCC');
  if (offset >= sorted[sorted.length - 1].offset) {
    return normalizeHex(sorted[sorted.length - 1].color, '#CCCCCC');
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (offset < a.offset || offset > b.offset) continue;
    const span = b.offset - a.offset;
    const t = span === 0 ? 0 : (offset - a.offset) / span;
    const ca = hexToRgba(normalizeHex(a.color, '#CCCCCC'));
    const cb = hexToRgba(normalizeHex(b.color, '#CCCCCC'));
    const r = Math.round(ca.r + (cb.r - ca.r) * t);
    const g = Math.round(ca.g + (cb.g - ca.g) * t);
    const bl = Math.round(ca.b + (cb.b - ca.b) * t);
    return rgbaToHex({ r, g, b: bl, a: 1 });
  }
  return normalizeHex(sorted[0].color, '#CCCCCC');
}

function GradientStopsBar({
  gradient,
  activeStop,
  onActiveStopChange,
  onStopsChange,
}: {
  gradient: FillGradient;
  activeStop: number;
  onActiveStopChange: (index: number) => void;
  onStopsChange: (stops: FillStop[], activeIndex: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragIndexRef = useRef<number | null>(null);
  const stopsRef = useRef(gradient.colorStops);
  const onStopsChangeRef = useRef(onStopsChange);
  const activeStopRef = useRef(activeStop);

  stopsRef.current = gradient.colorStops;
  onStopsChangeRef.current = onStopsChange;
  activeStopRef.current = activeStop;

  const offsetFromClientX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const { left, width } = el.getBoundingClientRect();
    if (width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - left) / width));
  }, []);

  const deleteActiveStop = useCallback(() => {
    const stops = stopsRef.current;
    if (stops.length <= 2) return;
    const idx = Math.max(0, Math.min(activeStopRef.current, stops.length - 1));
    const next = stops.filter((_, i) => i !== idx);
    const nextActive = Math.min(idx, next.length - 1);
    onStopsChangeRef.current(next, nextActive);
    onActiveStopChange(nextActive);
  }, [onActiveStopChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (dragIndexRef.current != null) return;
      if (stopsRef.current.length <= 2) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      deleteActiveStop();
    };
    // Capture before canvas Delete handler removes the whole node.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [deleteActiveStop]);

  const handleStopPointerDown = (index: number) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragIndexRef.current = index;
    onActiveStopChange(index);

    const onMove = (ev: PointerEvent) => {
      const idx = dragIndexRef.current;
      if (idx == null) return;
      const offset = offsetFromClientX(ev.clientX);
      const stops = stopsRef.current.map((s, i) => (i === idx ? { ...s, offset } : s));
      const sorted = [...stops].sort((a, b) => a.offset - b.offset);
      const moved = stops[idx];
      const newIndex = sorted.indexOf(moved);
      dragIndexRef.current = newIndex;
      stopsRef.current = sorted;
      onStopsChangeRef.current(sorted, newIndex);
    };

    const onUp = () => {
      dragIndexRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleTrackPointerDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-stop-handle]')) return;
    if (gradient.colorStops.length >= MAX_GRADIENT_STOPS) return;
    const offset = offsetFromClientX(e.clientX);
    const color = interpolateStopColor(gradient.colorStops, offset);
    const stops = [...gradient.colorStops, { offset, color, opacity: 100 }].sort(
      (a, b) => a.offset - b.offset
    );
    const newIndex = stops.findIndex(
      (s) => Math.abs(s.offset - offset) < 0.0001 && s.color === color
    );
    onStopsChange(stops, newIndex >= 0 ? newIndex : stops.length - 1);
  };

  return (
    <Tooltip
      tip="选中色标后按 Delete 删除（至少保留 2 个）"
      placement="top"
      triggerClassName="min-w-0 flex-1"
    >
      <div
        ref={trackRef}
        role="presentation"
        tabIndex={0}
        className="relative h-7 min-w-0 w-full cursor-crosshair rounded outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3388ff]"
        style={{
          background: cssPreviewForGradient(gradient, 100),
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
        }}
        onPointerDown={handleTrackPointerDown}
      >
        {gradient.colorStops.map((s, i) => (
          <button
            key={`${s.offset}-${s.color}-${i}`}
            type="button"
            data-stop-handle
            aria-label={`${Math.round(s.offset * 100)}%`}
            onPointerDown={handleStopPointerDown(i)}
            onClick={(e) => {
              e.stopPropagation();
              onActiveStopChange(i);
            }}
            className={cn(
              'absolute top-1/2 z-[1] h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 bg-white shadow-sm active:cursor-grabbing',
              i === activeStop ? 'border-[#3388ff]' : 'border-white'
            )}
            style={{ left: `${s.offset * 100}%`, background: s.color }}
          />
        ))}
      </div>
    </Tooltip>
  );
}

export function fillPanelPreview(value: FillPanelValue): string {
  const t = value.fillType;
  if (t === 'solid') return normalizeHex(value.fillColor, '#FFFFFF');
  if (t === 'image') {
    return value.fillImageSrc
      ? `url(${value.fillImageSrc}) center / cover`
      : 'repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 0 0 / 8px 8px';
  }
  const g = parseFillGradient(
    value.fillGradient,
    t === 'linear' || t === 'radial' || t === 'angular' || t === 'diffuse' ? t : 'linear',
    value.fillColor
  );
  if (g.type === 'diffuse' && g.meshPoints?.length) {
    try {
      return `url(${meshPreviewDataUrl(g.meshPoints, 64)}) center / cover`;
    } catch {
      /* fall through */
    }
  }
  return cssPreviewForGradient(g, value.fillOpacity);
}

/** Full fill editor: solid / linear / radial / angular / image. */
function FillPanel({
  value,
  onChange,
  title = '颜色',
  onClose,
  className,
  meshSelectedIndex,
  onMeshSelectedIndexChange,
  meshShowGuides,
  onMeshShowGuidesChange,
  layerVisible = true,
  onLayerVisibleChange,
  activeStopIndex,
  onActiveStopIndexChange,
  onReset,
}: {
  value: FillPanelValue;
  onChange: (next: FillPanelValue) => void;
  title?: string;
  onClose?: () => void;
  className?: string;
  /** Sync mesh anchor selection with on-canvas handles. */
  meshSelectedIndex?: number;
  onMeshSelectedIndexChange?: (index: number) => void;
  meshShowGuides?: boolean;
  onMeshShowGuidesChange?: (show: boolean) => void;
  /** Show/hide fill on the canvas (eye control in panel header). */
  layerVisible?: boolean;
  onLayerVisibleChange?: (visible: boolean) => void;
  /** Sync gradient stop selection with on-canvas handles. */
  activeStopIndex?: number;
  onActiveStopIndexChange?: (index: number) => void;
  /** Optional header reset (e.g. canvas bg → clear saved color / follow theme). */
  onReset?: () => void;
}) {
  const fillType = parseFillType(value.fillType);
  const panelType = (FILL_PANEL_TYPES.includes(fillType) ? fillType : 'solid') as FillType;
  const solid = normalizeHex(value.fillColor || '#FFFFFF', '#FFFFFF');
  const gradient = useMemo(
    () =>
      parseFillGradient(
        value.fillGradient,
        panelType === 'solid' || panelType === 'image'
          ? 'linear'
          : (panelType as Exclude<FillType, 'solid' | 'image'>),
        solid
      ),
    [value.fillGradient, panelType, solid]
  );
  const [localActiveStop, setLocalActiveStop] = useState(0);
  const activeStop = activeStopIndex ?? localActiveStop;
  const setActiveStop = (index: number | ((prev: number) => number)) => {
    const next =
      typeof index === 'function'
        ? index(activeStopIndex ?? localActiveStop)
        : index;
    setLocalActiveStop(next);
    onActiveStopIndexChange?.(next);
  };
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setActiveStop((i) => Math.min(i, Math.max(0, gradient.colorStops.length - 1)));
  }, [gradient.colorStops.length]);

  useEffect(() => {
    if (activeStopIndex == null) return;
    setLocalActiveStop(activeStopIndex);
  }, [activeStopIndex]);

  const emit = useCallback(
    (patch: Partial<FillPanelValue>) => {
      onChange({ ...value, ...patch });
    },
    [onChange, value]
  );

  const setType = (next: FillType) => {
    emit(resolveFillTypePatch(next, value, solid, gradient));
  };

  const updateGradient = (g: FillGradient) => {
    emit({
      fillType: g.type,
      fillGradient: serializeFillGradient(g),
      fillColor: g.colorStops[0]?.color || g.meshPoints?.[0]?.color || solid,
    });
  };

  const updateStop = (index: number, patch: Partial<FillStop>) => {
    const stops = gradient.colorStops.map((s, i) => (i === index ? { ...s, ...patch } : s));
    updateGradient({ ...gradient, colorStops: stops });
  };

  const reverseStops = () => {
    const stops = [...gradient.colorStops]
      .map((s) => ({ ...s, offset: 1 - s.offset }))
      .sort((a, b) => a.offset - b.offset);
    updateGradient({ ...gradient, colorStops: stops });
  };

  const applyStops = (stops: FillStop[], activeIndex: number) => {
    updateGradient({ ...gradient, colorStops: stops });
    setActiveStop(activeIndex);
  };

  const onPickImage = (file: File | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      emit({
        fillType: 'image',
        fillImageSrc: String(reader.result || ''),
        fillColor: solid,
        fillImageFit: value.fillImageFit ?? 'fill',
        fillImageRotate: value.fillImageRotate ?? 0,
        fillImageAdjust: value.fillImageAdjust ?? DEFAULT_FILL_IMAGE_ADJUST,
      });
    };
    reader.readAsDataURL(file);
  };

  const stop = gradient.colorStops[activeStop] || gradient.colorStops[0];
  const isGradient =
    panelType === 'linear' || panelType === 'radial' || panelType === 'angular';
  const isDiffuse = panelType === 'diffuse';

  const imageFit = value.fillImageFit ?? 'fill';
  const imageRotate = value.fillImageRotate ?? 0;
  const imageAdjust = value.fillImageAdjust ?? DEFAULT_FILL_IMAGE_ADJUST;
  const imageOpacity = value.fillOpacity ?? 100;

  const cycleRotate = () => {
    const order: FillImageRotate[] = [0, 90, 180, 270];
    const idx = order.indexOf(imageRotate);
    const next = order[(idx + 1) % order.length];
    emit({ fillImageRotate: next });
  };

  const updateImageAdjust = (key: keyof FillImageAdjust, n: number) => {
    emit({
      fillImageAdjust: {
        ...imageAdjust,
        [key]: clampAdjustInput(n),
      },
    });
  };

  return (
    <StylePanelShell
      title={title}
      onClose={onClose}
      width={COLOR_PANEL_WIDTH}
      dataAttr="data-fill-panel"
      className={className}
      bodyClassName="max-h-[min(70vh,560px)] space-y-3 overflow-y-auto"
      layerVisible={layerVisible}
      onLayerVisibleChange={onLayerVisibleChange}
      layerVisibleTipShow="显示填充"
      layerVisibleTipHide="隐藏填充"
      headerActions={
        onReset ? (
          <Tooltip tip="恢复默认" placement="bottom">
            <button
              type="button"
              aria-label="恢复默认"
              onClick={onReset}
              className="inline-flex h-8 w-8 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
            >
              <HiOutlineArrowPath className="h-[18px] w-[18px]" />
            </button>
          </Tooltip>
        ) : null
      }
    >
        <SegmentedControl
          size="sm"
          fullWidth
          value={panelType}
          onChange={(next) => setType(next)}
          options={FILL_PANEL_TYPES.map((t) => ({
            value: t,
            title: FILL_TYPE_TIP[t],
            label: <TypeIcon type={t} active={panelType === t} />,
          }))}
        />

        {isGradient ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <GradientStopsBar
                gradient={gradient}
                activeStop={activeStop}
                onActiveStopChange={setActiveStop}
                onStopsChange={applyStops}
              />
              <Tooltip tip="反转" placement="top">
                <button
                  type="button"
                  aria-label="反转"
                  onClick={reverseStops}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
                >
                  <HiOutlineArrowsRightLeft className="h-4 w-4" />
                </button>
              </Tooltip>
            </div>
            <ColorPanel
              value={stop?.color || solid}
              onChange={(hex) => updateStop(activeStop, { color: hex })}
              opacity={stop?.opacity ?? 100}
              onOpacityChange={(opacity) => updateStop(activeStop, { opacity })}
              showAlpha
              title=""
              showHeader={false}
              padded={false}
              presets={FILL_SOLID_PRESETS}
              className="w-full !shadow-none !ring-0"
            />
          </div>
        ) : null}

        {isDiffuse ? (
          <DiffuseMeshEditor
            value={gradient.type === 'diffuse' ? gradient : defaultGradient('diffuse', solid)}
            baseColor={solid}
            onChange={updateGradient}
            selectedIndex={meshSelectedIndex}
            onSelectedIndexChange={onMeshSelectedIndexChange}
            showGuides={meshShowGuides}
            onShowGuidesChange={onMeshShowGuidesChange}
          />
        ) : null}

        {panelType === 'image' ? (
          <div className="space-y-2.5">
            <Tooltip
              tip={value.fillImageSrc ? '点击替换图片' : '点击上传图片'}
              placement="top"
              triggerClassName="w-full"
            >
            <button
              type="button"
              aria-label={value.fillImageSrc ? '点击替换图片' : '点击上传图片'}
              className="relative flex h-[72px] w-full cursor-pointer items-center justify-center overflow-hidden rounded"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)' }}
              onClick={() => fileRef.current?.click()}
            >
              <span
                aria-hidden
                className="absolute inset-0"
                style={{
                  backgroundImage: CHECKER,
                  backgroundSize: '8px 8px',
                  backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
                }}
              />
              <span
                className="absolute inset-0"
                style={imagePreviewStyle(
                  value.fillImageSrc,
                  imageFit,
                  imageRotate,
                  imageAdjust,
                  imageOpacity
                )}
              />
              {!value.fillImageSrc ? (
                <span className="relative z-[1] inline-flex flex-col items-center gap-1 text-[12px] text-[var(--muted)]">
                  <HiOutlinePhoto className="h-6 w-6" />
                  上传图片
                </span>
              ) : null}
            </button>
            </Tooltip>

            <div className="flex items-center gap-1.5">
              <FitModeSelect
                value={imageFit}
                onChange={(v) => emit({ fillImageFit: parseFillImageFit(v) })}
              />
              <label className="flex h-7 shrink-0 items-center gap-0.5 rounded bg-[var(--accent-soft)] px-1.5 text-[11px] text-[var(--muted)]">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round(imageOpacity)}
                  onChange={(e) =>
                    emit({
                      fillOpacity: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                    })
                  }
                  className={cn(
                    'h-full w-9 bg-transparent text-center text-[11px] text-[var(--ink)] outline-none',
                    INPUT_NO_SPIN
                  )}
                />
                %
              </label>
              <Tooltip tip="旋转 90°" placement="top">
                <button
                  type="button"
                  aria-label="旋转 90°"
                  onClick={cycleRotate}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[var(--accent-soft)] text-[var(--muted)] hover:text-[var(--ink)]"
                >
                  <HiOutlineArrowPath className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </div>

            <div className="space-y-1.5">
              {IMAGE_ADJUST_ROWS.map(({ key, label }) => (
                <ImageAdjustRow
                  key={key}
                  label={label}
                  value={imageAdjust[key]}
                  onChange={(n) => updateImageAdjust(key, n)}
                />
              ))}
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                onPickImage(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
          </div>
        ) : null}

        {!isGradient && !isDiffuse && panelType === 'solid' ? (
          <ColorPanel
            value={solid}
            onChange={(hex) => emit({ fillType: 'solid', fillColor: hex })}
            opacity={value.fillOpacity ?? 100}
            onOpacityChange={(opacity) => emit({ fillOpacity: opacity })}
            showAlpha
            title=""
            showHeader={false}
            padded={false}
            presets={FILL_SOLID_PRESETS}
            className="w-full !shadow-none !ring-0"
          />
        ) : null}
    </StylePanelShell>
  );
}

export type FillPanelPopoverProps = {
  value: FillPanelValue;
  onChange: (next: FillPanelValue) => void;
  title?: string;
  placement?: Placement;
  offset?: number;
  shiftMainAxis?: boolean;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode | ((ctx: { open: boolean; preview: string }) => ReactNode);
  floatingStyle?: CSSProperties;
  meshSelectedIndex?: number;
  onMeshSelectedIndexChange?: (index: number) => void;
  meshShowGuides?: boolean;
  onMeshShowGuidesChange?: (show: boolean) => void;
  onReset?: () => void;
};

/** Floating fill panel (type tabs + solid / gradients / image). */
function FillPanelPopover({
  value,
  onChange,
  title = '颜色',
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
  meshSelectedIndex,
  onMeshSelectedIndexChange,
  meshShowGuides,
  onMeshShowGuidesChange,
  onReset,
}: FillPanelPopoverProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setLocalOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange]
  );

  const preview = fillPanelPreview(value);

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
      ? children({ open, preview })
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
                backgroundImage:
                  'linear-gradient(45deg, #d0d0d0 25%, transparent 25%), linear-gradient(-45deg, #d0d0d0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d0d0d0 75%), linear-gradient(-45deg, transparent 75%, #d0d0d0 75%)',
                backgroundSize: '6px 6px',
                backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0',
              }}
            />
            <span className="absolute inset-0" style={{ background: preview }} />
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
            className="z-[120]"
            {...getFloatingProps()}
          >
            <FillPanel
              value={value}
              onChange={onChange}
              title={title}
              onClose={() => setOpen(false)}
              onReset={onReset}
              meshSelectedIndex={meshSelectedIndex}
              onMeshSelectedIndexChange={onMeshSelectedIndexChange}
              meshShowGuides={meshShowGuides}
              onMeshShowGuidesChange={onMeshShowGuidesChange}
            />
          </div>
        ) : null}
      </FloatingPortal>
    </>
  );
}

export default memo(FillPanel);
const MemoizedFillPanel = memo(FillPanel);
export { MemoizedFillPanel as FillPanel };
const MemoizedFillPanelPopover = memo(FillPanelPopover);
export { MemoizedFillPanelPopover as FillPanelPopover };
