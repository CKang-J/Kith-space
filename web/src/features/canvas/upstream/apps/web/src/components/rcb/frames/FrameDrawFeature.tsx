/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/frames/FrameDrawFeature.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Drag on empty world to create an artboard frame (SVG plate).
 * Draw mechanics match ShapeDrawFeature (rect): DPR toScene, grid snap, portal.
 * Plate **paint** stays artboard hairline (scene width = 1/zoom under CSS scale).
 */
import { createPortal } from '@/features/canvas/adapters/recombynReactDom';
import { useEffect, useRef, useState, memo } from 'react';
import {
  useRcbCamera,
  useRcbScreenToScene,
  useRcbViewportEl,
} from '../camera/context';
import { snapBoxEdgesToGrid, snapCoordToGrid } from '../selection/alignGuides';
import { getSceneDrawPreviewMount } from '../shapes/shapeHostRegistry';
import { FRAME_PLATE_STROKE, framePlateStrokeSceneWidth } from './types';

export { FRAME_PLATE_STROKE, FRAME_PLATE_STROKE_WIDTH, framePlateStrokeSceneWidth } from './types';

type FrameDrawFeatureProps = {
  enabled: boolean;
  stageEl: HTMLElement | null;
  onCommit: (rect: { x: number; y: number; width: number; height: number }) => void;
  gridSnap?: boolean;
  gridSize?: number;
};

type DrawBox = { left: number; top: number; width: number; height: number };

function normalizeBox(x0: number, y0: number, x1: number, y1: number): DrawBox {
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  return {
    left,
    top,
    width: Math.max(1, Math.abs(x1 - x0)),
    height: Math.max(1, Math.abs(y1 - y0)),
  };
}

/**
 * Rubber-band → integer plate edges on the grid (artboard content box).
 * Unlike closed shapes we do **not** inset for center stroke — `createFrame`
 * rounds to integers, and the plate fill IS the artboard size.
 */
export function resolveFrameDrawBox(
  raw: DrawBox,
  useGrid: boolean,
  gridSize: number
): DrawBox {
  if (useGrid && gridSize > 0) {
    const g = snapBoxEdgesToGrid(raw, gridSize, 1);
    return {
      left: snapCoordToGrid(g.left, gridSize),
      top: snapCoordToGrid(g.top, gridSize),
      width: Math.max(gridSize, snapCoordToGrid(g.width, gridSize)),
      height: Math.max(gridSize, snapCoordToGrid(g.height, gridSize)),
    };
  }
  return {
    left: Math.round(raw.left),
    top: Math.round(raw.top),
    width: Math.max(1, Math.round(raw.width)),
    height: Math.max(1, Math.round(raw.height)),
  };
}

type Session = {
  x0: number;
  y0: number;
  rawX1: number;
  rawY1: number;
  clientX0: number;
  clientY0: number;
  currentClientX: number;
  currentClientY: number;
  skipGrid: boolean;
  pointerId: number;
};

