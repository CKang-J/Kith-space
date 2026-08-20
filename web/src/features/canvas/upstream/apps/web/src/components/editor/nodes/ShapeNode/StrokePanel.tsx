/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ShapeNode/StrokePanel.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useCallback, useState, type CSSProperties, type ReactNode, memo } from 'react';
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  type Placement,
} from '@/features/canvas/adapters/recombynFloatingUi';
import { HiOutlineChevronDown } from 'react-icons/hi2';
import { useTranslation } from 'react-i18next';
import {
  COLOR_PANEL_WIDTH,
  ColorPanel,
  FILL_SOLID_PRESETS,
  INPUT_NO_SPIN,
} from '@recombyn-native/components/base/colorPanel';
import Tooltip from '@recombyn-native/components/base/tooltip';
import { Icon } from '@recombyn-native/components/base/icon';
import {
  type StrokeStyle,
  STROKE_STYLES,
  strokeStyleLabel,
} from '@recombyn-native/components/editor/nodes/ShapeNode/StrokeStylePicker';
import { strokeDashPreview } from '@recombyn-native/components/rcb/scene/document/sceneStrokeStyle';
import type {
  StrokeAlign,
  StrokeLinecap,
  StrokeLinejoin,
} from '@recombyn-native/components/rcb/scene/document/sceneEffects';
import {
  PanelSegmentedIcons,
  PanelToggleIcons,
  StylePanelShell,
} from '@recombyn-native/components/editor/panels/StylePanelChrome';
import {
  SEL_ICON_BTN,
  SEL_ICON_BTN_ACTIVE,
} from '@recombyn-native/components/rcb/selection/chrome/ToolbarValueSlider';
import { cn } from '@recombyn-native/utils/classnames';

function StrokeStyleIcon({
  style,
  active,
}: {
  style: StrokeStyle;
  active?: boolean;
}) {
  return (
    <svg viewBox="0 0 28 8" className="h-3.5 w-7 shrink-0" aria-hidden>
      <line
        x1="1"
        y1="4"
        x2="27"
        y2="4"
        stroke="currentColor"
        strokeWidth={active ? 1.8 : 1.5}
        strokeLinecap="round"
        strokeDasharray={strokeDashPreview(style)}
      />
    </svg>
  );
}

export type StrokeSides = { T: boolean; R: boolean; B: boolean; L: boolean };

export type StrokePanelValue = {
  color: string;
  opacity: number;
  width: number;
  style: StrokeStyle;
  align?: StrokeAlign;
  linecap?: StrokeLinecap;
  linejoin?: StrokeLinejoin;
  /** Per-side visibility (rect-like only). */
  sides?: StrokeSides;
};

const DEFAULT_SIDES: StrokeSides = { T: true, R: true, B: true, L: true };

function panelIcon(name: string) {
  return function PanelGlyph({ className }: { className?: string }) {
    return <Icon name={name} className={className} />;
  };
}

const IconStrokeAlignInside = panelIcon('editor-stroke-align-inside');
const IconStrokeAlignCenter = panelIcon('editor-stroke-align-center');
const IconStrokeAlignOutside = panelIcon('editor-stroke-align-outside');
const IconStrokeCapButt = panelIcon('editor-stroke-cap-butt');
const IconStrokeCapRound = panelIcon('editor-stroke-cap-round');
const IconStrokeCapSquare = panelIcon('editor-stroke-cap-square');
const IconStrokeJoinMiter = panelIcon('editor-stroke-join-miter');
const IconStrokeJoinRound = panelIcon('editor-stroke-join-round');
const IconStrokeJoinBevel = panelIcon('editor-stroke-join-bevel');
const IconSideAll = panelIcon('editor-stroke-side-all');
const IconSideTop = panelIcon('editor-stroke-side-top');
const IconSideRight = panelIcon('editor-stroke-side-right');
const IconSideBottom = panelIcon('editor-stroke-side-bottom');
const IconSideLeft = panelIcon('editor-stroke-side-left');

