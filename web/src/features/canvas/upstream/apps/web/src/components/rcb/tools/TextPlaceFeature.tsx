/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/tools/TextPlaceFeature.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useRef, useState, memo } from 'react';
import { useRcbCamera, useRcbScreenToScene } from '../camera/context';
import { rcbDefaultPlaceFontSize } from '../core/layout';

/** `dragDistanceSquared` default = 16 → 4px; fixed-width needs ~6× that. */
const BASE_DRAG_PX = 4;
const FIXED_WIDTH_DRAG_FACTOR = 6;
/** Pointing: ignore width-drag for the first 150ms (accidental wobble). */
const POINTING_GRACE_MS = 150;

export type TextPlacePoint = {
  x: number;
  y: number;
  /** Fixed wrap width when the user dragged horizontally (autoSize=false). */
  width?: number;
  autoSize: boolean;
};

type TextPlaceFeatureProps = {
  enabled: boolean;
  artboard: { width: number; height: number };
  paperEl: HTMLElement | null;
  stageEl?: HTMLElement | null;
  onPlace: (point: TextPlacePoint) => void;
};

/**
 * Text tool — `TextShapeTool` / `Pointing`:
 * - click → autoSize text + edit
 * - drag horizontally past threshold → fixed-width text + edit
 */
function TextPlaceFeature({
  enabled,
  paperEl,
  stageEl = null,
  onPlace,
}: TextPlaceFeatureProps) {
  const camera = useRcbCamera();
  const toScene = useRcbScreenToScene();
  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;
  const pointingRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
    enterAt: number;
  } | null>(null);
  const [preview, setPreview] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    const hitEl = stageEl || paperEl;
    if (!enabled || !hitEl) return undefined;

    const minDragForFixed = () => {
      const zoom = Math.max(0.05, camera.zoom || 1);
      return (BASE_DRAG_PX * FIXED_WIDTH_DRAG_FACTOR) / zoom;
    };

    const clear = () => {
      pointingRef.current = null;
      setPreview(null);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const t = e.target as Element | null;
      if (
        t?.closest?.(
          '[data-sel-toolbar],[data-frame-toolbar],[data-ctx-menu],[data-text-inline-editor],[data-image-tool-panel]'
        )
      ) {
        return;
      }
      const p = toScene(e.clientX, e.clientY);
      pointingRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        originX: p.x,
        originY: p.y,
        enterAt: Date.now(),
      };
      setPreview(null);
      try {
        hitEl.setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      e.preventDefault();
      e.stopPropagation();
    };

    const onMove = (e: PointerEvent) => {
      const pt = pointingRef.current;
      if (!pt || e.pointerId !== pt.pointerId) return;
      if (Date.now() - pt.enterAt < POINTING_GRACE_MS) return;
      const p = toScene(e.clientX, e.clientY);
      const dragDist = Math.abs(p.x - pt.originX);
      if (dragDist <= minDragForFixed()) {
        setPreview(null);
        return;
      }
      const left = Math.min(pt.originX, p.x);
      const width = Math.max(1, Math.abs(p.x - pt.originX));
      const zoom = Math.max(0.05, camera.zoom || 1);
      const fs = rcbDefaultPlaceFontSize(zoom, 14);
      setPreview({
        left,
        top: pt.originY,
        width,
        height: Math.max(1, Math.ceil(fs * 1.4)),
      });
    };

    const finish = (e: PointerEvent, commit: boolean) => {
      const pt = pointingRef.current;
      if (!pt || e.pointerId !== pt.pointerId) return;
      try {
        hitEl.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      pointingRef.current = null;
      setPreview(null);
      if (!commit) return;

      const p = toScene(e.clientX, e.clientY);
      const dragDist = Math.abs(p.x - pt.originX);
      const graceOk = Date.now() - pt.enterAt >= POINTING_GRACE_MS;
      if (graceOk && dragDist > minDragForFixed()) {
        const left = Math.min(pt.originX, p.x);
        onPlaceRef.current({
          x: left,
          y: pt.originY,
          width: Math.max(16, Math.round(dragDist)),
          autoSize: false,
        });
        return;
      }
      onPlaceRef.current({
        x: pt.originX,
        y: pt.originY,
        autoSize: true,
      });
    };

    const onUp = (e: PointerEvent) => finish(e, true);
    const onCancel = (e: PointerEvent) => finish(e, false);

    hitEl.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      hitEl.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      clear();
    };
  }, [enabled, paperEl, stageEl, toScene, camera.zoom]);

  if (!preview) return null;

  return (
    <div
      className="pointer-events-none absolute z-20 border border-dashed border-[#3388ff] bg-[rgba(51,136,255,0.06)]"
      style={{
        left: preview.left,
        top: preview.top,
        width: preview.width,
        height: preview.height,
      }}
    />
  );
}

export default memo(TextPlaceFeature);
