/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/panels/DevPropertiesPanel.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { getRecombynIslandRoot } from '@/features/canvas/adapters/recombynFloatingUi';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, memo } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { LuPanelRight } from 'react-icons/lu';
import { HiOutlineChevronDown, HiOutlineClipboardDocument } from 'react-icons/hi2';
import { message } from '@recombyn-native/components/base';
import Dropdown from '@recombyn-native/components/base/dropdown';
import type { MenuItemType } from '@recombyn-native/components/base/dropdown/MenuItem';
import Tooltip from '@recombyn-native/components/base/tooltip';
import { ExportSelectionPanel } from '@recombyn-native/components/editor/panels/ExportSelectionPanel';
import { EMPTY_ID_LIST } from '@recombyn-native/store/modules/editor';
import { cn } from '@recombyn-native/utils/classnames';
import { radiiFromAttrs } from '@recombyn-native/components/rcb/scene/document/sceneRadii';
import {
  resolveFillColor,
  resolveShadow,
  resolveStroke,
} from '@recombyn-native/components/rcb/scene/document/sceneEffects';
import {
  isExportableSceneNode,
  isVideoNode
} from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';
import { nodeLeftTop } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';

function formatPx(n: number) {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r);
}

type Rgba = { r: number; g: number; b: number; a: number };

type ColorFormat = 'rgb' | 'rgba' | 'argb' | 'hex' | 'hexa' | 'ahex' | 'hsl' | 'hwb';
type CodeTarget = 'css' | 'ios' | 'android';

const COLOR_FORMATS: ColorFormat[] = [
  'rgb',
  'rgba',
  'argb',
  'hex',
  'hexa',
  'ahex',
  'hsl',
  'hwb',
];
const CODE_TARGETS: CodeTarget[] = ['css', 'ios', 'android'];

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

function clampByte(n: number) {
  return Math.min(255, Math.max(0, Math.round(n)));
}

function parseRgba(color: string): Rgba {
  const c = (color || '').trim();
  if (!c || c === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const rgbMatch = c.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i
  );
  if (rgbMatch) {
    return {
      r: clampByte(Number(rgbMatch[1])),
      g: clampByte(Number(rgbMatch[2])),
      b: clampByte(Number(rgbMatch[3])),
      a: rgbMatch[4] == null ? 1 : clamp01(Number(rgbMatch[4])),
    };
  }

  const hex = c.replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
      a: 1,
    };
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1,
    };
  }
  if (/^[0-9a-f]{8}$/i.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: clamp01(parseInt(hex.slice(6, 8), 16) / 255),
    };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

function toHex2(n: number) {
  return clampByte(n).toString(16).padStart(2, '0').toUpperCase();
}

function rgbToHsl(r: number, g: number, b: number) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function rgbToHwb(r: number, g: number, b: number) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const { h } = rgbToHsl(r, g, b);
  return { h, w: min, b: 1 - max };
}

function formatAlpha(a: number) {
  const r = Math.round(a * 1000) / 1000;
  return Number.isInteger(r) ? String(r) : String(r);
}

