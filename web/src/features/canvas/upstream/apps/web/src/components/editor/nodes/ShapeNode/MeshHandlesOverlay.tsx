/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ShapeNode/MeshHandlesOverlay.tsx
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
import { normalizeHex } from '@recombyn-native/components/base/colorPanel';
import type { FillGradient } from '@recombyn-native/components/rcb/scene/document/sceneFill';
import type { MeshPoint } from '@recombyn-native/components/rcb/scene/document/sceneDiffuseMesh';

type SceneBox = { left: number; top: number; width: number; height: number };

type Props = {
  box: SceneBox;
  angle?: number;
  gradient: FillGradient;
  selectedIndex?: number;
  showGuides?: boolean;
  onChange: (next: FillGradient) => void;
  onActivePointChange?: (index: number) => void;
};

const HANDLE = 11;
const LINE = 'rgba(255,255,255,0.9)';
const RING = 'rgba(15,23,42,0.5)';

function clampPct(n: number) {
  return Math.max(0, Math.min(100, n));
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

/**
 * On-canvas diffuse mesh anchors + guide grid (replaces the in-panel preview).
 */
function MeshHandlesOverlay({
  box,
  angle = 0,
  gradient,
  selectedIndex = 0,
  showGuides = true,
  onChange,
  onActivePointChange,
}: Props): ReactNode {
  const camera = useRcbCamera();
  const z = Math.max(0.05, camera.zoom || 1);
  const dragRef = useRef<number | null>(null);
  const gradRef = useRef(gradient);
  const onChangeRef = useRef(onChange);
  const onActiveRef = useRef(onActivePointChange);
  gradRef.current = gradient;
  onChangeRef.current = onChange;
  onActiveRef.current = onActivePointChange;

  const origin = rcbSceneToScreen(camera, box.left, box.top);
  const stageW = box.width * z;
  const stageH = box.height * z;
  const w = box.width;
  const h = box.height;

  const points = (gradient.meshPoints || []) as MeshPoint[];
  const meshSize = Math.max(2, Number(gradient.meshSize) || 4);

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
      const index = dragRef.current;
      if (index == null) return;
      const root = document.querySelector('[data-mesh-handles]') as HTMLElement | null;
      if (!root) return;
      const p = toLocal(e.clientX, e.clientY, root);
      const g = gradRef.current;
      const pts = [...(g.meshPoints || [])] as MeshPoint[];
      if (!pts[index]) return;
      pts[index] = {
        ...pts[index],
        x: clampPct((p.x / Math.max(1, w)) * 100),
        y: clampPct((p.y / Math.max(1, h)) * 100),
      };
      onChangeRef.current({ ...g, type: 'diffuse', meshPoints: pts });
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

  if (gradient.type !== 'diffuse' || !points.length) return null;

  const handleStyle = (fill: string, active: boolean): CSSProperties => ({
    position: 'absolute',
    width: active ? HANDLE + 2 : HANDLE,
    height: active ? HANDLE + 2 : HANDLE,
    marginLeft: active ? -(HANDLE + 2) / 2 : -HANDLE / 2,
    marginTop: active ? -(HANDLE + 2) / 2 : -HANDLE / 2,
    borderRadius: '50%',
    background: fill,
    border: active ? '2.5px solid #3b82f6' : `2px solid ${LINE}`,
    boxShadow: active
      ? `0 0 0 1px ${RING}, 0 0 0 3px rgba(59,130,246,0.35)`
      : `0 0 0 1px ${RING}, 0 1px 4px rgba(0,0,0,0.25)`,
    cursor: 'grab',
    pointerEvents: 'auto',
    zIndex: active ? 3 : 2,
  });

  const startDrag = (index: number) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = index;
    onActiveRef.current?.(index);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const stagePts = points.map((pt) => {
    const lx = (clampPct(pt.x) / 100) * w;
    const ly = (clampPct(pt.y) / 100) * h;
    const r = rotateLocal(lx, ly, w, h, angle);
    return { x: r.x * z, y: r.y * z, color: normalizeHex(pt.color || '#ffffff', '#ffffff') };
  });

  const n = meshSize;
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  if (showGuides) {
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const i = row * n + col;
        if (!stagePts[i]) continue;
        if (col + 1 < n && stagePts[i + 1]) {
          lines.push({
            x1: stagePts[i].x,
            y1: stagePts[i].y,
            x2: stagePts[i + 1].x,
            y2: stagePts[i + 1].y,
          });
        }
        if (row + 1 < n && stagePts[i + n]) {
          lines.push({
            x1: stagePts[i].x,
            y1: stagePts[i].y,
            x2: stagePts[i + n].x,
            y2: stagePts[i + n].y,
          });
        }
      }
    }
  }

  return (
    <RcbOverlayPortal>
      <div
        data-mesh-handles
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
        {showGuides ? (
          <svg
            className="pointer-events-none absolute inset-0 overflow-visible"
            width={stageW}
            height={stageH}
          >
            {lines.map((ln, i) => (
              <g key={i}>
                <line
                  x1={ln.x1}
                  y1={ln.y1}
                  x2={ln.x2}
                  y2={ln.y2}
                  stroke={LINE}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                />
                <line
                  x1={ln.x1}
                  y1={ln.y1}
                  x2={ln.x2}
                  y2={ln.y2}
                  stroke={RING}
                  strokeWidth={0.75}
                  strokeLinecap="round"
                  opacity={0.45}
                />
              </g>
            ))}
          </svg>
        ) : null}
        {stagePts.map((p, i) => (
          <div
            key={i}
            style={{ ...handleStyle(p.color, i === selectedIndex), left: p.x, top: p.y }}
            onPointerDown={startDrag(i)}
            title={`Mesh ${i + 1}`}
          />
        ))}
      </div>
    </RcbOverlayPortal>
  );
}

export default memo(MeshHandlesOverlay);
