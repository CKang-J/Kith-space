/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/tools/PencilDrawFeature.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useRef, useState, memo, type ReactNode } from 'react';
import { createPortal } from '@/features/canvas/adapters/recombynReactDom';
import {
  brushPad,
  brushSize,
  DEFAULT_PENCIL_BRUSH_ID,
  findPencilBrush,
  interpolateStrokeGaps,
  outlinePathFromPoints,
  pencilSampleMinStep,
  polylinePathD,
  serializePathPressures,
  STROKE_GAP_INTERP,
  type PencilBrushId,
} from './pencilBrushes';
import {
  rcbCameraCssZoom,
  rcbCameraScreenOffset,
  rcbResolveViewportEl,
  rcbScreenToScene,
  rcbViewportMetrics,
} from '../core/math';
import {
  useRcbCamera,
  useRcbViewportEl,
} from '../camera/context';
import {
  type RcbCamera as CanvasCamera,
} from '../core/types';
import {
  getSceneDrawPreviewMount,
  getSceneWorldEpoch,
  subscribeShapeHosts,
} from '../shapes/shapeHostRegistry';

type SceneBox = { left: number; top: number; width: number; height: number };

type PencilPreview =
  | {
      box: SceneBox;
      mode: 'erase';
      trailD: string;
      tip: { x: number; y: number } | null;
      tipR: number;
      trailW: number;
      tipStroke: number;
      tipDash: string;
    }
  | {
      box: SceneBox;
      mode: 'ink';
      pathD: string;
      color: string;
      opacity: number;
    };

import pencilCursorUrl from '@recombyn-native/assets/svg/editor/cursor_pencil.svg?url';
import eraserCursorUrl from '@recombyn-native/assets/svg/editor/cursor_eraser.svg?url';
import penCursorUrl from '@recombyn-native/assets/svg/editor/cursor_pen.svg?url';
import bucketCursorUrl from '@recombyn-native/assets/svg/editor/cursor_bucket.svg?url';

/** CSS cursors — icons in `assets/svg/editor/cursor_*.svg` (hotspot = tip). */
export const PENCIL_CURSOR = `url("${pencilCursorUrl}") 2 13, crosshair`;
export const ERASER_CURSOR = `url("${eraserCursorUrl}") 3 15, crosshair`;
/** Pen nib is at viewBox (2,2) on 24→18 CSS: hotspot ≈ (1.5,1.5) → use 2 2 was ~0.5px late; 1 1 tracks the tip. */
export const PEN_CURSOR = `url("${penCursorUrl}") 1 1, crosshair`;
export const BUCKET_CURSOR = `url("${bucketCursorUrl}") 15 18, fill`;

function clientToPaperScene(
  paperEl: HTMLElement | null,
  artboard: { x?: number; y?: number; width: number; height: number },
  clientX: number,
  clientY: number
) {
  if (!paperEl) return { x: 0, y: 0 };
  const rect = paperEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return { x: 0, y: 0 };
  const w = Math.max(1, artboard.width);
  const h = Math.max(1, artboard.height);
  const ox = Number(artboard.x) || 0;
  const oy = Number(artboard.y) || 0;
  return {
    x: ox + ((clientX - rect.left) / rect.width) * w,
    y: oy + ((clientY - rect.top) / rect.height) * h,
  };
}

function clientToDrawScene(
  opts: {
    stageEl: HTMLElement | null;
    paperEl: HTMLElement | null;
    artboard: { width: number; height: number };
    camera: CanvasCamera;
  },
  clientX: number,
  clientY: number
) {
  // Prefer a *connected* stage — prop can go stale after resize remounts.
  const stage = rcbResolveViewportEl(opts.stageEl);
  if (stage) return rcbScreenToScene(opts.camera, stage, clientX, clientY);
  return clientToPaperScene(opts.paperEl, opts.artboard, clientX, clientY);
}