function formatColor(color: string, format: ColorFormat): string {
  const { r, g, b, a } = parseRgba(color);
  const aa = clampByte(a * 255);
  switch (format) {
    case 'rgb':
      return `rgb(${r}, ${g}, ${b})`;
    case 'rgba':
      return `rgba(${r}, ${g}, ${b}, ${formatAlpha(a)})`;
    case 'argb':
      return `#${toHex2(aa)}${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
    case 'hex':
      return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
    case 'hexa':
      return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}${toHex2(aa)}`;
    case 'ahex':
      return `#${toHex2(aa)}${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
    case 'hsl': {
      const { h, s, l } = rgbToHsl(r, g, b);
      return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
    }
    case 'hwb': {
      const { h, w, b: bl } = rgbToHwb(r, g, b);
      return `hwb(${Math.round(h)} ${Math.round(w * 100)}% ${Math.round(bl * 100)}%)`;
    }
    default:
      return `rgba(${r}, ${g}, ${b}, ${formatAlpha(a)})`;
  }
}

function colorLabel(format: ColorFormat): string {
  return format.toUpperCase();
}

function codeTargetLabel(target: CodeTarget): string {
  if (target === 'ios') return 'iOS';
  if (target === 'android') return 'Android';
  return 'CSS';
}

function iosUiColor(color: string): string {
  const { r, g, b, a } = parseRgba(color);
  const f = (n: number) => formatAlpha(n / 255);
  return `UIColor(red: ${f(r)}, green: ${f(g)}, blue: ${f(b)}, alpha: ${formatAlpha(a)})`;
}

function androidColor(color: string): string {
  return formatColor(color, 'argb');
}

function buildCodeSnippet(
  target: CodeTarget,
  colorFormat: ColorFormat,
  opts: {
    left: number;
    top: number;
    width: number;
    height: number;
    opacity: number;
    radius: number;
    fill: string;
    stroke: string;
    strokeWidth: number;
    shadow: ReturnType<typeof resolveShadow>;
  }
): string {
  const hasFill =
    opts.fill && opts.fill !== 'rgba(0,0,0,0)' && opts.fill !== 'transparent';
  const hasStroke =
    opts.strokeWidth > 0 && opts.stroke && opts.stroke !== 'transparent';

  if (target === 'ios') {
    const lines = [
      `frame: CGRect(x: ${formatPx(opts.left)}, y: ${formatPx(opts.top)}, width: ${formatPx(opts.width)}, height: ${formatPx(opts.height)})`,
      `opacity: ${formatAlpha(opts.opacity)}`,
    ];
    if (opts.radius > 0) lines.push(`cornerRadius: ${formatPx(opts.radius)}`);
    if (hasFill) lines.push(`backgroundColor: ${iosUiColor(opts.fill)}`);
    if (hasStroke) {
      lines.push(`borderWidth: ${formatPx(opts.strokeWidth)}`);
      lines.push(`borderColor: ${iosUiColor(opts.stroke)}`);
    }
    if (opts.shadow) {
      lines.push(`shadowOffset: CGSize(width: ${formatPx(opts.shadow.offsetX)}, height: ${formatPx(opts.shadow.offsetY)})`);
      lines.push(`shadowRadius: ${formatPx(opts.shadow.blur)}`);
      lines.push(`shadowColor: ${iosUiColor(opts.shadow.color)}`);
    }
    return lines.join('\n');
  }

  if (target === 'android') {
    const lines = [
      `android:layout_width="${formatPx(opts.width)}dp"`,
      `android:layout_height="${formatPx(opts.height)}dp"`,
      `android:translationX="${formatPx(opts.left)}dp"`,
      `android:translationY="${formatPx(opts.top)}dp"`,
      `android:alpha="${formatAlpha(opts.opacity)}"`,
    ];
    if (hasFill) lines.push(`android:background="${androidColor(opts.fill)}"`);
    if (opts.radius > 0) {
      lines.push(`app:cardCornerRadius="${formatPx(opts.radius)}dp"`);
    }
    if (hasStroke) {
      lines.push(`android:strokeWidth="${formatPx(opts.strokeWidth)}dp"`);
      lines.push(`android:strokeColor="${androidColor(opts.stroke)}"`);
    }
    return lines.join('\n');
  }

  const lines = [
    `left: ${formatPx(opts.left)}px;`,
    `top: ${formatPx(opts.top)}px;`,
    `width: ${formatPx(opts.width)}px;`,
    `height: ${formatPx(opts.height)}px;`,
    `opacity: ${formatAlpha(opts.opacity)};`,
  ];
  if (opts.radius > 0) lines.push(`border-radius: ${formatPx(opts.radius)}px;`);
  if (hasFill) lines.push(`background: ${formatColor(opts.fill, colorFormat)};`);
  if (hasStroke) {
    lines.push(
      `border: ${formatPx(opts.strokeWidth)}px solid ${formatColor(opts.stroke, colorFormat)};`
    );
  }
  if (opts.shadow) {
    lines.push(
      `box-shadow: ${formatPx(opts.shadow.offsetX)}px ${formatPx(opts.shadow.offsetY)}px ${formatPx(opts.shadow.blur)}px ${formatColor(opts.shadow.color, colorFormat)};`
    );
  }
  return lines.join('\n');
}

function ColorSwatch({ color }: { color: string }) {
  const display = formatColor(color, 'rgba');
  const isClear = parseRgba(color).a <= 0;
  return (
    <span
      className="inline-block h-4 w-4 shrink-0 rounded-sm ring-1 ring-[var(--line)]"
      style={{
        background: isClear
          ? 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 8px 8px'
          : display,
      }}
      title={display}
    />
  );
}

function InspectMenuTrigger({
  label,
  open,
}: {
  label: string;
  open?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-0.5 rounded px-1.5 text-[11px] font-medium',
        'bg-[var(--accent-soft)] text-[var(--ink)] transition',
        open && 'ring-1 ring-[var(--line)]'
      )}
    >
      <span className="min-w-[2.25rem] text-left">{label}</span>
      <HiOutlineChevronDown className="h-3 w-3 shrink-0 opacity-70" />
    </span>
  );
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-[var(--line)] px-3 py-3">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-medium text-[var(--ink)]">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-md bg-[var(--accent-soft)] px-2 py-1.5">
      <span className="text-[11px] font-medium text-[var(--muted)]">{label}</span>
      <span className="min-w-0 truncate text-[12px] tabular-nums text-[var(--ink)]">{value}</span>
    </div>
  );
}

const INSPECT_DOCK_WIDTH_KEY = 'inspect-dock-width';
const INSPECT_DOCK_MIN_W = 260;
const INSPECT_DOCK_MAX_W = 560;
const INSPECT_DOCK_DEFAULT_W = 300;

function clampInspectDockWidth(width: number): number {
  const viewportCap =
    typeof window !== 'undefined'
      ? Math.max(INSPECT_DOCK_MIN_W, window.innerWidth - 360)
      : INSPECT_DOCK_MAX_W;
  return Math.min(
    INSPECT_DOCK_MAX_W,
    viewportCap,
    Math.max(INSPECT_DOCK_MIN_W, Math.round(width))
  );
}

/** Current inspect dock width (for offsetting overlapping chrome). */
export function getInspectDockWidth(): number {
  try {
    const raw = localStorage.getItem(INSPECT_DOCK_WIDTH_KEY);
    if (!raw) return INSPECT_DOCK_DEFAULT_W;
    const n = Number(raw);
    if (!Number.isFinite(n)) return INSPECT_DOCK_DEFAULT_W;
    return clampInspectDockWidth(n);
  } catch {
    return INSPECT_DOCK_DEFAULT_W;
  }
}

function readStoredInspectDockWidth(): number {
  return getInspectDockWidth();
}

/** Dev-mode inspect panel: geometry, style, CSS, export (replaces chat). */
function DevPropertiesPanel({
  className,
  onClose,
  /** Share preview: false when link is view-only (same gate as top-bar Export). */
  allowExport = true,
}: {
  className?: string;
  onClose?: () => void;
  allowExport?: boolean;
}) {
  const { t } = useTranslation();
  const document = useSelector((s: any) => s.editor.document);
  const selectedNodeIds = useSelector(
    (s: any) => (s.editor.selectedNodeIds as string[]) ?? EMPTY_ID_LIST
  );
  const hoverNodeId = useSelector((s: any) => s.editor.devHoverNodeId as string | null);
  const nodeId =
    hoverNodeId || (selectedNodeIds.length === 1 ? selectedNodeIds[0] : null);
  const node = nodeId ? document?.deltaSetLike?.[nodeId] : null;
  const canExportNode = Boolean(allowExport && nodeId && isExportableSceneNode(node));
  const isVideo = isVideoNode(node);

  const [dockWidth, setDockWidth] = useState(INSPECT_DOCK_DEFAULT_W);
  const [colorFormat, setColorFormat] = useState<ColorFormat>('rgba');
  const [codeTarget, setCodeTarget] = useState<CodeTarget>('css');
  const resizeDragRef = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    setDockWidth(readStoredInspectDockWidth());
  }, []);

  useEffect(
    () => () => {
      getRecombynIslandRoot().style.cursor = '';
      getRecombynIslandRoot().style.userSelect = '';
    },
    []
  );

  const persistDockWidth = (width: number) => {
    const next = clampInspectDockWidth(width);
    setDockWidth(next);
    try {
      localStorage.setItem(INSPECT_DOCK_WIDTH_KEY, String(next));
    } catch {
      /* ignore */
    }
  };

  const onDockResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeDragRef.current = { startX: e.clientX, startW: dockWidth };
    getRecombynIslandRoot().style.cursor = 'col-resize';
    getRecombynIslandRoot().style.userSelect = 'none';
  };

  const onDockResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = resizeDragRef.current;
    if (!drag) return;
    setDockWidth(clampInspectDockWidth(drag.startW + (drag.startX - e.clientX)));
  };

  const endDockResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeDragRef.current) return;
    resizeDragRef.current = null;
    getRecombynIslandRoot().style.cursor = '';
    getRecombynIslandRoot().style.userSelect = '';
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setDockWidth((w) => {
      try {
        localStorage.setItem(INSPECT_DOCK_WIDTH_KEY, String(w));
      } catch {
        /* ignore */
      }
      return w;
    });
  };

  const model = useMemo(() => {
    if (!document || !node || !nodeId) return null;
    const { left, top } = nodeLeftTop(document, node);
    const width = Math.max(0, Number(node.width) || 0);
    const height = Math.max(0, Number(node.height) || 0);
    const radii = radiiFromAttrs(node.attrs || {});
    const radius = Math.max(radii.tl, radii.tr, radii.br, radii.bl);
    const opacity = Math.min(1, Math.max(0, Number(node.attrs?.opacity ?? 1)));
    const fill = resolveFillColor(node, 'transparent');
    const stroke = resolveStroke(node, 'transparent');
    const shadow = resolveShadow(node);
    const snippet = buildCodeSnippet(codeTarget, colorFormat, {
      left,
      top,
      width,
      height,
      opacity,
      radius,
      fill,
      stroke: stroke.stroke,
      strokeWidth: stroke.strokeWidth,
      shadow,
    });
    return {
      left,
      top,
      width,
      height,
      radius,
      opacity,
      fill,
      stroke,
      shadow,
      snippet,
      fillText: formatColor(fill, colorFormat),
      strokeText: formatColor(stroke.stroke, colorFormat),
      shadowText: shadow ? formatColor(shadow.color, colorFormat) : '',
    };
  }, [codeTarget, colorFormat, document, node, nodeId]);

  const colorFormatItems = useMemo(
    (): MenuItemType[] =>
      COLOR_FORMATS.map((key) => ({
        key,
        label: colorLabel(key),
      })),
    []
  );
  const codeTargetItems = useMemo(
    (): MenuItemType[] =>
      CODE_TARGETS.map((key) => ({
        key,
        label: codeTargetLabel(key),
      })),
    []
  );

  const copySnippet = async () => {
    if (!model) return;
    const text = isVideo
      ? [
          `x: ${formatPx(model.left)}px`,
          `y: ${formatPx(model.top)}px`,
          `width: ${formatPx(model.width)}px`,
          `height: ${formatPx(model.height)}px`,
        ].join('\n')
      : model.snippet;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      message.success(t('editor.devCopied'));
    } catch {
      message.error(t('editor.devCopyFailed'));
    }
  };

  const copyStyle = async () => {
    if (!model) return;
    const lines = [
      `fill: ${model.fillText}`,
      `stroke: ${formatPx(model.stroke.strokeWidth)}px ${model.strokeText}`,
    ];
    if (model.shadow) {
      lines.push(
        `shadow: ${formatPx(model.shadow.offsetX)} ${formatPx(model.shadow.offsetY)} ${formatPx(model.shadow.blur)} ${model.shadowText}`
      );
    } else {
      lines.push('shadow: none');
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      message.success(t('editor.devCopied'));
    } catch {
      message.error(t('editor.devCopyFailed'));
    }
  };

  return (
    <aside
      data-dev-props
      style={{ width: dockWidth }}
      className={cn(
        'relative flex shrink-0 flex-col overflow-hidden border-l border-[var(--line)] bg-[var(--surface)]',
        className
      )}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('editor.devInspect')}
        aria-valuemin={INSPECT_DOCK_MIN_W}
        aria-valuemax={INSPECT_DOCK_MAX_W}
        aria-valuenow={dockWidth}
        className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize touch-none hover:bg-[var(--accent)]/25 active:bg-[var(--accent)]/40"
        onPointerDown={onDockResizePointerDown}
        onPointerMove={onDockResizePointerMove}
        onPointerUp={endDockResize}
        onPointerCancel={endDockResize}
        onDoubleClick={() => persistDockWidth(INSPECT_DOCK_DEFAULT_W)}
      />
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 px-3">
        <h2 className="text-[13px] font-semibold text-[var(--ink)]">
          {t('editor.devInspect')}
        </h2>
        {onClose ? (
          <Tooltip tip={t('editor.closePanel')} placement="bottom">
            <button
              type="button"
              aria-label={t('editor.closePanel')}
              onClick={onClose}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
            >
              <LuPanelRight className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </Tooltip>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!model || !nodeId ? (
          <div className="px-3 py-8 text-center text-[12px] leading-relaxed text-[var(--muted)]">
            {!hoverNodeId && selectedNodeIds.length > 1
              ? t('editor.devMultiHint')
              : t('editor.devNoSelection')}
          </div>
        ) : (
          <>
            <Section
              title={t('editor.devSelectedObject')}
              right={
                <button
                  type="button"
                  onClick={copySnippet}
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
                  aria-label={t('editor.devCopyCode')}
                >
                  <HiOutlineClipboardDocument className="h-3.5 w-3.5" />
                </button>
              }
            >
              <div className="grid grid-cols-2 gap-1.5">
                <Metric label="X" value={`${formatPx(model.left)}px`} />
                <Metric label="Y" value={`${formatPx(model.top)}px`} />
                <Metric label="W" value={`${formatPx(model.width)}px`} />
                <Metric label="H" value={`${formatPx(model.height)}px`} />
              </div>
              {!isVideo ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-[var(--ink)]">
                  <span className="text-[var(--muted)]">{t('editor.fillRadius')}</span>
                  <span className="tabular-nums">{formatPx(model.radius)}px</span>
                  <span className="text-[var(--muted)]">·</span>
                  <span className="text-[var(--muted)]">{t('editor.fillOpacity')}</span>
                  <span className="tabular-nums">{Math.round(model.opacity * 100)}%</span>
                </div>
              ) : null}
            </Section>

            {!isVideo ? (
            <Section
              title={t('editor.devStyle')}
              right={
                <div className="flex items-center gap-1.5">
                  <Dropdown
                    items={colorFormatItems}
                    selectedKeys={[colorFormat]}
                    placement="bottom-end"
                    offset={6}
                    floatingClassName="z-[90]"
                    popupClassName="min-w-[6rem]"
                    onClick={(key) => {
                      if (COLOR_FORMATS.includes(key as ColorFormat)) {
                        setColorFormat(key as ColorFormat);
                      }
                    }}
                  >
                    <button type="button" aria-label={t('editor.devColorFormat')}>
                      <InspectMenuTrigger label={colorLabel(colorFormat)} />
                    </button>
                  </Dropdown>
                  <button
                    type="button"
                    onClick={copyStyle}
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
                    aria-label={t('editor.devCopyStyle')}
                  >
                    <HiOutlineClipboardDocument className="h-3.5 w-3.5" />
                  </button>
                </div>
              }
            >
              <div className="space-y-2.5 text-[12px]">
                <div className="flex items-center gap-2">
                  <span className="w-10 shrink-0 text-[var(--muted)]">{t('editor.fill')}</span>
                  <ColorSwatch color={model.fill} />
                  <span className="min-w-0 truncate tabular-nums text-[var(--ink)]">
                    {model.fillText}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-10 shrink-0 text-[var(--muted)]">{t('editor.stroke')}</span>
                  <span className="tabular-nums text-[var(--ink)]">
                    {formatPx(model.stroke.strokeWidth)}px
                  </span>
                  <ColorSwatch color={model.stroke.stroke} />
                  <span className="min-w-0 truncate tabular-nums text-[var(--ink)]">
                    {model.strokeText}
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-10 shrink-0 pt-0.5 text-[var(--muted)]">
                    {t('editor.devShadow')}
                  </span>
                  {model.shadow ? (
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap gap-x-2 gap-y-0.5 tabular-nums text-[var(--ink)]">
                        <span>X {formatPx(model.shadow.offsetX)}</span>
                        <span>Y {formatPx(model.shadow.offsetY)}</span>
                        <span>B {formatPx(model.shadow.blur)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <ColorSwatch color={model.shadow.color} />
                        <span className="min-w-0 truncate tabular-nums">
                          {model.shadowText}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <span className="text-[var(--muted)]">—</span>
                  )}
                </div>
              </div>
            </Section>
            ) : null}

            {!isVideo ? (
            <Section
              title={t('editor.devCode')}
              right={
                <div className="flex items-center gap-1.5">
                  <Dropdown
                    items={codeTargetItems}
                    selectedKeys={[codeTarget]}
                    placement="bottom-end"
                    offset={6}
                    floatingClassName="z-[90]"
                    popupClassName="min-w-[6rem]"
                    onClick={(key) => {
                      if (CODE_TARGETS.includes(key as CodeTarget)) {
                        setCodeTarget(key as CodeTarget);
                      }
                    }}
                  >
                    <button type="button" aria-label={t('editor.devCodeTarget')}>
                      <InspectMenuTrigger label={codeTargetLabel(codeTarget)} />
                    </button>
                  </Dropdown>
                  <button
                    type="button"
                    onClick={copySnippet}
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
                    aria-label={t('editor.devCopyCode')}
                  >
                    <HiOutlineClipboardDocument className="h-3.5 w-3.5" />
                  </button>
                </div>
              }
            >
              <pre className="whitespace-pre-wrap break-all rounded-md bg-[var(--canvas)] p-2.5 font-mono text-[11px] leading-relaxed text-[var(--ink)]">
                {model.snippet.split('\n').map((line, i) => {
                  const idx = line.indexOf(':');
                  if (idx < 0) return <div key={i}>{line}</div>;
                  return (
                    <div key={i}>
                      <span>{line.slice(0, idx + 1)}</span>
                      <span className="text-[var(--color-background-success-base-hover,#2f7d4a)]">
                        {line.slice(idx + 1)}
                      </span>
                    </div>
                  );
                })}
              </pre>
            </Section>
            ) : null}

            {canExportNode ? (
              <Section title={t('editor.export')}>
                <ExportSelectionPanel nodeIds={[nodeId!]} variant="inline" />
              </Section>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}

export default memo(DevPropertiesPanel);
