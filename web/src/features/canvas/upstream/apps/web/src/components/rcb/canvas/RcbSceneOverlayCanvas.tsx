/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/canvas/RcbSceneOverlayCanvas.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { forwardRef, memo, useImperativeHandle, useRef } from 'react';
import { rcbCameraCssZoom } from '../core/math';
import { useRcbCamera } from '../camera/context';

export type SceneOverlayBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type RcbSceneOverlayCanvasHandle = {
  /**
   * Size the bitmap to `box` (scene units) and return a ctx whose (0,0)
   * is the box top-left in scene space. Caller draws then finishes the frame.
   */
  beginFrame: (box: SceneOverlayBox) => CanvasRenderingContext2D | null;
  /** Clear and hide the canvas. */
  clear: () => void;
  getCanvas: () => HTMLCanvasElement | null;
};

type Props = {
  className?: string;
  /** Stacking relative to other world overlays. */
  zClass?: string;
};

type FrameSlot = {
  left: number;
  top: number;
  w: number;
  h: number;
  pw: number;
  ph: number;
};

/**
 * @deprecated Prefer scene-surface SVG (`sceneSurfaceSvgProps`) or
 * `mirrorHostSurface` for anything that must align under browser zoom.
 * Kept for rare non-alignment Path2D experiments; pen/pencil/path-edit
 * previews now paint SVG.
 *
 * If used: CSS box === scene units; bitmap is a separate paint pipeline.
 */
const RcbSceneOverlayCanvas = memo(
  forwardRef<RcbSceneOverlayCanvasHandle, Props>(function RcbSceneOverlayCanvas(
    { className, zClass = 'z-20' },
    ref
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const camera = useRcbCamera();
    const zoomRef = useRef(camera.zoom);
    const slotRef = useRef<FrameSlot | null>(null);
    zoomRef.current = rcbCameraCssZoom(camera);

    useImperativeHandle(
      ref,
      () => ({
        getCanvas: () => canvasRef.current,
        clear: () => {
          const canvas = canvasRef.current;
          slotRef.current = null;
          if (!canvas) return;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          }
          canvas.style.display = 'none';
        },
        beginFrame: (box) => {
          const canvas = canvasRef.current;
          if (!canvas) return null;
          const z = zoomRef.current;
          const w = Math.max(1, box.width);
          const h = Math.max(1, box.height);
          // World layer already CSS-scales by z; bake z into the bitmap only.
          const scale = z;
          const pw = Math.max(1, Math.round(w * scale));
          const ph = Math.max(1, Math.round(h * scale));
          const sx = pw / w;
          const sy = ph / h;
          const prev = slotRef.current;
          const sameSlot =
            prev &&
            prev.pw === pw &&
            prev.ph === ph &&
            prev.w === w &&
            prev.h === h &&
            prev.left === box.left &&
            prev.top === box.top;
          if (!sameSlot) {
            canvas.width = pw;
            canvas.height = ph;
            canvas.style.left = `${box.left}px`;
            canvas.style.top = `${box.top}px`;
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;
            canvas.style.transform = '';
            slotRef.current = { left: box.left, top: box.top, w, h, pw, ph };
          }
          canvas.style.display = 'block';
          const ctx = canvas.getContext('2d');
          if (!ctx) return null;
          ctx.setTransform(sx, 0, 0, sy, 0, 0);
          ctx.clearRect(0, 0, w, h);
          ctx.translate(-box.left, -box.top);
          return ctx;
        },
      }),
      []
    );

    return (
      <canvas
        ref={canvasRef}
        className={
          className
            ? `pointer-events-none absolute overflow-visible ${zClass} ${className}`
            : `pointer-events-none absolute overflow-visible ${zClass}`
        }
        width={1}
        height={1}
        style={{ left: 0, top: 0, display: 'none' }}
        aria-hidden
      />
    );
  })
);

export default RcbSceneOverlayCanvas;