/** Compact stroke-style dropdown field (not tabs). */
function StrokeStyleField({
  value,
  onChange,
}: {
  value: StrokeStyle;
  onChange: (next: StrokeStyle) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const current = STROKE_STYLES.includes(value) ? value : 'solid';

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-end',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        aria-label={strokeStyleLabel(current, t)}
        aria-expanded={open}
        className="inline-flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded bg-[var(--accent-soft)] px-2 text-[12px] text-[var(--ink)] outline-none hover:bg-[var(--line)]"
        {...getReferenceProps({ onClick: () => setOpen((v) => !v) })}
      >
        <StrokeStyleIcon style={current} active />
        <span className="min-w-0 flex-1 truncate text-left">{strokeStyleLabel(current, t)}</span>
        <HiOutlineChevronDown className="h-3 w-3 shrink-0 text-[var(--muted)]" />
      </button>

      <FloatingPortal>
        {open ? (
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="z-[90]"
            {...getFloatingProps()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div
              data-stroke-style-menu
              className="min-w-[10.5rem] overflow-hidden rounded bg-[var(--surface)] py-1 shadow-lg ring-1 ring-[var(--line)]"
            >
              {STROKE_STYLES.map((style) => (
                <button
                  key={style}
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] text-[var(--ink)] hover:bg-[var(--accent-soft)]',
                    current === style && 'bg-[var(--accent-soft)] font-medium'
                  )}
                  onClick={() => {
                    onChange(style);
                    setOpen(false);
                  }}
                >
                  <StrokeStyleIcon style={style} active={current === style} />
                  <span>{strokeStyleLabel(style, t)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </FloatingPortal>
    </>
  );
}

/**
 * Stroke editor panel: width · style · sides · align/cap/join · color.
 * Corner radius lives in CornerRadiusPanel (opened from the R toolbar control).
 */
function StrokePanel({
  value,
  onChange,
  title = '描边',
  onClose,
  className,
  showLinecap = true,
  showAlign = true,
  showSides = false,
  layerVisible = true,
  onLayerVisibleChange,
}: {
  value: StrokePanelValue;
  onChange: (next: StrokePanelValue) => void;
  title?: string;
  onClose?: () => void;
  className?: string;
  /** Open paths only — caps have no effect on closed shapes. */
  showLinecap?: boolean;
  /** Closed filled shapes only — inside / outside need a fill boundary. */
  showAlign?: boolean;
  /** Rect-like only — independent T/R/B/L side strokes. */
  showSides?: boolean;
  /** Show/hide stroke on the canvas (eye control in panel header). */
  layerVisible?: boolean;
  onLayerVisibleChange?: (visible: boolean) => void;
}) {
  const { t } = useTranslation();
  const patch = (partial: Partial<StrokePanelValue>) => onChange({ ...value, ...partial });
  const width = Math.max(0, Math.round(Number(value.width) || 0));
  const align: StrokeAlign =
    value.align === 'inside' || value.align === 'outside' ? value.align : 'center';
  const linecap: StrokeLinecap =
    value.linecap === 'round' || value.linecap === 'square' ? value.linecap : 'butt';
  const linejoin: StrokeLinejoin =
    value.linejoin === 'round' || value.linejoin === 'bevel' ? value.linejoin : 'miter';
  const sides = value.sides ?? DEFAULT_SIDES;

  return (
    <StylePanelShell
      title={title}
      onClose={onClose}
      width={COLOR_PANEL_WIDTH}
      dataAttr="data-stroke-panel"
      className={className}
      layerVisible={layerVisible}
      onLayerVisibleChange={onLayerVisibleChange}
      layerVisibleTipShow="显示描边"
      layerVisibleTipHide="隐藏描边"
    >
      <div className="flex w-full items-center justify-between gap-1.5">
        <label className="inline-flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-[4px] bg-[var(--accent-soft)] px-2 text-[12px] text-[var(--ink)]">
          <Icon name="editor-stroke-weight" className="h-4 w-4 shrink-0 text-[var(--muted)]" />
          <input
            type="number"
            min={0}
            value={width}
            onChange={(e) =>
              patch({
                width: Math.max(0, Math.round(Number(e.target.value) || 0)),
              })
            }
            className={cn(
              'min-w-0 flex-1 bg-transparent text-[12px] tabular-nums outline-none',
              INPUT_NO_SPIN
            )}
          />
          <span className="shrink-0 text-[11px] text-[var(--muted)]">px</span>
        </label>
        <StrokeStyleField value={value.style} onChange={(style) => patch({ style })} />
      </div>

      {showSides ? (
        <PanelToggleIcons
          value={sides}
          onChange={(next) => patch({ sides: next as StrokeSides })}
          leading={{
            tip: t('editor.strokeSideAll'),
            Icon: IconSideAll,
            active: Boolean(sides.T && sides.R && sides.B && sides.L),
            onClick: () => {
              const allOn = Boolean(sides.T && sides.R && sides.B && sides.L);
              const next = !allOn;
              patch({ sides: { T: next, R: next, B: next, L: next } });
            },
          }}
          options={[
            { id: 'T', tip: t('editor.strokeSideTop'), Icon: IconSideTop },
            { id: 'L', tip: t('editor.strokeSideLeft'), Icon: IconSideLeft },
            { id: 'B', tip: t('editor.strokeSideBottom'), Icon: IconSideBottom },
            { id: 'R', tip: t('editor.strokeSideRight'), Icon: IconSideRight },
          ]}
        />
      ) : null}

      {/* 图3：对齐 + 连接同一行；开放路径的线帽单独一行 */}
      {showLinecap ? (
        <PanelSegmentedIcons
          value={linecap}
          onChange={(next) => patch({ linecap: next })}
          options={[
            { id: 'butt', tip: t('editor.strokeCapButt'), Icon: IconStrokeCapButt },
            { id: 'round', tip: t('editor.strokeCapRound'), Icon: IconStrokeCapRound },
            { id: 'square', tip: t('editor.strokeCapSquare'), Icon: IconStrokeCapSquare },
          ]}
        />
      ) : null}
      <div className="flex w-full items-center gap-1">
        {showAlign ? (
          <PanelSegmentedIcons
            className="min-w-0 flex-1"
            value={align}
            onChange={(next) => patch({ align: next })}
            options={[
              { id: 'inside', tip: t('editor.strokeAlignInside'), Icon: IconStrokeAlignInside },
              { id: 'center', tip: t('editor.strokeAlignCenter'), Icon: IconStrokeAlignCenter },
              { id: 'outside', tip: t('editor.strokeAlignOutside'), Icon: IconStrokeAlignOutside },
            ]}
          />
        ) : null}
        <PanelSegmentedIcons
          className="min-w-0 flex-1"
          value={linejoin}
          onChange={(next) => patch({ linejoin: next })}
          options={[
            { id: 'miter', tip: t('editor.strokeJoinMiter'), Icon: IconStrokeJoinMiter },
            { id: 'round', tip: t('editor.strokeJoinRound'), Icon: IconStrokeJoinRound },
            { id: 'bevel', tip: t('editor.strokeJoinBevel'), Icon: IconStrokeJoinBevel },
          ]}
        />
      </div>

      <ColorPanel
        value={value.color}
        opacity={value.opacity}
        showAlpha
        onChange={(color) => patch({ color })}
        onOpacityChange={(opacity) => patch({ opacity })}
        showHeader={false}
        padded={false}
        presets={FILL_SOLID_PRESETS}
        className="!w-full !shadow-none !ring-0"
      />
    </StylePanelShell>
  );
}

export type StrokePanelPopoverProps = {
  value: StrokePanelValue;
  onChange: (next: StrokePanelValue) => void;
  title?: string;
  placement?: Placement;
  disabled?: boolean;
  className?: string;
  children?: ReactNode | ((ctx: { open: boolean; value: StrokePanelValue }) => ReactNode);
};

/** Toolbar trigger → stroke panel (width / style / align / cap / join / color). */
function StrokePanelPopover({
  value,
  onChange,
  title = '描边',
  placement = 'bottom-start',
  disabled = false,
  className,
  children,
}: StrokePanelPopoverProps) {
  const [open, setOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(10),
      flip({
        padding: 12,
        fallbackPlacements: ['top-start', 'top-end', 'right-start', 'left-start'],
      }),
      shift({ padding: 12 }),
    ],
  });
  const dismiss = useDismiss(context, {
    outsidePress: (event) => {
      const target = event.target as HTMLElement | null;
      // Nested style dropdown portals to body.
      if (target?.closest?.('[data-stroke-panel]')) return false;
      if (target?.closest?.('[data-stroke-style-menu]')) return false;
      if (target?.closest?.('[data-color-panel]')) return false;
      return true;
    },
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

  const setOpenSafe = useCallback(
    (next: boolean) => {
      if (!disabled) setOpen(next);
    },
    [disabled]
  );

  const trigger =
    typeof children === 'function'
      ? children({ open, value })
      : children ?? (
          <span className="relative inline-flex h-4 w-4 items-center justify-center overflow-hidden rounded-full border-2 border-[var(--ink)] bg-transparent">
            <span
              aria-hidden
              className="absolute inset-[3px] rounded-full"
              style={{
                backgroundImage:
                  'linear-gradient(45deg, #d0d0d0 25%, transparent 25%), linear-gradient(-45deg, #d0d0d0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d0d0d0 75%), linear-gradient(-45deg, transparent 75%, #d0d0d0 75%)',
                backgroundSize: '5px 5px',
                backgroundPosition: '0 0, 0 2.5px, 2.5px -2.5px, -2.5px 0',
              }}
            />
            <span
              className="absolute inset-[3px] rounded-full"
              style={{ background: value.color, opacity: value.opacity / 100 }}
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
          className={cn(SEL_ICON_BTN, open && SEL_ICON_BTN_ACTIVE, className)}
          {...getReferenceProps({
            onClick: () => setOpenSafe(!open),
          })}
        >
          {trigger}
        </button>
      </Tooltip>

      <FloatingPortal>
        {open ? (
          <div
            ref={refs.setFloating}
            style={floatingStyles as CSSProperties}
            className="z-[80]"
            {...getFloatingProps()}
          >
            <StrokePanel
              value={value}
              onChange={onChange}
              title={title}
              onClose={() => setOpen(false)}
            />
          </div>
        ) : null}
      </FloatingPortal>
    </>
  );
}

export default memo(StrokePanel);
const MemoizedStrokePanel = memo(StrokePanel);
export { MemoizedStrokePanel as StrokePanel };
const MemoizedStrokePanelPopover = memo(StrokePanelPopover);
export { MemoizedStrokePanelPopover as StrokePanelPopover };