/** Stable scene rect covering the current viewport (for stroke preview — avoids per-point shell resize jitter). */
function visibleSceneOverlayBox(
  camera: CanvasCamera,
  stageEl: HTMLElement | null
): SceneBox | null {
  const stage = rcbResolveViewportEl(stageEl);
  if (!stage) return null;
  const { clientWidth, clientHeight } = rcbViewportMetrics(stage);
  if (!(clientWidth > 0 && clientHeight > 0)) return null;
  const z = rcbCameraCssZoom(camera);
  const { x: camX, y: camY } = rcbCameraScreenOffset(camera);
  const pad = 48 / z;
  return {
    left: (-camX) / z - pad,
    top: (-camY) / z - pad,
    width: clientWidth / z + pad * 2,
    height: clientHeight / z + pad * 2,
  };
}

function unionSceneOverlayBox(a: SceneBox, b: SceneBox): SceneBox {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  const right = Math.max(a.left + a.width, b.left + b.width);
  const bottom = Math.max(a.top + a.height, b.top + b.height);
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

export type PencilEraseTarget = {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PencilEraseStroke = {
  /** Eraser centerline in scene/paper coords. */
  points: { x: number; y: number }[];
  /** Eraser brush radius (half of UI stroke width). */
  radius: number;
};

type PencilDrawFeatureProps = {
  enabled: boolean;
  artboard: { width: number; height: number };
  paperEl: HTMLElement | null;
  /** Full viewport stage — when set, drawing works anywhere on screen (not only SVG paper). */
  stageEl?: HTMLElement | null;
  strokeColor?: string;
  strokeWidth?: number;
  /** 0–1 preview opacity while painting. */
  strokeOpacity?: number;
  brushId?: PencilBrushId | string;
  /** Use stylus/touch pressure and brush speed simulation. */
  pressureEnabled?: boolean;
  /** Tip hardness 0–100. */
  hardness?: number;
  /** Erase ink under the brush instead of drawing. */
  eraseMode?: boolean;
  eraseTargets?: PencilEraseTarget[];
  onCommit: (
    pathD: string,
    box: { left: number; top: number; width: number; height: number },
    meta?: { pathPressure?: string; brushHardness?: number }
  ) => void;
  onErase?: (stroke: PencilEraseStroke) => void;
};

function pointerPressure(e: PointerEvent): number | undefined {
  // Real hardware pressure only (pen / touch). Mouse always undefined → constant width.
  // Allow 0 (lightest) — do not invent speed-based pressure.
  if (e.pointerType !== 'pen' && e.pointerType !== 'touch') return undefined;
  const p = Number(e.pressure);
  if (!Number.isFinite(p)) return undefined;
  return Math.min(1, Math.max(0, p));
}

function eraseTargetsNearStroke(
  points: { x: number; y: number }[],
  radius: number,
  targets: PencilEraseTarget[]
): boolean {
  if (!points.length || !targets.length) return false;
  // Pad by tip + slack so thick ink near the node AABB edge still qualifies.
  const pad = Math.max(radius * 2, radius + 24);
  for (const t of targets) {
    const l = t.left - pad;
    const r = t.left + t.width + pad;
    const top = t.top - pad;
    const b = t.top + t.height + pad;
    for (const p of points) {
      if (p.x >= l && p.x <= r && p.y >= top && p.y <= b) return true;
    }
  }
  return false;
}

/** Freehand pencil → store baseline centerline; paint filled ink centered on that path. */
function PencilDrawFeature({
  enabled,
  artboard,
  paperEl,
  stageEl = null,
  strokeColor = '#333333',
  strokeWidth = 10,
  strokeOpacity = 1,
  brushId = DEFAULT_PENCIL_BRUSH_ID,
  pressureEnabled = true,
  hardness = 80,
  eraseMode = false,
  eraseTargets = [],
  onCommit,
  onErase,
}: PencilDrawFeatureProps) {
  const camera = useRcbCamera();
  const viewportEl = useRcbViewportEl();
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const pts = useRef<{ x: number; y: number; pressure?: number }[]>([]);
  const drawing = useRef(false);
  /** Locked overlay viewport for the active stroke — stops per-point shell resize jitter. */
  const strokeViewBoxRef = useRef<SceneBox | null>(null);
  const redrawRafRef = useRef(0);
  const redrawOverlayRef = useRef<() => void>(() => {});
  const [preview, setPreview] = useState<PencilPreview | null>(null);
  /** Bump when shared world SVG remounts so portals retarget. */
  const [, setWorldEpoch] = useState(() => getSceneWorldEpoch());
  const lastTipPosRef = useRef<{ x: number; y: number } | null>(null);
  const brushRef = useRef(brushId);
  const widthRef = useRef(strokeWidth);
  const colorRef = useRef(strokeColor);
  const opacityRef = useRef(strokeOpacity);
  const pressureRef = useRef(pressureEnabled);
  const hardnessRef = useRef(hardness);
  const eraseModeRef = useRef(eraseMode);
  const eraseTargetsRef = useRef(eraseTargets);
  const onEraseRef = useRef(onErase);
  brushRef.current = brushId;
  widthRef.current = strokeWidth;
  colorRef.current = strokeColor;
  opacityRef.current = Math.min(1, Math.max(0, strokeOpacity));
  pressureRef.current = pressureEnabled;
  hardnessRef.current = hardness;
  eraseModeRef.current = eraseMode;
  eraseTargetsRef.current = eraseTargets;
  onEraseRef.current = onErase;

  const liveStage = rcbResolveViewportEl(viewportEl, stageEl);
  const paperElRef = useRef(paperEl);
  const artboardRef = useRef(artboard);
  const liveStageRef = useRef(liveStage);
  paperElRef.current = paperEl;
  artboardRef.current = artboard;
  liveStageRef.current = liveStage;

  const toScene = (clientX: number, clientY: number) =>
    clientToDrawScene(
      {
        stageEl: liveStageRef.current,
        paperEl: paperElRef.current,
        artboard: artboardRef.current,
        camera: cameraRef.current,
      },
      clientX,
      clientY
    );
  const toSceneRef = useRef(toScene);
  toSceneRef.current = toScene;

  /** Eraser tip — same diameter for cursor ring, trail, and commit (matches UI Px). */
  const eraseTipDiameter = () => Math.max(1, Number(widthRef.current) || 1);
  const eraseTipRadius = () => eraseTipDiameter() / 2;
  const eraseTipRadiusRef = useRef(eraseTipRadius);
  eraseTipRadiusRef.current = eraseTipRadius;

  const pointsBounds = (
    points: Array<{ x: number; y: number }>,
    pad: number
  ) => {
    if (!points.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return {
      left: minX - pad,
      top: minY - pad,
      width: Math.max(1, maxX - minX + pad * 2),
      height: Math.max(1, maxY - minY + pad * 2),
    };
  };

  const redrawOverlay = () => {
    const zoom = Math.max(0.05, cameraRef.current.zoom || 1);
    const tip = lastTipPosRef.current;
    const points = pts.current;
    const pad = Math.max(
      eraseTipDiameter(),
      brushSize(findPencilBrush(brushRef.current), widthRef.current),
      8
    );
    const all: Array<{ x: number; y: number }> = [...points];
    if (tip) all.push(tip);
    const contentBox = pointsBounds(all, pad);
    if (!contentBox) {
      setPreview(null);
      strokeViewBoxRef.current = null;
      return;
    }
    let box = contentBox;
    if (drawing.current) {
      let view = strokeViewBoxRef.current;
      if (!view) {
        view =
          visibleSceneOverlayBox(cameraRef.current, liveStageRef.current) ||
          unionSceneOverlayBox(contentBox, {
            left: contentBox.left - 256,
            top: contentBox.top - 256,
            width: contentBox.width + 512,
            height: contentBox.height + 512,
          });
        strokeViewBoxRef.current = view;
      } else if (
        contentBox.left < view.left ||
        contentBox.top < view.top ||
        contentBox.left + contentBox.width > view.left + view.width ||
        contentBox.top + contentBox.height > view.top + view.height
      ) {
        view = unionSceneOverlayBox(view, contentBox);
        strokeViewBoxRef.current = view;
      }
      box = view;
    }

    if (eraseModeRef.current) {
      setPreview({
        box,
        mode: 'erase',
        trailD: points.length >= 2 ? polylinePathD(points) : '',
        tip,
        tipR: eraseTipRadius(),
        trailW: eraseTipDiameter(),
        tipStroke: 1.25 / zoom,
        tipDash: `${3 / zoom} ${2 / zoom}`,
      });
      return;
    }

    if (points.length < 2) {
      setPreview(null);
      return;
    }
    const brush = findPencilBrush(brushRef.current);

    // Same SVG ribbon as commit — tip stamps used a canvas bake that lagged + jittered.
    const pressures = points.map((p) => p.pressure);
    const hasPressure = pressures.some((p) => typeof p === 'number' && Number.isFinite(p));
    const d = outlinePathFromPoints(points, widthRef.current, brush.id, {
      pressureEnabled: pressureRef.current,
      hardness: hardnessRef.current,
      simplify: false,
      pressures: hasPressure
        ? pressures.map((p) => (typeof p === 'number' && Number.isFinite(p) ? p : 0.5))
        : undefined,
    });
    setPreview({
      box,
      mode: 'ink',
      pathD: d,
      color: colorRef.current,
      opacity: opacityRef.current,
    });
  };
  redrawOverlayRef.current = redrawOverlay;

  const paintTipCursor = (p: { x: number; y: number } | null) => {
    if (!eraseModeRef.current) {
      if (!p) lastTipPosRef.current = null;
      if (drawing.current) return;
      redrawOverlay();
      return;
    }
    lastTipPosRef.current = p;
    redrawOverlay();
  };

  const paintPreview = (points: { x: number; y: number; pressure?: number }[]) => {
    pts.current = points;
    if (redrawRafRef.current) {
      window.cancelAnimationFrame(redrawRafRef.current);
      redrawRafRef.current = 0;
    }
    redrawOverlay();
  };

  const paintEraseTrail = (points: { x: number; y: number }[]) => {
    // pts.current already holds erase points while drawing; force redraw.
    void points;
    redrawOverlay();
  };

  const paintTipCursorRef = useRef(paintTipCursor);
  const paintPreviewRef = useRef(paintPreview);
  const paintEraseTrailRef = useRef(paintEraseTrail);
  paintTipCursorRef.current = paintTipCursor;
  paintPreviewRef.current = paintPreview;
  paintEraseTrailRef.current = paintEraseTrail;

  useEffect(() => {
    const hitEl = rcbResolveViewportEl(viewportEl, stageEl, paperEl);
    if (!enabled || !hitEl) return undefined;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // Ignore chrome / overlays outside the canvas stage content.
      const t = e.target as Element | null;
      if (t?.closest?.('[data-sel-toolbar],[data-frame-toolbar],[data-ctx-menu],[data-image-tool-panel],[data-shape-style-panel]')) {
        return;
      }
      const p = toSceneRef.current(e.clientX, e.clientY);
      const pressure = pressureRef.current ? pointerPressure(e) : undefined;
      drawing.current = true;
      strokeViewBoxRef.current = null;
      pts.current = [pressure != null ? { ...p, pressure } : p];
      if (eraseModeRef.current) {
        paintTipCursorRef.current(p);
        paintEraseTrailRef.current(pts.current);
      } else {
        paintTipCursorRef.current(p);
        paintPreviewRef.current(pts.current);
      }
      hitEl.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    };

    // Absolute screen→scene each sample (same as pen). Delta+frozen scale drifted
    // under layout/DPR changes; live EMA also lagged the tip behind the cursor.
    const sampleScenePoint = (e: PointerEvent) => toSceneRef.current(e.clientX, e.clientY);

    const appendStrokePoint = (raw: {
      x: number;
      y: number;
      pressure?: number;
    }) => {
      const brush = findPencilBrush(brushRef.current);
      const minStep = pencilSampleMinStep(widthRef.current, brush);
      const last = pts.current[pts.current.length - 1];
      if (last && Math.hypot(raw.x - last.x, raw.y - last.y) < minStep) {
        return false;
      }
      // Live path tracks the tip; polish with streamline only on commit.
      const next = raw;
      // Gap fill so sparse tablet events still keep a continuous centerline.
      if (last && Math.hypot(next.x - last.x, next.y - last.y) > STROKE_GAP_INTERP) {
        const filled = interpolateStrokeGaps([last, next], STROKE_GAP_INTERP);
        for (let i = 1; i < filled.length; i += 1) pts.current.push(filled[i]);
      } else {
        pts.current.push(next);
      }
      return true;
    };

    const onMove = (e: PointerEvent) => {
      if (!drawing.current) {
        paintTipCursorRef.current(toSceneRef.current(e.clientX, e.clientY));
        return;
      }
      const coalesced =
        typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const events = coalesced.length ? coalesced : [e];
      let changed = false;
      let tip = pts.current[pts.current.length - 1] || toSceneRef.current(e.clientX, e.clientY);
      for (const ev of events) {
        const p = sampleScenePoint(ev);
        tip = p;
        const pressure = pressureRef.current ? pointerPressure(ev) : undefined;
        const pt = pressure != null ? { ...p, pressure } : p;
        if (eraseModeRef.current) {
          const last = pts.current[pts.current.length - 1];
          const minStep = Math.max(0.12, eraseTipRadiusRef.current() * 0.15);
          if (last && Math.hypot(p.x - last.x, p.y - last.y) < minStep) {
            continue;
          }
          pts.current.push(pt);
          changed = true;
        } else if (appendStrokePoint(pt)) {
          changed = true;
        }
      }
      paintTipCursorRef.current(tip);
      if (!changed) return;
      if (eraseModeRef.current) paintEraseTrailRef.current(pts.current);
      else paintPreviewRef.current(pts.current);
    };

    const onMoveWhileDrawing = (e: PointerEvent) => {
      if (!drawing.current) return;
      onMove(e);
    };

    const onMoveIdle = (e: PointerEvent) => {
      if (drawing.current) return;
      paintTipCursorRef.current(toSceneRef.current(e.clientX, e.clientY));
    };

    const finishStroke = (e: PointerEvent, commit: boolean) => {
      if (!drawing.current) return;
      drawing.current = false;
      strokeViewBoxRef.current = null;
      if (redrawRafRef.current) {
        window.cancelAnimationFrame(redrawRafRef.current);
        redrawRafRef.current = 0;
      }
      try {
        hitEl.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      setPreview(null);
      const wasErase = eraseModeRef.current;
      // Pin the last sample to the tip — do not streamline/simplify here.
      // Live preview draws raw points; polish on up made sharp kinks vs preview.
      if (!wasErase && pts.current.length >= 1) {
        const tip = toSceneRef.current(e.clientX, e.clientY);
        const pressure = pressureRef.current ? pointerPressure(e) : undefined;
        const last = pts.current[pts.current.length - 1];
        if (Math.hypot(tip.x - last.x, tip.y - last.y) > 0.05) {
          pts.current.push(
            pressure != null ? { ...tip, pressure } : tip
          );
        } else {
          pts.current[pts.current.length - 1] = {
            x: tip.x,
            y: tip.y,
            ...(pressure != null ? { pressure } : {}),
          };
        }
      }
      const points = pts.current;
      pts.current = [];
      if (!wasErase) paintTipCursorRef.current(null);
      else paintTipCursorRef.current(toSceneRef.current(e.clientX, e.clientY));
      redrawOverlayRef.current();
      if (wasErase) {
        if (
          commit &&
          points.length >= 1 &&
          eraseTargetsNearStroke(points, eraseTipRadiusRef.current(), eraseTargetsRef.current)
        ) {
          onEraseRef.current?.({
            points,
            radius: eraseTipRadiusRef.current(),
          });
        }
        return;
      }
      if (!commit || points.length < 2) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      points.forEach((pt) => {
        minX = Math.min(minX, pt.x);
        minY = Math.min(minY, pt.y);
        maxX = Math.max(maxX, pt.x);
        maxY = Math.max(maxY, pt.y);
      });
      const brush = findPencilBrush(brushRef.current);
      const pad = brushPad(brush, widthRef.current);
      const originX = minX - pad;
      const originY = minY - pad;
      const local = points.map((pt) => ({
        x: pt.x - originX,
        y: pt.y - originY,
        ...(pt.pressure != null ? { pressure: pt.pressure } : {}),
      }));
      // Same centerline as live preview (no pressure EMA / RDP polish).
      const d = polylinePathD(local);
      const pathPressure = pressureRef.current ? serializePathPressures(local) : undefined;
      onCommit(
        d,
        {
          left: originX,
          top: originY,
          width: Math.max(1, maxX - minX + pad * 2),
          height: Math.max(1, maxY - minY + pad * 2),
        },
        {
          ...(pathPressure ? { pathPressure } : {}),
          brushHardness: hardnessRef.current,
        }
      );
    };

    const onUp = (e: PointerEvent) => finishStroke(e, true);
    const onCancel = (e: PointerEvent) => finishStroke(e, false);
    const onLeave = () => {
      if (!drawing.current) paintTipCursorRef.current(null);
    };

    hitEl.addEventListener('pointerdown', onDown, true);
    hitEl.addEventListener('pointermove', onMoveIdle);
    // Window move/up while drawing — stage-only move drops samples when the
    // pointer briefly leaves / is coalesced away (feels choppy / broken).
    window.addEventListener('pointermove', onMoveWhileDrawing);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    hitEl.addEventListener('pointerleave', onLeave);
    return () => {
      hitEl.removeEventListener('pointerdown', onDown, true);
      hitEl.removeEventListener('pointermove', onMoveIdle);
      window.removeEventListener('pointermove', onMoveWhileDrawing);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      hitEl.removeEventListener('pointerleave', onLeave);
      paintTipCursorRef.current(null);
    };
  }, [enabled, stageEl, paperEl, viewportEl, onCommit]);

  useEffect(() => {
    if (!eraseMode) {
      lastTipPosRef.current = null;
      redrawOverlayRef.current();
    }
  }, [eraseMode]);

  // Refresh tip radius / trail width when slider changes (even if pointer is idle).
  useEffect(() => {
    if (!eraseMode) return;
    redrawOverlayRef.current();
  }, [strokeWidth, eraseMode, camera.zoom]);

  useEffect(
    () =>
      subscribeShapeHosts(() => {
        setWorldEpoch((prev) => {
          const next = getSceneWorldEpoch();
          return prev === next ? prev : next;
        });
      }),
    []
  );

  if (!enabled) return null;

  const previewMount = getSceneDrawPreviewMount();

  let previewPortal: ReactNode = null;
  if (preview?.mode === 'erase' && previewMount) {
    previewPortal = createPortal(
      <g data-pencil-draw-preview pointerEvents="none" aria-hidden>
        {preview.trailD ? (
          <path
            d={preview.trailD}
            fill="none"
            stroke="rgba(20,20,20,0.28)"
            strokeWidth={preview.trailW}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {preview.tip ? (
          <circle
            cx={preview.tip.x}
            cy={preview.tip.y}
            r={preview.tipR}
            fill="rgba(20,20,20,0.12)"
            stroke="rgba(20,20,20,0.85)"
            strokeWidth={preview.tipStroke}
            strokeDasharray={preview.tipDash}
          />
        ) : null}
      </g>,
      previewMount
    );
  } else if (preview?.mode === 'ink' && previewMount) {
    previewPortal = createPortal(
      <g data-pencil-draw-preview pointerEvents="none" aria-hidden>
        <path
          d={preview.pathD}
          fill={preview.color}
          fillOpacity={preview.opacity}
          stroke="none"
        />
      </g>,
      previewMount
    );
  }

  return previewPortal;
}

export default memo(PencilDrawFeature);
