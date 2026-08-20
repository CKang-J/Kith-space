/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ShapeNode/GradientHandlesOverlay.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, memo } from 'react';
import {
  RcbOverlayPortal,
  useRcbCamera,
  rcbSceneToScreen,
} from '@recombyn-native/components/rcb';
import {
  linearAngleFromEndpoints,
  resolveLinearCoords,
  type FillGradient,
  type FillStop,
} from '@recombyn-native/components/rcb/scene/document/sceneFill';
import { normalizeHex } from '@recombyn-native/components/base/colorPanel';

type SceneBox = { left: number; top: number; width: number; height: number };

type Props = {
  box: SceneBox;
  /** Node rotation in degrees (around box center). */
  angle?: number;
  gradient: FillGradient;
  onChange: (next: FillGradient) => void;
  /** Notify panel which stop is being edited. */
  onActiveStopChange?: (index: number) => void;
};

type DragKind =
  | { kind: 'linear-end'; end: 'start' | 'end' }
  | { kind: 'linear-stop'; index: number }
  | { kind: 'radial-center' }
  | { kind: 'radial-radius' }
  | { kind: 'radial-stop'; index: number }
  | { kind: 'angular-stop'; index: number };

const HANDLE = 12;
const TRACK = 'rgba(255,255,255,0.92)';
const RING = 'rgba(15,23,42,0.55)';

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function rotateLocal(
  lx: number,
  ly: number,
  w: number,
  h: number,
  angleDeg: number
): { x: number; y: number } {
  if (!angleDeg) return { x: lx, y: ly };
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = w / 2;
  const cy = h / 2;
  const dx = lx - cx;
  const dy = ly - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

function unrotateLocal(
  lx: number,
  ly: number,
  w: number,
  h: number,
  angleDeg: number
): { x: number; y: number } {
  return rotateLocal(lx, ly, w, h, -angleDeg);
}

function stopColor(stop: FillStop | undefined): string {
  return normalizeHex(stop?.color || '#ffffff', '#ffffff');
}

function projectOffset(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return 0;
  return clamp01(((px - x1) * dx + (py - y1) * dy) / len2);
}

/** On-canvas linear / radial / angular gradient editors (world-space overlay). */
function GradientHandlesOverlay({
  box,
  angle = 0,
  gradient,
  onChange,
  onActiveStopChange,
}: Props): ReactNode {
  const camera = useRcbCamera();
  const z = Math.max(0.05, camera.zoom || 1);
  const dragRef = useRef<DragKind | null>(null);
  const gradRef = useRef(gradient);
  const onChangeRef = useRef(onChange);
  const onActiveRef = useRef(onActiveStopChange);
  gradRef.current = gradient;
  onChangeRef.current = onChange;
  onActiveRef.current = onActiveStopChange;

  const origin = rcbSceneToScreen(camera, box.left, box.top);
  const stageW = box.width * z;
  const stageH = box.height * z;
  const w = box.width;
  const h = box.height;

  const toLocal = (clientX: number, clientY: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return { x: 0, y: 0 };
    // Normalize by the painted box — more stable than /zoom when CSS width
    // rounds differently from `box * z` on small / fractional viewports.
    const sx = ((clientX - rect.left) / rect.width) * w;
    const sy = ((clientY - rect.top) / rect.height) * h;
    return unrotateLocal(sx, sy, w, h, angle);
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const root = document.querySelector('[data-gradient-handles]') as HTMLElement | null;
      if (!root) return;
      const p = toLocal(e.clientX, e.clientY, root);
      const g = gradRef.current;
      const stops = [...(g.colorStops || [])];

      if (drag.kind === 'linear-end') {
        const c = resolveLinearCoords(g);
        let x1 = c.x1 * 100;
        let y1 = c.y1 * 100;
        let x2 = c.x2 * 100;
        let y2 = c.y2 * 100;
        const nx = (p.x / Math.max(1, w)) * 100;
        const ny = (p.y / Math.max(1, h)) * 100;
        if (drag.end === 'start') {
          x1 = nx;
          y1 = ny;
        } else {
          x2 = nx;
          y2 = ny;
        }
        // Keep a minimum segment so the gradient doesn't collapse.
        const dx = ((x2 - x1) / 100) * w;
        const dy = ((y2 - y1) / 100) * h;
        if (Math.hypot(dx, dy) < 4) return;
        const nextAngle = linearAngleFromEndpoints(x1, y1, x2, y2, w, h);
        onChangeRef.current({
          ...g,
          x1: Number(x1.toFixed(2)),
          y1: Number(y1.toFixed(2)),
          x2: Number(x2.toFixed(2)),
          y2: Number(y2.toFixed(2)),
          angle: Number(nextAngle.toFixed(2)),
        });
        return;
      }

      if (drag.kind === 'linear-stop') {
        const c = resolveLinearCoords(g);
        const x1 = c.x1 * w;
        const y1 = c.y1 * h;
        const x2 = c.x2 * w;
        const y2 = c.y2 * h;
        const offset = projectOffset(p.x, p.y, x1, y1, x2, y2);
        stops[drag.index] = { ...stops[drag.index], offset };
        stops.sort((a, b) => a.offset - b.offset);
        onChangeRef.current({ ...g, colorStops: stops });
        return;
      }

      if (drag.kind === 'radial-center') {
        onChangeRef.current({
          ...g,
          cx: Math.max(0, Math.min(100, (p.x / w) * 100)),
          cy: Math.max(0, Math.min(100, (p.y / h) * 100)),
        });
        return;
      }

      if (drag.kind === 'radial-radius') {
        const cx = ((g.cx ?? 50) / 100) * w;
        const cy = ((g.cy ?? 50) / 100) * h;
        const dist = Math.hypot(p.x - cx, p.y - cy);
        // Match SVG objectBoundingBox: r% of the unit box → use height for vertical axis.
        const nextR = Math.max(1, Math.min(150, (dist / Math.max(1, h)) * 100));
        onChangeRef.current({ ...g, r: Number(nextR.toFixed(2)) });
        return;
      }

      if (drag.kind === 'radial-stop') {
        const cx = ((g.cx ?? 50) / 100) * w;
        const cy = ((g.cy ?? 50) / 100) * h;
        const rPct = Math.max(1, g.r ?? 50);
        const maxDist = (rPct / 100) * h;
        const dist = Math.hypot(p.x - cx, p.y - cy);
        const offset = clamp01(dist / Math.max(1e-6, maxDist));
        stops[drag.index] = { ...stops[drag.index], offset };
        stops.sort((a, b) => a.offset - b.offset);
        onChangeRef.current({ ...g, colorStops: stops });
        return;
      }

      if (drag.kind === 'angular-stop') {
        const cx = ((g.cx ?? 50) / 100) * w;
        const cy = ((g.cy ?? 50) / 100) * h;
        const start = g.angle ?? 0;
        let deg = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI;
        // Align with bakeAngularGradientDataUrl: start = (angle - 90).
        let rel = deg - (start - 90);
        while (rel < 0) rel += 360;
        while (rel >= 360) rel -= 360;
        const offset = clamp01(rel / 360);
        stops[drag.index] = { ...stops[drag.index], offset };
        stops.sort((a, b) => a.offset - b.offset);
        onChangeRef.current({ ...g, colorStops: stops });
      }
    };

    const onUp = () => {
      dragRef.current = null;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [w, h, angle, z]);

  const handleStyle = (fill: string): CSSProperties => ({
    position: 'absolute',
    width: HANDLE,
    height: HANDLE,
    marginLeft: -HANDLE / 2,
    marginTop: -HANDLE / 2,
    borderRadius: '50%',
    background: fill,
    border: `2px solid ${TRACK}`,
    boxShadow: `0 0 0 1px ${RING}, 0 1px 4px rgba(0,0,0,0.25)`,
    cursor: 'grab',
    pointerEvents: 'auto',
    zIndex: 2,
  });

  const startDrag = (kind: DragKind, stopIndex?: number) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = kind;
    if (stopIndex != null) onActiveRef.current?.(stopIndex);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const type = gradient.type;
  const stops = gradient.colorStops || [];

  let body: ReactNode = null;

  if (type === 'linear') {
    const c = resolveLinearCoords(gradient);
    const pts = stops.map((s) => {
      const t = clamp01(s.offset);
      const lx = (c.x1 + (c.x2 - c.x1) * t) * w;
      const ly = (c.y1 + (c.y2 - c.y1) * t) * h;
      return { ...rotateLocal(lx, ly, w, h, angle), stop: s };
    });
    const start = rotateLocal(c.x1 * w, c.y1 * h, w, h, angle);
    const end = rotateLocal(c.x2 * w, c.y2 * h, w, h, angle);

    body = (
      <>
        <svg
          className="pointer-events-none absolute inset-0 overflow-visible"
          width={stageW}
          height={stageH}
        >
          <line
            x1={start.x * z}
            y1={start.y * z}
            x2={end.x * z}
            y2={end.y * z}
            stroke={TRACK}
            strokeWidth={2}
            strokeLinecap="round"
          />
          <line
            x1={start.x * z}
            y1={start.y * z}
            x2={end.x * z}
            y2={end.y * z}
            stroke={RING}
            strokeWidth={1}
            strokeLinecap="round"
            opacity={0.5}
          />
        </svg>
        <div
          style={{ ...handleStyle(stopColor(stops[0])), left: start.x * z, top: start.y * z }}
          onPointerDown={startDrag({ kind: 'linear-end', end: 'start' }, 0)}
        />
        <div
          style={{
            ...handleStyle(stopColor(stops[stops.length - 1])),
            left: end.x * z,
            top: end.y * z,
          }}
          onPointerDown={startDrag({ kind: 'linear-end', end: 'end' }, Math.max(0, stops.length - 1))}
        />
        {pts.slice(1, -1).map((p, i) => {
          const index = i + 1;
          return (
            <div
              key={`ls-${index}`}
              style={{ ...handleStyle(stopColor(p.stop)), left: p.x * z, top: p.y * z }}
              onPointerDown={startDrag({ kind: 'linear-stop', index }, index)}
            />
          );
        })}
      </>
    );
  } else if (type === 'radial') {
    const cx = ((gradient.cx ?? 50) / 100) * w;
    const cy = ((gradient.cy ?? 50) / 100) * h;
    const rPct = Math.max(1, gradient.r ?? 50);
    const radius = (rPct / 100) * h;
    const center = rotateLocal(cx, cy, w, h, angle);
    const rim = rotateLocal(cx, cy + radius, w, h, angle);
    // Side handle — horizontal radius end; maps to same r for circular SVG.
    const side = rotateLocal(cx - (rPct / 100) * w, cy, w, h, angle);

    body = (
      <>
        <svg
          className="pointer-events-none absolute inset-0 overflow-visible"
          width={stageW}
          height={stageH}
        >
          <line
            x1={center.x * z}
            y1={center.y * z}
            x2={rim.x * z}
            y2={rim.y * z}
            stroke={TRACK}
            strokeWidth={2}
            strokeLinecap="round"
          />
          <circle
            cx={center.x * z}
            cy={center.y * z}
            r={Math.max(4, Math.min(radius * z, Math.min(stageW, stageH) * 0.48))}
            fill="none"
            stroke={RING}
            strokeWidth={1}
            opacity={0.35}
            strokeDasharray="4 3"
          />
        </svg>
        <div
          style={{ ...handleStyle('#c8c8c8'), left: center.x * z, top: center.y * z }}
          onPointerDown={startDrag({ kind: 'radial-center' })}
        />
        <div
          style={{
            ...handleStyle(stopColor(stops[stops.length - 1])),
            left: rim.x * z,
            top: rim.y * z,
          }}
          onPointerDown={startDrag({ kind: 'radial-radius' }, Math.max(0, stops.length - 1))}
        />
        <div
          style={{
            ...handleStyle('#ffffff'),
            left: side.x * z,
            top: side.y * z,
            boxShadow: `0 0 0 2px #ef4444, 0 1px 4px rgba(0,0,0,0.25)`,
          }}
          onPointerDown={startDrag({ kind: 'radial-radius' })}
          title={'半径'}
        />
        {stops.slice(1, -1).map((s, i) => {
          const index = i + 1;
          const dist = clamp01(s.offset) * radius;
          const p = rotateLocal(cx, cy + dist, w, h, angle);
          return (
            <div
              key={`rs-${index}`}
              style={{ ...handleStyle(stopColor(s)), left: p.x * z, top: p.y * z }}
              onPointerDown={startDrag({ kind: 'radial-stop', index }, index)}
            />
          );
        })}
      </>
    );
  } else if (type === 'angular') {
    const cx = ((gradient.cx ?? 50) / 100) * w;
    const cy = ((gradient.cy ?? 50) / 100) * h;
    const ringR = Math.min(w, h) * 0.42;
    const center = rotateLocal(cx, cy, w, h, angle);
    const start = gradient.angle ?? 0;

    body = (
      <>
        <svg
          className="pointer-events-none absolute inset-0 overflow-visible"
          width={stageW}
          height={stageH}
        >
          <circle
            cx={center.x * z}
            cy={center.y * z}
            r={ringR * z}
            fill="none"
            stroke={RING}
            strokeWidth={1.5}
            opacity={0.7}
          />
        </svg>
        {stops.map((s, index) => {
          // bakeAngular: startRad = (angle - 90)°; offset walks clockwise from there.
          const deg = start - 90 + clamp01(s.offset) * 360;
          const rad = (deg * Math.PI) / 180;
          const lx = cx + Math.cos(rad) * ringR;
          const ly = cy + Math.sin(rad) * ringR;
          const p = rotateLocal(lx, ly, w, h, angle);
          return (
            <div
              key={`as-${index}`}
              style={{ ...handleStyle(stopColor(s)), left: p.x * z, top: p.y * z }}
              onPointerDown={startDrag({ kind: 'angular-stop', index }, index)}
            />
          );
        })}
      </>
    );
  }

  if (!body) return null;

  return (
    <RcbOverlayPortal>
      <div
        data-gradient-handles
        className="pointer-events-none absolute z-[35]"
        style={{
          left: origin.x,
          top: origin.y,
          width: stageW,
          height: stageH,
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {body}
      </div>
    </RcbOverlayPortal>
  );
}

export default memo(GradientHandlesOverlay);
