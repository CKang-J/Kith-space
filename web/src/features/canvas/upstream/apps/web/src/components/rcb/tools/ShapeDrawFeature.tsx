/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/tools/ShapeDrawFeature.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import {
  useRcbCamera,
  useRcbScreenToScene,
  useRcbViewportEl,
} from '../camera/context';
import {
  rcbResolveViewportEl,
  rcbViewportMetrics,
} from '../core/math';
import { createPortal } from '@/features/canvas/adapters/recombynReactDom';
import { useEffect, useRef, useState, memo, type ReactNode } from 'react';
import { ARROW_HEAD } from '@recombyn-native/components/rcb/scene/document/sceneShapes';
import { getShapeBaselineD } from '@recombyn-native/components/rcb/core/geometry';
import { snapBoxEdgesToGrid, snapCoordToGrid } from '../selection/alignGuides';
import { getSceneDrawPreviewMount } from '../shapes/shapeHostRegistry';

function normalizeBox(x0: number, y0: number, x1: number, y1: number) {
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  return {
    left,
    top,
    width: Math.max(1, Math.abs(x1 - x0)),
    height: Math.max(1, Math.abs(y1 - y0)),
  };
}

type ShapeDrawSession = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  clientX0: number;
  clientY0: number;
  /** Continuously updated from pointerdown/move — never from pointerup/cancel. */
  currentClientX: number;
  currentClientY: number;
  scaleX: number;
  scaleY: number;
  /** Last pointer position before axis snap (for Shift toggle mid-drag). */
  rawX1: number;
  rawY1: number;
  shift: boolean;
  /** Ctrl/Cmd held — skip grid snap for this gesture. */
  skipGrid: boolean;
  pointerId: number;
};

/**
 * Shift+drag line/arrow: lock to the dominant axis (horizontal or vertical).
 * Prefer horizontal when |dx| >= |dy|.
 */
function snapStrokeAxis(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  shiftKey: boolean
): { x1: number; y1: number } {
  if (!shiftKey) return { x1, y1 };
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x1, y1: y0 };
  }
  return { x1: x0, y1 };
}

/** Circle / regular polygon / star stay square while dragging. */
function locksSquareAspect(kind: string) {
  return kind === 'circle' || kind === 'polygon' || kind === 'star';
}

function squareLockedBox(box: { left: number; top: number; width: number; height: number }) {
  // No hardcoded min size — visual min is enforced after grid snap (minSide).
  const size = Math.max(box.width, box.height);
  return {
    left: box.left + (box.width - size) / 2,
    top: box.top + (box.height - size) / 2,
    width: size,
    height: size,
  };
}

/** Drag-to-create shapes — preview must match createShapeNode paint (width + joins). */
function defaultShapeBorderWidth(kind: string) {
  if (kind === 'line' || kind === 'arrow' || kind === 'pen' || kind === 'pencil') return 2;
  return 1;
}

/** How far center/outside stroke ink extends past the path box (scene px). */
function strokeOutsetForDraw(align: 'center' | 'inside' | 'outside', strokeWidth: number): number {
  const sw = Math.max(0, Number(strokeWidth) || 0);
  if (!(sw > 0) || align === 'inside') return 0;
  if (align === 'outside') return sw;
  return sw / 2;
}

type DrawBox = { left: number; top: number; width: number; height: number };

/**
 * Rubber-band → integer visual outer → inset stroke/2 → path geom.
 * Preview and commit must both use this (do not re-inflate geom on create).
 */
