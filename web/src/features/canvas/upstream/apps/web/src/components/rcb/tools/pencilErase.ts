/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/tools/pencilErase.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import {
  brushPad,
  brushSize,
  findPencilBrush,
  parsePathPressures,
  parseSimplePathPoints,
  serializePathPressures,
} from './pencilBrushes';

export type ErasePt = { x: number; y: number; pressure?: number };

type TaggedPt = ErasePt & {
  /** Set when this sample is an original path vertex. */
  vertexIndex?: number;
};

function distPointToSeg(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-8) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Min distance from point to eraser polyline (scene coords). */
export function distToEraseStroke(px: number, py: number, erase: ErasePt[]) {
  if (!erase.length) return Infinity;
  if (erase.length === 1) return Math.hypot(px - erase[0].x, py - erase[0].y);
  let min = Infinity;
  for (let i = 1; i < erase.length; i += 1) {
    const a = erase[i - 1];
    const b = erase[i];
    min = Math.min(min, distPointToSeg(px, py, a.x, a.y, b.x, b.y));
  }
  return min;
}

/**
 * Bake simulated velocity pressure onto original points (1:1).
 * Locks thickness so later spacing changes cannot re-thicken the ink.
 */
function bakeSimulatedPressures(
  pts: ErasePt[],
  strokeWidth: number,
  brushId?: string
): ErasePt[] {
  if (pts.some((p) => typeof p.pressure === 'number' && Number.isFinite(p.pressure) && p.pressure > 0)) {
    return pts.map((p) => ({ ...p }));
  }
  const brush = findPencilBrush(brushId || 'solid');
  const size = Math.max(1, brushSize(brush, strokeWidth));
  const RATE = 0.275;
  let prev = 0.25;
  const out: ErasePt[] = [{ ...pts[0], pressure: prev }];
  for (let i = 1; i < pts.length; i += 1) {
    const dist = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const sp = Math.min(1, dist / size);
    const rp = Math.min(1, 1 - sp);
    prev = Math.min(1, prev + (rp - prev) * (sp * RATE));
    out.push({ ...pts[i], pressure: prev });
  }
  return out;
}

/**
 * Densify for hit-testing only. Original vertices keep `vertexIndex` so survivors
 * can be collapsed back without changing spacing / pressure of untouched ink.
 */
function densifyTagged(pts: ErasePt[], spacing: number): TaggedPt[] {
  if (pts.length < 2) return pts.map((p, i) => ({ ...p, vertexIndex: i }));
  const step = Math.max(0.35, spacing);
  const out: TaggedPt[] = [{ ...pts[0], vertexIndex: 0 }];
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(dist / step));
    const pa = typeof a.pressure === 'number' ? a.pressure : undefined;
    const pb = typeof b.pressure === 'number' ? b.pressure : undefined;
    for (let k = 1; k < n; k += 1) {
      const t = k / n;
      const pt: TaggedPt = {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      };
      if (pa != null && pb != null) pt.pressure = pa + (pb - pa) * t;
      else if (pb != null) pt.pressure = pb;
      else if (pa != null) pt.pressure = pa;
      out.push(pt);
    }
    out.push({ ...b, vertexIndex: i });
  }
  return out;
}

/**
 * Collapse a kept dense run back to: cut endpoint + original vertices + cut endpoint.
 * Avoids re-sampling the whole stroke (which was making ink look thicker).
 */
function collapseToOriginalVertices(seg: TaggedPt[]): ErasePt[] {
  if (seg.length < 2) return [];
  const out: ErasePt[] = [];
  const push = (p: TaggedPt) => {
    const next: ErasePt = { x: p.x, y: p.y };
    if (typeof p.pressure === 'number') next.pressure = p.pressure;
    const prev = out[out.length - 1];
    if (prev && Math.hypot(prev.x - next.x, prev.y - next.y) < 1e-4) {
      // Prefer keeping pressure from the newer sample at the same spot.
      if (next.pressure != null) prev.pressure = next.pressure;
      return;
    }
    out.push(next);
  };

  push(seg[0]); // may be a mid-edge cut
  for (let i = 1; i < seg.length - 1; i += 1) {
    if (seg[i].vertexIndex != null) push(seg[i]);
  }
  push(seg[seg.length - 1]); // may be a mid-edge cut
  return out.length >= 2 ? out : [];
}

/**
 * Carve a pencil centerline with an eraser stroke.
 * Returns remaining contiguous segments in local coords (may be empty).
 */
