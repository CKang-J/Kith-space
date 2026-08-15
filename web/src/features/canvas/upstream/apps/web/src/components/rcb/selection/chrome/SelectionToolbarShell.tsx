/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/selection/chrome/SelectionToolbarShell.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import {
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  memo,
} from 'react';
import { useRcbCamera } from '../../camera/context';
import { rcbCameraCssZoom, rcbScreenPxToScene } from '../../core/math';
import { FloatingToolbar } from '@recombyn-native/components/editor/chrome/FloatingToolbar';
import { cn } from '@recombyn-native/utils/classnames';

/** Interactive controls inside canvas overlays (toolbars / generators / menus). */
const CHROME_ACTION_SEL =
  'button:not([disabled]), [role="button"]:not([aria-disabled="true"]), [role="menuitem"]:not([aria-disabled="true"])';

function chromeActionFromEvent(
  target: EventTarget | null,
  root: EventTarget & HTMLElement
): HTMLElement | null {
  const el = (target as HTMLElement | null)?.closest?.(CHROME_ACTION_SEL) as HTMLElement | null;
  if (!el || !root.contains(el)) return null;
  return el;
}

/**
 * Activate chrome buttons on pointer down/up (same path as node hits).
 * Suppresses the following real click after a synthetic `.click()`.
 */