export function resolveClosedDrawBoxes(
  raw: DrawBox,
  useGrid: boolean,
  gridSize: number,
  kind: string
): { visual: DrawBox; geom: DrawBox; outset: number } {
  let box = raw;
  if (locksSquareAspect(kind)) box = squareLockedBox(box);

  const strokeW = defaultShapeBorderWidth(kind);
  const outset = strokeOutsetForDraw('center', strokeW);

  let visual: DrawBox;
  if (useGrid && gridSize > 0) {
    const g = snapBoxEdgesToGrid(box, gridSize, 1);
    visual = {
      left: snapCoordToGrid(g.left, gridSize),
      top: snapCoordToGrid(g.top, gridSize),
      width: Math.max(gridSize, snapCoordToGrid(g.width, gridSize)),
      height: Math.max(gridSize, snapCoordToGrid(g.height, gridSize)),
    };
  } else {
    visual = {
      left: Math.round(box.left),
      top: Math.round(box.top),
      width: Math.max(1, Math.round(box.width)),
      height: Math.max(1, Math.round(box.height)),
    };
  }

  const minSide = Math.max(1, Math.ceil(outset * 2) + (useGrid && gridSize > 0 ? gridSize : 1));
  if (visual.width < minSide) visual = { ...visual, width: minSide };
  if (visual.height < minSide) visual = { ...visual, height: minSide };

  if (!(outset > 0)) return { visual, geom: visual, outset: 0 };
  const geom: DrawBox = {
    left: visual.left + outset,
    top: visual.top + outset,
    width: Math.max(1, visual.width - outset * 2),
    height: Math.max(1, visual.height - outset * 2),
  };
  return { visual, geom, outset };
}

export type ShapeDrawCommit = {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Free-angle stroke endpoints (scene coords). */
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
};

type ShapeDrawFeatureProps = {
  enabled: boolean;
  shapeKind: string;
  artboard: { width: number; height: number };
  paperEl: HTMLElement | null;
  stageEl?: HTMLElement | null;
  onCreate: (kind: string, box: ShapeDrawCommit) => void;
  /**
   * Snap draw corners to document grid (default 1px).
   * Hold Ctrl/Cmd to draw free (integer px still via createShapeNode).
   */
  gridSnap?: boolean;
  gridSize?: number;
};

type PreviewState =
  | { mode: 'box'; geom: DrawBox; visual: DrawBox }
  | { mode: 'stroke'; x0: number; y0: number; x1: number; y1: number };