function FrameDrawFeature({
  enabled,
  stageEl,
  onCommit,
  gridSnap = true,
  gridSize = 1,
}: FrameDrawFeatureProps) {
  const camera = useRcbCamera();
  const toScene = useRcbScreenToScene();
  const viewportEl = useRcbViewportEl();
  const toSceneRef = useRef(toScene);
  const onCommitRef = useRef(onCommit);
  const gridSnapRef = useRef(gridSnap);
  const gridSizeRef = useRef(gridSize);
  toSceneRef.current = toScene;
  onCommitRef.current = onCommit;
  gridSnapRef.current = gridSnap;
  gridSizeRef.current = gridSize;

  const session = useRef<Session | null>(null);
  const [preview, setPreview] = useState<DrawBox | null>(null);

  useEffect(() => {
    if (!enabled) {
      session.current = null;
      setPreview(null);
      return undefined;
    }
    const hitEl = stageEl || viewportEl;
    if (!hitEl) return undefined;

    const snapPoint = (x: number, y: number, skip: boolean) => {
      if (skip || !gridSnapRef.current || !(gridSizeRef.current > 0)) {
        return { x, y };
      }
      const g = gridSizeRef.current;
      return { x: snapCoordToGrid(x, g), y: snapCoordToGrid(y, g) };
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-frame-label],[data-image-label],[data-sel-toolbar],[data-frame-toolbar]')) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const skipGrid = e.ctrlKey || e.metaKey;
      const p = toSceneRef.current(e.clientX, e.clientY);
      const origin = snapPoint(p.x, p.y, skipGrid);
      session.current = {
        x0: origin.x,
        y0: origin.y,
        rawX1: p.x,
        rawY1: p.y,
        clientX0: e.clientX,
        clientY0: e.clientY,
        currentClientX: e.clientX,
        currentClientY: e.clientY,
        skipGrid,
        pointerId: e.pointerId,
      };
      const box = resolveFrameDrawBox(
        normalizeBox(origin.x, origin.y, origin.x, origin.y),
        Boolean(gridSnapRef.current && !skipGrid),
        gridSizeRef.current
      );
      setPreview(box);
      hitEl.setPointerCapture?.(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      const s = session.current;
      if (!s || e.pointerId !== s.pointerId) return;
      s.currentClientX = e.clientX;
      s.currentClientY = e.clientY;
      const skipGrid = e.ctrlKey || e.metaKey || s.skipGrid;
      const p = toSceneRef.current(e.clientX, e.clientY);
      s.rawX1 = p.x;
      s.rawY1 = p.y;
      const end = snapPoint(p.x, p.y, skipGrid);
      const box = resolveFrameDrawBox(
        normalizeBox(s.x0, s.y0, end.x, end.y),
        Boolean(gridSnapRef.current && !skipGrid),
        gridSizeRef.current
      );
      setPreview(box);
    };

    const finish = (e: PointerEvent) => {
      const s = session.current;
      if (!s || e.pointerId !== s.pointerId) return;
      session.current = null;
      setPreview(null);
      try {
        hitEl.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      // Same soft-click gate as ShapeDrawFeature — old 24×24 blocked high-zoom draws.
      const clientDist = Math.hypot(
        s.currentClientX - s.clientX0,
        s.currentClientY - s.clientY0
      );
      const skipGrid = e.ctrlKey || e.metaKey || s.skipGrid;
      const p = toSceneRef.current(e.clientX, e.clientY);
      const end = snapPoint(p.x, p.y, skipGrid);
      const box = resolveFrameDrawBox(
        normalizeBox(s.x0, s.y0, end.x, end.y),
        Boolean(gridSnapRef.current && !skipGrid),
        gridSizeRef.current
      );
      if (clientDist < 4 && box.width < 3 && box.height < 3) return;
      if (!(box.width >= 1 && box.height >= 1)) return;
      onCommitRef.current({
        x: box.left,
        y: box.top,
        width: box.width,
        height: box.height,
      });
    };

    hitEl.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      hitEl.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [enabled, stageEl, viewportEl]);

  if (!enabled || !preview) return null;

  const inv = 1 / Math.max(0.05, camera.zoom || 1);
  const labelFont = 10 * inv;
  const labelGap = 10 * inv;
  const showSize = preview.width >= 3 || preview.height >= 3;
  const previewMount = getSceneDrawPreviewMount();
  if (!previewMount) return null;
  // Same as idle plate: scene width = 1/zoom (CSS scale thickens non-scaling-stroke).
  const plateSw = framePlateStrokeSceneWidth(camera.zoom);

  return createPortal(
    <g data-frame-draw-preview pointerEvents="none" aria-hidden>
      <rect
        x={preview.left}
        y={preview.top}
        width={Math.max(1, preview.width)}
        height={Math.max(1, preview.height)}
        fill="#FFFFFF"
        stroke={FRAME_PLATE_STROKE}
        strokeWidth={plateSw}
        shapeRendering="crispEdges"
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
      {showSize ? (
        <text
          x={preview.left + preview.width / 2}
          y={preview.top - labelGap}
          fill="var(--muted)"
          fontSize={labelFont}
          fontWeight={500}
          textAnchor="middle"
          dominantBaseline="auto"
        >
          {Math.round(preview.width)}
          {' × '}
          {Math.round(preview.height)}
        </text>
      ) : null}
    </g>,
    previewMount
  );
}

export default memo(FrameDrawFeature);