export function useChromePointerActivate() {
  const armedRef = useRef<HTMLElement | null>(null);
  const suppressBrowserClickRef = useRef(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation?.();
    suppressBrowserClickRef.current = false;
    if (e.button !== 0) {
      armedRef.current = null;
      return;
    }
    armedRef.current = chromeActionFromEvent(e.target, e.currentTarget);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const armed = armedRef.current;
    armedRef.current = null;
    if (!armed || e.button !== 0) return;
    if (chromeActionFromEvent(e.target, e.currentTarget) !== armed) return;
    e.preventDefault();
    e.stopPropagation();
    suppressBrowserClickRef.current = true;
    armed.click();
  };

  const onPointerCancel = () => {
    armedRef.current = null;
    suppressBrowserClickRef.current = false;
  };

  const onClickCapture = (e: ReactMouseEvent<HTMLElement>) => {
    if (!suppressBrowserClickRef.current) return;
    // Programmatic `.click()` is detail 0 — let it reach the button onClick.
    if (e.detail === 0) return;
    suppressBrowserClickRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  return { onPointerDown, onPointerUp, onPointerCancel, onClickCapture };
}

/**
 * Title row gaps above the frame (screen px → scene via /zoom).
 */
export const NODE_TITLE_LABEL_GAP_PX = 10;
export const NODE_TITLE_LABEL_LINE_PX = 16;

/** Gap between title top and toolbar bottom (above dock, titled). */
export const SELECTION_TOOLBAR_ABOVE_LABEL_GAP_PX = 8;

/** Gap between box edge and toolbar when there is no title. */
export const SELECTION_TOOLBAR_ABOVE_BOX_GAP_PX = 20;

/** Gap between box bottom and toolbar top (below dock). */
export const SELECTION_TOOLBAR_BELOW_BOX_GAP_PX = 20;

/** Half knob + air outside the chrome edge (must clear 10px resize hit). */
export const SELECTION_HANDLE_CLEARANCE_PX = 14;

export type SelectionToolbarBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Screen px from selection top → toolbar bottom (above dock). */
export function toolbarAboveClearancePx(hasTitleLabel: boolean) {
  if (!hasTitleLabel) return SELECTION_TOOLBAR_ABOVE_BOX_GAP_PX;
  return (
    NODE_TITLE_LABEL_GAP_PX +
    NODE_TITLE_LABEL_LINE_PX +
    SELECTION_TOOLBAR_ABOVE_LABEL_GAP_PX
  );
}

/** Scene Y of the toolbar bottom edge when docking above `boxTop`. */
export function selectionToolbarAboveAnchorScene(
  boxTop: number,
  zoom: number,
  hasTitleLabel: boolean,
  edgePadScene = 0
): number {
  const z = Math.max(0.05, zoom || 1);
  const handleClear = SELECTION_HANDLE_CLEARANCE_PX / z;
  const clear = handleClear + Math.max(0, edgePadScene);
  return boxTop - toolbarAboveClearancePx(hasTitleLabel) / z - clear;
}

/**
 * Stage layout px from plate top → toolbar bottom (above dock).
 * Pass `viewportScale` when an ancestor CSS-scales the stage.
 */
export function toolbarAboveScreenGapPx(
  boxTop: number,
  zoom: number,
  hasTitleLabel: boolean,
  edgePadScene = 0,
  viewportScale = 1
): number {
  const z = Math.max(0.05, zoom || 1);
  const sx = viewportScale > 0 ? viewportScale : 1;
  const anchor = selectionToolbarAboveAnchorScene(
    boxTop,
    z,
    hasTitleLabel,
    edgePadScene
  );
  return (boxTop - anchor) * z * sx;
}

/**
 * World-layer HTML chrome under camera `scale(zoom)`.
 *
 * Why DevTools shows a “phantom” strip on the box while the pill sits above:
 * anchor is at the selection edge; `translate` only moves paint.
 * If the wrapper keeps the toolbar’s layout size + `pointer-events:auto`, that
 * untransformed box covers the top edge / NE resize knob. Same fix as
 * SelectionFeature overlays: outer `0×0` shell, absolute pe:auto content.
 */
export function WorldScreenChromeRoot({
  left,
  top,
  anchor = 'bottom',
  hAlign = 'center',
  className,
  style,
  children,
  ...rest
}: {
  left: number;
  top: number;
  anchor?: 'bottom' | 'top';
  /** Horizontal dock: center (default) or top-right of the selection. */
  hAlign?: 'center' | 'right';
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, 'style' | 'children'>) {
  const camera = useRcbCamera();
  const inv = 1 / rcbCameraCssZoom(camera);
  const yShift = anchor === 'bottom' ? '-100%' : '0';
  const xShift = hAlign === 'right' ? '-100%' : '-50%';
  return (
    <div
      className={cn('pointer-events-none absolute overflow-visible', className)}
      style={{
        position: 'absolute',
        left,
        top,
        width: 0,
        height: 0,
        transform: `scale(${inv})`,
        transformOrigin: '0 0',
        // Inline beats world `[&>*]:pointer-events-auto` if mounted there.
        pointerEvents: 'none',
        ...style,
      }}
    >
      <div
        className="pointer-events-auto absolute left-0 top-0"
        style={{
          transform: `translate(${xShift}, ${yShift})`,
          width: 'max-content',
        }}
        {...rest}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * World-space placement for selection / frame floating toolbars.
 * With `anchor: 'bottom'`, `top` is the toolbar bottom edge.
 * Horizontally centered on the selection (pill stays above mid-box).
 */
export function useSelectionToolbarPlacement(opts: {
  box: SelectionToolbarBox | null | undefined;
  hasTitleLabel?: boolean;
  /** Extra scene pad outside the chrome (e.g. stroke ink beyond the path). */
  edgePadScene?: number;
}): {
  preferAbove: boolean;
  left: number;
  top: number;
  anchor: 'bottom' | 'top';
} {
  const camera = useRcbCamera();
  const zoom = rcbCameraCssZoom(camera);
  const hasTitle = Boolean(opts.hasTitleLabel);
  const edgePad = Math.max(0, Number(opts.edgePadScene) || 0);
  const handleClear = rcbScreenPxToScene(SELECTION_HANDLE_CLEARANCE_PX, zoom);
  const clear = handleClear + edgePad;
  const aboveGap = rcbScreenPxToScene(toolbarAboveClearancePx(hasTitle), zoom) + clear;
  const belowGap = rcbScreenPxToScene(SELECTION_TOOLBAR_BELOW_BOX_GAP_PX, zoom) + clear;
  const box = opts.box;
  const preferAbove = Boolean(box) && box.top >= aboveGap;
  const left = box ? box.left + box.width / 2 : 0;
  let top = 0;
  if (box) {
    top = preferAbove
      ? selectionToolbarAboveAnchorScene(box.top, zoom, hasTitle, edgePad)
      : box.top + box.height + belowGap;
  }

  return {
    preferAbove,
    left,
    top,
    anchor: (preferAbove ? 'bottom' : 'top') as 'bottom' | 'top',
  };
}

type ShellProps = {
  box: SelectionToolbarBox | null | undefined;
  hasTitleLabel?: boolean;
  /** Scene pad beyond chrome for outer stroke ink. */
  edgePadScene?: number;
  children: ReactNode;
  className?: string;
  isFrameToolbar?: boolean;
  bare?: boolean;
  zIndexClassName?: string;
};

/** World-layer selection toolbars (clears titles; aligns Frame / Image / Shape). */
function SelectionToolbarShell({
  box,
  hasTitleLabel = false,
  edgePadScene = 0,
  children,
  className,
  isFrameToolbar = false,
  bare = false,
  zIndexClassName = 'z-30',
}: ShellProps) {
  const { left, top, anchor } = useSelectionToolbarPlacement({
    box,
    hasTitleLabel,
    edgePadScene,
  });
  const chromePointer = useChromePointerActivate();
  if (!box) return null;

  return (
    <WorldScreenChromeRoot
      left={left}
      top={top}
      anchor={anchor}
      hAlign="center"
      data-sel-toolbar
      {...(isFrameToolbar ? { 'data-frame-toolbar': true } : {})}
      className={zIndexClassName}
      {...chromePointer}
    >
      <FloatingToolbar bare={bare} className={className}>
        {children}
      </FloatingToolbar>
    </WorldScreenChromeRoot>
  );
}

const MemoizedSelectionToolbarShell = memo(SelectionToolbarShell);
export { MemoizedSelectionToolbarShell as SelectionToolbarShell };