/** Drag-to-create shapes — preview paints into shared scene SVG (same lattice as grid). */
function ShapeDrawFeature({
  enabled,
  shapeKind,
  artboard,
  paperEl,
  stageEl = null,
  onCreate,
  gridSnap = true,
  gridSize = 10,
}: ShapeDrawFeatureProps) {
  const toScene = useRcbScreenToScene();
  const viewportEl = useRcbViewportEl();
  const toSceneRef = useRef(toScene);
  const onCreateRef = useRef(onCreate);
  const shapeKindRef = useRef(shapeKind);
  const gridSnapRef = useRef(gridSnap);
  const gridSizeRef = useRef(gridSize);
  toSceneRef.current = toScene;
  onCreateRef.current = onCreate;
  shapeKindRef.current = shapeKind;
  gridSnapRef.current = gridSnap;
  gridSizeRef.current = gridSize;
  const session = useRef<ShapeDrawSession | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  useEffect(() => {
    if (!enabled) {
      session.current = null;
      setPreview(null);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    const hitEl = rcbResolveViewportEl(stageEl, paperEl, viewportEl);
    if (!hitEl) return undefined;

    const pointerScene = (clientX: number, clientY: number) =>
      toSceneRef.current(clientX, clientY);

    const snapPoint = (x: number, y: number, skipGrid: boolean) => {
      if (skipGrid || !gridSnapRef.current) return { x, y };
      const g = gridSizeRef.current;
      return { x: snapCoordToGrid(x, g), y: snapCoordToGrid(y, g) };
    };

    const closedPreviewFromPointer = (
      s: ShapeDrawSession,
      clientX: number,
      clientY: number,
      skipGrid: boolean
    ) => {
      const p = pointerScene(clientX, clientY);
      s.currentClientX = clientX;
      s.currentClientY = clientY;
      s.rawX1 = p.x;
      s.rawY1 = p.y;
      s.skipGrid = skipGrid;
      s.x1 = p.x;
      s.y1 = p.y;
      const kind = shapeKindRef.current || 'rect';
      const raw = normalizeBox(s.x0, s.y0, p.x, p.y);
      return resolveClosedDrawBoxes(
        raw,
        Boolean(gridSnapRef.current && !skipGrid),
        gridSizeRef.current,
        kind
      );
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const skipGrid = e.ctrlKey || e.metaKey;
      const p = pointerScene(e.clientX, e.clientY);
      const origin = snapPoint(p.x, p.y, skipGrid);
      const metrics = rcbViewportMetrics(hitEl);
      const kind = shapeKindRef.current || 'rect';
      const isStroke = kind === 'line' || kind === 'arrow';
      session.current = {
        x0: origin.x,
        y0: origin.y,
        x1: origin.x,
        y1: origin.y,
        clientX0: e.clientX,
        clientY0: e.clientY,
        currentClientX: e.clientX,
        currentClientY: e.clientY,
        scaleX: metrics.scaleX,
        scaleY: metrics.scaleY,
        rawX1: p.x,
        rawY1: p.y,
        shift: e.shiftKey,
        skipGrid,
        pointerId: e.pointerId,
      };
      if (isStroke) {
        setPreview({ mode: 'stroke', x0: origin.x, y0: origin.y, x1: origin.x, y1: origin.y });
      } else {
        const boxes = resolveClosedDrawBoxes(
          normalizeBox(origin.x, origin.y, origin.x, origin.y),
          Boolean(gridSnapRef.current && !skipGrid),
          gridSizeRef.current,
          kind
        );
        setPreview({ mode: 'box', geom: boxes.geom, visual: boxes.visual });
      }
      hitEl.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    };

    const onMove = (e: PointerEvent) => {
      const s = session.current;
      if (!s || e.pointerId !== s.pointerId) return;
      const skipGrid = e.ctrlKey || e.metaKey;
      const kind = shapeKindRef.current || 'rect';
      const isStroke = kind === 'line' || kind === 'arrow';
      if (isStroke) {
        const p = pointerScene(e.clientX, e.clientY);
        const endRaw = snapStrokeAxis(s.x0, s.y0, p.x, p.y, e.shiftKey);
        const end = snapPoint(endRaw.x1, endRaw.y1, skipGrid);
        s.currentClientX = e.clientX;
        s.currentClientY = e.clientY;
        s.rawX1 = p.x;
        s.rawY1 = p.y;
        s.shift = e.shiftKey;
        s.skipGrid = skipGrid;
        s.x1 = end.x;
        s.y1 = end.y;
        setPreview({ mode: 'stroke', x0: s.x0, y0: s.y0, x1: end.x, y1: end.y });
        return;
      }
      const boxes = closedPreviewFromPointer(s, e.clientX, e.clientY, skipGrid);
      setPreview({ mode: 'box', geom: boxes.geom, visual: boxes.visual });
    };

    const finishSession = (e: PointerEvent) => {
      const s = session.current;
      if (!s || e.pointerId !== s.pointerId) return;
      session.current = null;
      setPreview(null);
      try {
        hitEl.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      const kind = shapeKindRef.current || 'rect';
      const isStroke = kind === 'line' || kind === 'arrow';
      if (isStroke) {
        const x0 = s.x0;
        const y0 = s.y0;
        const x1 = s.x1;
        const y1 = s.y1;
        if (Math.hypot(x1 - x0, y1 - y0) < 3) return;
        const box = normalizeBox(x0, y0, x1, y1);
        onCreateRef.current(kind, { ...box, x0, y0, x1, y1 });
        return;
      }

      const clientDist = Math.hypot(s.currentClientX - s.clientX0, s.currentClientY - s.clientY0);
      const raw = normalizeBox(s.x0, s.y0, s.rawX1, s.rawY1);
      if (clientDist < 4 && raw.width < 3 && raw.height < 3) return;
      const { geom } = resolveClosedDrawBoxes(
        raw,
        Boolean(gridSnapRef.current && !s.skipGrid),
        gridSizeRef.current,
        kind
      );
      onCreateRef.current(kind, geom);
    };

    hitEl.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finishSession);
    window.addEventListener('pointercancel', finishSession);

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Shift' || !session.current) return;
      const { x0, y0, rawX1, rawY1, skipGrid } = session.current;
      const kind = shapeKindRef.current || 'rect';
      if (kind !== 'line' && kind !== 'arrow') return;
      const shift = e.type === 'keydown';
      const endRaw = snapStrokeAxis(x0, y0, rawX1, rawY1, shift);
      const end = snapPoint(endRaw.x1, endRaw.y1, skipGrid);
      session.current.shift = shift;
      session.current.x1 = end.x;
      session.current.y1 = end.y;
      setPreview({ mode: 'stroke', x0, y0, x1: end.x, y1: end.y });
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    return () => {
      hitEl.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finishSession);
      window.removeEventListener('pointercancel', finishSession);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [enabled, paperEl, stageEl, viewportEl]);

  const camera = useRcbCamera();
  const z = Math.max(0.05, camera.zoom || 1);
  const inv = 1 / z;
  const kind = shapeKind || 'rect';
  const strokeW = defaultShapeBorderWidth(kind);

  if (!enabled) return null;

  let sizeLabel: string | null = null;
  let labelX = 0;
  let labelY = 0;
  let previewSvg: ReactNode = null;

  const previewMount = getSceneDrawPreviewMount();

  if (preview?.mode === 'stroke') {
    const len = Math.hypot(preview.x1 - preview.x0, preview.y1 - preview.y0);
    if (len >= 3) {
      sizeLabel = String(Math.round(len));
      labelX = (preview.x0 + preview.x1) / 2;
      labelY = Math.min(preview.y0, preview.y1);
    }
    let arrowHead: ReactNode = null;
    if (kind === 'arrow' && len >= 3) {
      const ux = (preview.x1 - preview.x0) / len;
      const uy = (preview.y1 - preview.y0) / len;
      const head = Math.min(ARROW_HEAD, len * 0.45);
      const bx = preview.x1 - ux * head;
      const by = preview.y1 - uy * head;
      const nx = -uy;
      const ny = ux;
      const wing = head * 0.55;
      arrowHead = (
        <path
          d={`M ${bx + nx * wing} ${by + ny * wing} L ${preview.x1} ${preview.y1} L ${bx - nx * wing} ${by - ny * wing}`}
          fill="none"
          stroke="#333333"
          strokeWidth={strokeW}
          strokeLinecap="butt"
          strokeLinejoin="miter"
        />
      );
    }
    const strokePreview = (
      <g data-shape-draw-preview pointerEvents="none" aria-hidden>
        <line
          x1={preview.x0}
          y1={preview.y0}
          x2={preview.x1}
          y2={preview.y1}
          stroke="#333333"
          strokeWidth={strokeW}
          strokeLinecap="butt"
        />
        {arrowHead}
      </g>
    );
    previewSvg = previewMount ? createPortal(strokePreview, previewMount) : null;
  } else if (preview?.mode === 'box') {
    const { visual, geom } = preview;
    if (visual.width >= 3 || visual.height >= 3) {
      sizeLabel = `${Math.round(visual.width)} × ${Math.round(visual.height)}`;
      labelX = visual.left + visual.width / 2;
      labelY = visual.top;
    }
    const pathD =
      getShapeBaselineD(
        { key: 'shape', width: geom.width, height: geom.height, attrs: { shapeType: kind } },
        { width: geom.width, height: geom.height }
      ) || `M 0 0 H ${Math.max(1, geom.width)} V ${Math.max(1, geom.height)} H 0 Z`;
    const boxPreview = (
      <g data-shape-draw-preview pointerEvents="none" aria-hidden>
        <g transform={`translate(${geom.left} ${geom.top})`}>
          <path
            d={pathD}
            fill="rgba(255,255,255,0.85)"
            stroke="#333333"
            strokeWidth={strokeW}
            strokeLinecap="butt"
            strokeLinejoin="miter"
          />
        </g>
      </g>
    );
    previewSvg = previewMount ? createPortal(boxPreview, previewMount) : null;
  }

  const labelFont = 10 * inv;
  const labelGap = 14 * inv;

  return (
    <>
      {previewSvg}
      {sizeLabel ? (
        <div
          data-shape-draw-preview-label
          className="pointer-events-none absolute z-20 whitespace-nowrap font-medium text-[var(--muted)]"
          style={{
            left: labelX,
            top: labelY - labelGap,
            fontSize: labelFont,
            lineHeight: 1.2,
            transform: 'translate(-50%, -100%)',
          }}
        >
          {sizeLabel}
        </div>
      ) : null}
    </>
  );
}

export default memo(ShapeDrawFeature);