export function eraseCenterlineSegments(
  localPts: ErasePt[],
  nodeLeft: number,
  nodeTop: number,
  eraseScene: ErasePt[],
  hitRadius: number
): ErasePt[][] {
  if (localPts.length < 2 || eraseScene.length < 1 || hitRadius <= 0) {
    return localPts.length >= 2 ? [localPts.map((p) => ({ ...p }))] : [];
  }

  const keep = localPts.map((p) => {
    const sx = p.x + nodeLeft;
    const sy = p.y + nodeTop;
    return distToEraseStroke(sx, sy, eraseScene) > hitRadius;
  });

  const segments: ErasePt[][] = [];
  let run: ErasePt[] = [];
  for (let i = 0; i < localPts.length; i += 1) {
    if (keep[i]) {
      run.push({ ...localPts[i] });
    } else if (run.length) {
      if (run.length >= 2) segments.push(run);
      run = [];
    }
  }
  if (run.length >= 2) segments.push(run);
  return segments;
}

export function centerlineToPathD(pts: ErasePt[]) {
  if (pts.length < 2) return '';
  return pts.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');
}

export function boundsOfPoints(pts: ErasePt[], pad = 0) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
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
}

export type PencilEraseFragment = {
  pathD: string;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Preserved / resampled pressure for freehand rendering. */
  pathPressure?: string;
};

/**
 * Apply eraser to one pencil node.
 * Returns `null` when the stroke is untouched; `[]` when fully erased;
 * otherwise replacement fragments in scene space.
 */
export function erasePencilNode(opts: {
  pathD: string;
  left: number;
  top: number;
  strokeWidth: number;
  brushId?: string;
  /** Optional serialized pressures matching pathD point count. */
  pathPressure?: string | null;
  eraseScene: ErasePt[];
  eraseRadius: number;
}): PencilEraseFragment[] | null {
  const local = parseSimplePathPoints(String(opts.pathD || ''));
  if (local.length < 2) return null;

  const pressures = parsePathPressures(opts.pathPressure, local.length);
  const withPressure: ErasePt[] = bakeSimulatedPressures(
    local.map((p, i) => (pressures ? { ...p, pressure: pressures[i] } : { ...p })),
    opts.strokeWidth,
    opts.brushId
  );

  const brush = findPencilBrush(opts.brushId || 'solid');
  const inkHalf = brushSize(brush, opts.strokeWidth) / 2;
  // Match cursor / trail: cut only under the tip. Adding inkHalf made holes much wider
  // than the dashed tip (remaining freehand caps do not fully fill back).
  const tipR = Math.max(0.5, Number(opts.eraseRadius) || 0);
  // Tip Px drives the cut so the size slider clearly changes erase range.
  const hitRadius = tipR + inkHalf * 0.2;
  // Sample denser than the tip so thin erasers cannot skip between points.
  const spacing = Math.max(0.35, Math.min(inkHalf, tipR) * 0.4);
  const dense = densifyTagged(withPressure, spacing);

  let hitCount = 0;
  for (const p of dense) {
    if (distToEraseStroke(p.x + opts.left, p.y + opts.top, opts.eraseScene) <= hitRadius) {
      hitCount += 1;
    }
  }

  if (hitCount === 0) return null;

  // Erase on dense samples, then collapse each run back onto original vertices.
  const denseKeep = dense.map((p) => {
    const sx = p.x + opts.left;
    const sy = p.y + opts.top;
    return distToEraseStroke(sx, sy, opts.eraseScene) > hitRadius;
  });
  const denseRuns: TaggedPt[][] = [];
  let run: TaggedPt[] = [];
  for (let i = 0; i < dense.length; i += 1) {
    if (denseKeep[i]) {
      run.push(dense[i]);
    } else if (run.length) {
      if (run.length >= 2) denseRuns.push(run);
      run = [];
    }
  }
  if (run.length >= 2) denseRuns.push(run);

  const pad = brushPad(brush, opts.strokeWidth);
  const out: PencilEraseFragment[] = [];

  for (const denseSeg of denseRuns) {
    const collapsed = collapseToOriginalVertices(denseSeg);
    if (collapsed.length < 2) continue;
    const scenePts = collapsed.map((p) => ({
      x: p.x + opts.left,
      y: p.y + opts.top,
      pressure: p.pressure,
    }));
    const box = boundsOfPoints(scenePts, pad);
    const localSeg = scenePts.map((p) => ({
      x: p.x - box.left,
      y: p.y - box.top,
      ...(p.pressure != null ? { pressure: p.pressure } : {}),
    }));
    const d = centerlineToPathD(localSeg);
    if (!d) continue;
    const pathPressure = serializePathPressures(localSeg);
    out.push({
      pathD: d,
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      pathPressure,
    });
  }

  return out;
}
