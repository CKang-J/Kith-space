/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/core/math.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { readDevicePixelRatio, snapCssToDevicePixel, toDomPrecision } from './dpr';
import type { RcbBox, RcbCamera, RcbVec } from './types';

/** Camera zoom floor / ceiling (5% … 10000%). */
export const RCB_MIN_ZOOM = 0.05;
export const RCB_MAX_ZOOM = 100;

export function rcbClampZoom(z: number) {
  return Math.min(RCB_MAX_ZOOM, Math.max(RCB_MIN_ZOOM, Number(z.toFixed(4))));
}

/**
 * CSS translate written on the camera world layer.
 * Snaps pan onto the device-pixel grid (browser zoom / fractional DPR) so the
 * whole world layer rasterizes together. Must match `RcbCanvas`.
 */
export function rcbCameraScreenOffset(
  camera: RcbCamera,
  dpr: number = readDevicePixelRatio()
): RcbVec {
  return {
    x: toDomPrecision(snapCssToDevicePixel(camera.x, dpr)),
    y: toDomPrecision(snapCssToDevicePixel(camera.y, dpr)),
  };
}

/** Browser zoom to 90%/110%/… → non-integer devicePixelRatio. */
export function rcbDprIsFractional(dpr: number): boolean {
  const d = dpr > 0 ? dpr : 1;
  return Math.abs(d - Math.round(d)) > 0.001;
}

/**
 * Scene-space SVG surface origin under fractional DPR.
 * Chooses origin so `(origin * zoom + cam)` lands on a device pixel, while
 * keeping CSS `left` === `viewBox` min — absolute scene content still maps to
 * `scene * zoom + cam`. At integer DPR (100% zoom) returns `scene` unchanged
 * so half-pixel stroke origins stay intact.
 */
export function rcbSnapSceneSurfaceOrigin(
  scene: number,
  zoom: number,
  camSnapped: number,
  dpr: number
): number {
  if (!rcbDprIsFractional(dpr)) return scene;
  const z = Math.max(0.05, zoom || 1);
  const screen = scene * z + camSnapped;
  const screenSnapped = snapCssToDevicePixel(screen, dpr);
  return (screenSnapped - camSnapped) / z;
}

/**
 * CSS `scale()` written on the camera world layer (`RcbCanvas` camZ).
 * Stage overlays must multiply by this — raw `camera.zoom` drifts on large scene X/Y.
 */
export function rcbCameraCssZoom(camera: RcbCamera): number {
  return toDomPrecision(Math.max(0.05, camera.zoom || 1));
}

export type RcbViewportMetrics = {
  rect: DOMRect;
  /** Visual CSS px per layout px (≈1 unless an ancestor has CSS scale / zoom). */
  scaleX: number;
  scaleY: number;
  clientWidth: number;
  clientHeight: number;
  connected: boolean;
};

/**
 * Map a client point into the stage's *layout* coordinate space (same space as
 * `camera.x/y` and CSS `translate` on the world layer).
 *
 * `getBoundingClientRect` is visual; `clientWidth` is layout. When they differ
 * (ancestor `transform: scale`, browser zoom quirks, stale detached node),
 * dividing by the ratio keeps the pointer on the ink.
 */
export function rcbViewportMetrics(viewportEl: HTMLElement): RcbViewportMetrics {
  const rect = viewportEl.getBoundingClientRect();
  const clientWidth = Math.max(0, viewportEl.clientWidth || 0);
  const clientHeight = Math.max(0, viewportEl.clientHeight || 0);
  const connected = typeof viewportEl.isConnected === 'boolean' ? viewportEl.isConnected : true;
  const scaleX =
    clientWidth > 0 && rect.width > 0 ? rect.width / clientWidth : 1;
  const scaleY =
    clientHeight > 0 && rect.height > 0 ? rect.height / clientHeight : 1;
  return { rect, scaleX, scaleY, clientWidth, clientHeight, connected };
}

/** Client → stage-local layout px (pre-camera). */
export function rcbClientToStageLocal(
  viewportEl: HTMLElement,
  clientX: number,
  clientY: number
): RcbVec & RcbViewportMetrics {
  const m = rcbViewportMetrics(viewportEl);
  const sx = m.scaleX > 0 ? m.scaleX : 1;
  const sy = m.scaleY > 0 ? m.scaleY : 1;
  return {
    ...m,
    x: (clientX - m.rect.left) / sx,
    y: (clientY - m.rect.top) / sy,
  };
}

/** Scene (page/world) -> screen/stage-local layout pixels. */
export function rcbSceneToScreen(
  camera: RcbCamera,
  sceneX: number,
  sceneY: number,
  dpr?: number
): RcbVec {
  const z = rcbCameraCssZoom(camera);
  const { x: camX, y: camY } = rcbCameraScreenOffset(camera, dpr);
  return {
    x: sceneX * z + camX,
    y: sceneY * z + camY,
  };
}

/** @see rcbSnapSceneSurfaceOrigin */
export function rcbSnapSceneAxis(
  scene: number,
  zoom: number,
  camSnapped: number,
  dpr?: number
): number {
  return rcbSnapSceneSurfaceOrigin(scene, zoom, camSnapped, dpr ?? readDevicePixelRatio());
}

/** Snap surface origin (CSS === viewBox); size unchanged. */
export function rcbSnapSceneBox(
  box: { left: number; top: number; width: number; height: number },
  camera?: RcbCamera,
  dpr?: number
): { left: number; top: number; width: number; height: number } {
  const d = dpr ?? readDevicePixelRatio();
  if (!camera || !rcbDprIsFractional(d)) {
    return {
      left: box.left,
      top: box.top,
      width: Math.max(1e-4, box.width),
      height: Math.max(1e-4, box.height),
    };
  }
  const z = rcbCameraCssZoom(camera);
  const { x: camX, y: camY } = rcbCameraScreenOffset(camera, d);
  return {
    left: rcbSnapSceneSurfaceOrigin(box.left, z, camX, d),
    top: rcbSnapSceneSurfaceOrigin(box.top, z, camY, d),
    width: Math.max(1e-4, box.width),
    height: Math.max(1e-4, box.height),
  };
}

/**
 * Screen/client -> scene (page/world).
 * viewportEl is the unscaled stage root.
 * Uses snapped camera pan (same as CSS world translate) + layout/visual scale.
 */
export function rcbScreenToScene(
  camera: RcbCamera,
  viewportEl: HTMLElement,
  clientX: number,
  clientY: number,
  dpr?: number
): RcbVec {
  const local = rcbClientToStageLocal(viewportEl, clientX, clientY);
  const z = rcbCameraCssZoom(camera);
  const { x: camX, y: camY } = rcbCameraScreenOffset(camera, dpr);
  return {
    x: (local.x - camX) / z,
    y: (local.y - camY) / z,
  };
}

/**
 * Client-pixel gesture delta -> scene units.
 * Pass the same scaleX/scaleY from `rcbViewportMetrics` at gesture start.
 */
export function rcbClientDeltaToScene(
  zoom: number,
  clientDx: number,
  clientDy: number,
  scaleX = 1,
  scaleY = 1
): RcbVec {
  const z = Math.max(0.05, zoom || 1);
  const sx = scaleX > 0 ? scaleX : 1;
  const sy = scaleY > 0 ? scaleY : 1;
  return { x: clientDx / sx / z, y: clientDy / sy / z };
}

/** On-screen pixel gap -> scene units. */
export function rcbScreenPxToScene(px: number, zoom: number) {
  return px / Math.max(0.05, zoom || 1);
}

/** Zoom about a stage-local point (keeps that screen point fixed). */
export function rcbZoomAtPoint(
  camera: RcbCamera,
  nextZoom: number,
  localX: number,
  localY: number
): RcbCamera {
  const z0 = camera.zoom;
  const z1 = rcbClampZoom(nextZoom);
  if (z0 === z1) return camera;
  // Use raw camera pan (state space). Display offset is precision-only (no DPR).
  const sceneX = (localX - camera.x) / z0;
  const sceneY = (localY - camera.y) / z0;
  return { zoom: z1, x: localX - sceneX * z1, y: localY - sceneY * z1 };
}

/** Fit scene bounds into the viewport (e.g. document open / Shift+1). */
export function rcbFitCamera(
  viewport: { width: number; height: number },
  bounds: { x?: number; y?: number; width: number; height: number },
  /** Screen-px margin on each side (top/right/bottom/left). */
  padding = 120,
  /** Cap so small scenes do not zoom past 100%. */
  maxZoom = 1
): RcbCamera {
  const vw = Math.max(1, viewport.width);
  const vh = Math.max(1, viewport.height);
  const aw = Math.max(1, bounds.width);
  const ah = Math.max(1, bounds.height);
  const ox = bounds.x || 0;
  const oy = bounds.y || 0;
  const pad = Math.max(0, padding);
  const cap = Math.max(RCB_MIN_ZOOM, Math.min(RCB_MAX_ZOOM, maxZoom));
  const availW = Math.max(1, vw - pad * 2);
  const availH = Math.max(1, vh - pad * 2);
  const zoom = rcbClampZoom(Math.min(availW / aw, availH / ah, cap));
  return {
    zoom,
    x: (vw - aw * zoom) / 2 - ox * zoom,
    y: (vh - ah * zoom) / 2 - oy * zoom,
  };
}

/** Visible scene AABB under the current camera. */
export function rcbViewportSceneBounds(
  camera: RcbCamera,
  stage: { width: number; height: number }
): RcbBox {
  const z = Math.max(0.05, camera.zoom || 1);
  return {
    x: -camera.x / z,
    y: -camera.y / z,
    width: Math.max(1, stage.width / z),
    height: Math.max(1, stage.height / z),
  };
}

/**
 * Quantize zoom while the camera is moving.
 * Keeps cull / LOD stable across tiny wheel deltas; idle uses true zoom.
 */
export function rcbStepZoom(zoom: number, step = 0.05): number {
  const z = Math.max(0.05, zoom || 1);
  const s = Math.max(0.01, step);
  return Math.round(Math.round(z / s) * s * 1e4) / 1e4;
}

/** Prefer a live, connected stage node (context beats a stale prop after resize). */
export function rcbResolveViewportEl(
  ...candidates: Array<HTMLElement | null | undefined>
): HTMLElement | null {
  for (const el of candidates) {
    if (el && el.isConnected) return el;
  }
  for (const el of candidates) {
    if (el) return el;
  }
  return null;
}
