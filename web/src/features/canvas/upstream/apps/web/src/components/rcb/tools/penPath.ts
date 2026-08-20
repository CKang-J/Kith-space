/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/tools/penPath.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/** Pen tool: cubic Bezier anchors → SVG path `d` (local coords). */

export type PenAnchor = {
  x: number;
  y: number;
  outX?: number;
  outY?: number;
  inX?: number;
  inY?: number;
};

export function mirrorHandle(x: number, y: number, hx: number, hy: number) {
  return { x: x * 2 - hx, y: y * 2 - hy };
}

export function withMirroredHandles(anchor: PenAnchor): PenAnchor {
  if (anchor.outX == null || anchor.outY == null) return { x: anchor.x, y: anchor.y };
  const mirrored = mirrorHandle(anchor.x, anchor.y, anchor.outX, anchor.outY);
  return {
    x: anchor.x,
    y: anchor.y,
    outX: anchor.outX,
    outY: anchor.outY,
    inX: mirrored.x,
    inY: mirrored.y,
  };
}

export function penAnchorsToD(anchors: PenAnchor[], closed = false) {
  if (anchors.length === 0) return '';
  const [first, ...rest] = anchors;
  let d = `M ${first.x} ${first.y}`;
  rest.forEach((curr, idx) => {
    const prev = anchors[idx];
    const hasCurve =
      (prev.outX != null && prev.outY != null) || (curr.inX != null && curr.inY != null);
    if (hasCurve) {
      const outX = prev.outX ?? prev.x;
      const outY = prev.outY ?? prev.y;
      const inX = curr.inX ?? curr.x;
      const inY = curr.inY ?? curr.y;
      d += ` C ${outX} ${outY} ${inX} ${inY} ${curr.x} ${curr.y}`;
    } else {
      d += ` L ${curr.x} ${curr.y}`;
    }
  });
  if (closed && anchors.length > 2) {
    const last = anchors[anchors.length - 1];
    const hasCurve =
      (last.outX != null && last.outY != null) || (first.inX != null && first.inY != null);
    if (hasCurve) {
      const outX = last.outX ?? last.x;
      const outY = last.outY ?? last.y;
      const inX = first.inX ?? first.x;
      const inY = first.inY ?? first.y;
      d += ` C ${outX} ${outY} ${inX} ${inY} ${first.x} ${first.y}`;
    } else {
      d += ` L ${first.x} ${first.y}`;
    }
    d += ' Z';
  }
  return d;
}

type Pt = { x: number; y: number };

function cubicPoint(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

/** Roots of quadratic at² + bt + c = 0 in (0, 1). */
function quadRoots01(a: number, b: number, c: number): number[] {
  const out: number[] = [];
  const push = (t: number) => {
    if (t > 1e-6 && t < 1 - 1e-6) out.push(t);
  };
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) push(-c / b);
    return out;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return out;
  const s = Math.sqrt(disc);
  push((-b + s) / (2 * a));
  push((-b - s) / (2 * a));
  return out;
}

/**
 * Tight AABB of a cubic Bezier — endpoints + extrema from B'(t)=0.
 * Control handles are NOT included (they lie off the visible curve).
 */
function boundsOfCubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt) {
  let minX = Math.min(p0.x, p3.x);
  let minY = Math.min(p0.y, p3.y);
  let maxX = Math.max(p0.x, p3.x);
  let maxY = Math.max(p0.y, p3.y);

  // B'(t) = 3(1-t)²(P1-P0) + 6(1-t)t(P2-P1) + 3t²(P3-P2)
  // → at² + bt + c = 0 for each axis
  const ax = 3 * (-p0.x + 3 * p1.x - 3 * p2.x + p3.x);
  const bx = 6 * (p0.x - 2 * p1.x + p2.x);
  const cx = 3 * (p1.x - p0.x);
  const ay = 3 * (-p0.y + 3 * p1.y - 3 * p2.y + p3.y);
  const by = 6 * (p0.y - 2 * p1.y + p2.y);
  const cy = 3 * (p1.y - p0.y);

  for (const t of [...quadRoots01(ax, bx, cx), ...quadRoots01(ay, by, cy)]) {
    const p = cubicPoint(p0, p1, p2, p3, t);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  return { minX, minY, maxX, maxY };
}

function segmentBounds(prev: PenAnchor, curr: PenAnchor) {
  const hasCurve =
    (prev.outX != null && prev.outY != null) || (curr.inX != null && curr.inY != null);
  if (!hasCurve) {
    return {
      minX: Math.min(prev.x, curr.x),
      minY: Math.min(prev.y, curr.y),
      maxX: Math.max(prev.x, curr.x),
      maxY: Math.max(prev.y, curr.y),
    };
  }
  const p0 = { x: prev.x, y: prev.y };
  const p1 = { x: prev.outX ?? prev.x, y: prev.outY ?? prev.y };
  const p2 = { x: curr.inX ?? curr.x, y: curr.inY ?? curr.y };
  const p3 = { x: curr.x, y: curr.y };
  return boundsOfCubic(p0, p1, p2, p3);
}

/**
 * Tight bounds of the visible pen path (curve geometry only).
 * Do not include Bezier control handles — they inflate the selection box.
 */
export function boundsOfAnchors(anchors: PenAnchor[], closed = false) {
  if (anchors.length === 0) {
    return { left: 0, top: 0, width: 1, height: 1 };
  }
  if (anchors.length === 1) {
    return { left: anchors[0].x, top: anchors[0].y, width: 1, height: 1 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const absorb = (b: { minX: number; minY: number; maxX: number; maxY: number }) => {
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  };

  for (let i = 1; i < anchors.length; i += 1) {
    absorb(segmentBounds(anchors[i - 1], anchors[i]));
  }
  if (closed && anchors.length > 2) {
    absorb(segmentBounds(anchors[anchors.length - 1], anchors[0]));
  }

  if (!Number.isFinite(minX)) {
    return { left: 0, top: 0, width: 1, height: 1 };
  }
  return {
    left: minX,
    top: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/** Shift anchors into local coords relative to bbox top-left. */
export function localizeAnchors(anchors: PenAnchor[], left: number, top: number): PenAnchor[] {
  const shift = (x?: number, y?: number) =>
    x == null || y == null ? undefined : { x: x - left, y: y - top };
  return anchors.map((a) => {
    const out = shift(a.outX, a.outY);
    const inn = shift(a.inX, a.inY);
    return {
      x: a.x - left,
      y: a.y - top,
      ...(out ? { outX: out.x, outY: out.y } : {}),
      ...(inn ? { inX: inn.x, inY: inn.y } : {}),
    };
  });
}

/** Offset anchors by (dx, dy) — local → scene or reverse. */
export function offsetAnchors(anchors: PenAnchor[], dx: number, dy: number): PenAnchor[] {
  return localizeAnchors(anchors, -dx, -dy);
}

function tokenizePathD(d: string): string[] {
  return String(d || '').match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
}

/**
 * Parse SVG path into separate contours (each moveto starts a new subpath).
 * Outlined text/glyphs are many closed subpaths — must not merge into one ring.
 */
export function penSubpathsFromD(d: string): Array<{ anchors: PenAnchor[]; closed: boolean }> {
  const tokens = tokenizePathD(d);
  const subpaths: Array<{ anchors: PenAnchor[]; closed: boolean }> = [];
  let anchors: PenAnchor[] = [];
  let closed = false;
  let i = 0;
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let subStarted = false;

  const flush = () => {
    if (anchors.length < 2) {
      anchors = [];
      closed = false;
      subStarted = false;
      return;
    }
    if (closed && anchors.length > 1) {
      const first = anchors[0];
      const last = anchors[anchors.length - 1];
      if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-4) {
        if (last.inX != null && last.inY != null) {
          first.inX = last.inX;
          first.inY = last.inY;
        }
        anchors.pop();
      }
    }
    if (anchors.length >= 2) subpaths.push({ anchors, closed });
    anchors = [];
    closed = false;
    subStarted = false;
  };

  const readNum = () => {
    if (i >= tokens.length) return null;
    const t = tokens[i];
    if (/^[a-zA-Z]$/.test(t)) return null;
    i += 1;
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
  };

  const ensureAnchor = (x: number, y: number) => {
    const last = anchors[anchors.length - 1];
    if (last && Math.hypot(last.x - x, last.y - y) < 1e-6) return last;
    const next: PenAnchor = { x, y };
    anchors.push(next);
    return next;
  };

  while (i < tokens.length) {
    const raw = tokens[i++];
    if (!/^[a-zA-Z]$/.test(raw)) continue;
    const cmd = raw;
    const lower = cmd.toLowerCase();
    const rel = cmd === lower;

    if (lower === 'z') {
      closed = true;
      cx = startX;
      cy = startY;
      continue;
    }

    if (lower === 'm') {
      if (subStarted) flush();
      let x = readNum();
      let y = readNum();
      if (x == null || y == null) continue;
      if (rel) {
        x += cx;
        y += cy;
      }
      cx = x;
      cy = y;
      startX = x;
      startY = y;
      subStarted = true;
      ensureAnchor(x, y);
      while (i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i])) {
        let lx = readNum();
        let ly = readNum();
        if (lx == null || ly == null) break;
        if (rel) {
          lx += cx;
          ly += cy;
        }
        cx = lx;
        cy = ly;
        ensureAnchor(lx, ly);
      }
      continue;
    }

    if (!subStarted) continue;

    if (lower === 'l') {
      while (i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i])) {
        let x = readNum();
        let y = readNum();
        if (x == null || y == null) break;
        if (rel) {
          x += cx;
          y += cy;
        }
        cx = x;
        cy = y;
        ensureAnchor(x, y);
      }
      continue;
    }

    if (lower === 'h') {
      while (i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i])) {
        let x = readNum();
        if (x == null) break;
        if (rel) x += cx;
        cx = x;
        ensureAnchor(cx, cy);
      }
      continue;
    }

    if (lower === 'v') {
      while (i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i])) {
        let y = readNum();
        if (y == null) break;
        if (rel) y += cy;
        cy = y;
        ensureAnchor(cx, cy);
      }
      continue;
    }

    if (lower === 'c') {
      while (i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i])) {
        let x1 = readNum();
        let y1 = readNum();
        let x2 = readNum();
        let y2 = readNum();
        let x = readNum();
        let y = readNum();
        if (x1 == null || y1 == null || x2 == null || y2 == null || x == null || y == null) break;
        if (rel) {
          x1 += cx;
          y1 += cy;
          x2 += cx;
          y2 += cy;
          x += cx;
          y += cy;
        }
        const prev = ensureAnchor(cx, cy);
        prev.outX = x1;
        prev.outY = y1;
        cx = x;
        cy = y;
        const next = ensureAnchor(x, y);
        next.inX = x2;
        next.inY = y2;
      }
      continue;
    }

    // Quadratic → cubic handles (path-edit only stores cubics).
    if (lower === 'q') {
      while (i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i])) {
        let qx = readNum();
        let qy = readNum();
        let x = readNum();
        let y = readNum();
        if (qx == null || qy == null || x == null || y == null) break;
        if (rel) {
          qx += cx;
          qy += cy;
          x += cx;
          y += cy;
        }
        const x1 = cx + (2 / 3) * (qx - cx);
        const y1 = cy + (2 / 3) * (qy - cy);
        const x2 = x + (2 / 3) * (qx - x);
        const y2 = y + (2 / 3) * (qy - y);
        const prev = ensureAnchor(cx, cy);
        prev.outX = x1;
        prev.outY = y1;
        cx = x;
        cy = y;
        const next = ensureAnchor(x, y);
        next.inX = x2;
        next.inY = y2;
      }
      continue;
    }

    const argN = lower === 's' ? 4 : lower === 't' ? 2 : lower === 'a' ? 7 : 0;
    if (argN) {
      while (i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i])) {
        for (let k = 0; k < argN; k += 1) readNum();
      }
    }
  }

  flush();
  return subpaths;
}

export function penSubpathsToD(
  subpaths: Array<{ anchors: PenAnchor[]; closed: boolean }>
): string {
  return subpaths
    .map((s) => penAnchorsToD(s.anchors, s.closed))
    .filter(Boolean)
    .join(' ');
}

export const CLOSE_THRESHOLD = 10;

export type PenPlaceAction =
  | { kind: 'close' }
  | { kind: 'anchor'; index: number }
  | { kind: 'place'; x: number; y: number };

/**
 * Pen click decision (pure — used by PenDrawFeature + tests).
 *
 * Order matters: hit an existing landing (esp. last) BEFORE close-to-first.
 * Close only when the tip hits the **first anchor** (idx===0). Empty cells near
 * the start still place — otherwise “almost back to start” commits and the next
 * stroke becomes an unlinked path (user: 同落点再次点击就断了).
 */
export function resolvePenPlaceAction(opts: {
  anchors: PenAnchor[];
  snapped: { x: number; y: number };
  raw: { x: number; y: number };
  anchorHitRadius: number;
  closeThreshold?: number;
}): PenPlaceAction {
  const { anchors, snapped, raw, anchorHitRadius } = opts;
  void opts.closeThreshold;
  if (!anchors.length) {
    return { kind: 'place', x: snapped.x, y: snapped.y };
  }

  const hitNear = (
    p: { x: number; y: number },
    radius: number
  ): number => {
    let best = -1;
    let bestD = radius;
    for (let i = 0; i < anchors.length; i += 1) {
      const a = anchors[i];
      const d = Math.hypot(p.x - a.x, p.y - a.y);
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };

  // Prefer snapped lattice (same drop cell) so re-clicking the tip hits the node.
  let idx = hitNear(snapped, Math.max(anchorHitRadius, 0.75));
  if (idx < 0) idx = hitNear(raw, anchorHitRadius);

  if (idx === 0 && anchors.length >= 2) {
    return { kind: 'close' };
  }
  if (idx >= 0) {
    return { kind: 'anchor', index: idx };
  }

  return { kind: 'place', x: snapped.x, y: snapped.y };
}

/** Reverse open stroke so continuing from the former start appends at the end. */
export function reversePenAnchors(anchors: PenAnchor[]): PenAnchor[] {
  return anchors
    .slice()
    .reverse()
    .map((a) => {
      const next: PenAnchor = { x: a.x, y: a.y };
      if (a.outX != null && a.outY != null) {
        next.inX = a.outX;
        next.inY = a.outY;
      }
      if (a.inX != null && a.inY != null) {
        next.outX = a.inX;
        next.outY = a.inY;
      }
      return next;
    });
}

type SegHit = {
  segIndex: number;
  t: number;
  x: number;
  y: number;
  dist: number;
};

function closestOnLine(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { t: number; x: number; y: number; dist: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  const x = x1 + t * dx;
  const y = y1 + t * dy;
  return { t, x, y, dist: Math.hypot(px - x, py - y) };
}

function closestOnCubic(
  px: number,
  py: number,
  p0: Pt,
  p1: Pt,
  p2: Pt,
  p3: Pt
): { t: number; x: number; y: number; dist: number } {
  let bestT = 0;
  let best = cubicPoint(p0, p1, p2, p3, 0);
  let bestD = Math.hypot(px - best.x, py - best.y);
  const steps = 48;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const p = cubicPoint(p0, p1, p2, p3, t);
    const d = Math.hypot(px - p.x, py - p.y);
    if (d < bestD) {
      bestD = d;
      bestT = t;
      best = p;
    }
  }
  // Local refine around the coarse minimum.
  let lo = Math.max(0, bestT - 1 / steps);
  let hi = Math.min(1, bestT + 1 / steps);
  for (let k = 0; k < 8; k += 1) {
    const t1 = lo + (hi - lo) / 3;
    const t2 = hi - (hi - lo) / 3;
    const pA = cubicPoint(p0, p1, p2, p3, t1);
    const pB = cubicPoint(p0, p1, p2, p3, t2);
    const dA = Math.hypot(px - pA.x, py - pA.y);
    const dB = Math.hypot(px - pB.x, py - pB.y);
    if (dA < dB) {
      hi = t2;
      if (dA < bestD) {
        bestD = dA;
        bestT = t1;
        best = pA;
      }
    } else {
      lo = t1;
      if (dB < bestD) {
        bestD = dB;
        bestT = t2;
        best = pB;
      }
    }
  }
  return { t: bestT, x: best.x, y: best.y, dist: bestD };
}

function closestOnAnchorSegment(
  prev: PenAnchor,
  curr: PenAnchor,
  px: number,
  py: number
): { t: number; x: number; y: number; dist: number; curved: boolean } {
  const curved =
    (prev.outX != null && prev.outY != null) || (curr.inX != null && curr.inY != null);
  if (!curved) {
    return { ...closestOnLine(px, py, prev.x, prev.y, curr.x, curr.y), curved: false };
  }
  const p0 = { x: prev.x, y: prev.y };
  const p1 = { x: prev.outX ?? prev.x, y: prev.outY ?? prev.y };
  const p2 = { x: curr.inX ?? curr.x, y: curr.inY ?? curr.y };
  const p3 = { x: curr.x, y: curr.y };
  return { ...closestOnCubic(px, py, p0, p1, p2, p3), curved: true };
}

/** Closest point on the polyline/cubic path defined by anchors. */
export function findClosestPathHit(
  anchors: PenAnchor[],
  closed: boolean,
  px: number,
  py: number
): SegHit | null {
  if (anchors.length < 2) return null;
  let best: SegHit | null = null;
  const segCount = closed ? anchors.length : anchors.length - 1;
  for (let i = 0; i < segCount; i += 1) {
    const prev = anchors[i];
    const curr = anchors[(i + 1) % anchors.length];
    const hit = closestOnAnchorSegment(prev, curr, px, py);
    if (!best || hit.dist < best.dist) {
      best = { segIndex: i, t: hit.t, x: hit.x, y: hit.y, dist: hit.dist };
    }
  }
  return best;
}

function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Split cubic at t (de Casteljau) for clean handle inheritance when inserting. */
function splitCubicAt(
  p0: Pt,
  p1: Pt,
  p2: Pt,
  p3: Pt,
  t: number
): {
  mid: Pt;
  prevOut: Pt;
  midIn: Pt;
  midOut: Pt;
  nextIn: Pt;
} {
  const p01 = lerpPt(p0, p1, t);
  const p12 = lerpPt(p1, p2, t);
  const p23 = lerpPt(p2, p3, t);
  const p012 = lerpPt(p01, p12, t);
  const p123 = lerpPt(p12, p23, t);
  const mid = lerpPt(p012, p123, t);
  return { mid, prevOut: p01, midIn: p012, midOut: p123, nextIn: p23 };
}

/**
 * Insert an anchor on the closest path segment.
 * Returns null when farther than `maxDist` from the path.
 */
export function insertAnchorOnPath(
  anchors: PenAnchor[],
  closed: boolean,
  px: number,
  py: number,
  maxDist: number
): { anchors: PenAnchor[]; index: number } | null {
  const hit = findClosestPathHit(anchors, closed, px, py);
  if (!hit || hit.dist > maxDist) return null;
  // Skip if essentially an existing corner (avoid duplicates).
  if (hit.t < 0.02 || hit.t > 0.98) {
    const nearIdx = hit.t < 0.5 ? hit.segIndex : (hit.segIndex + 1) % anchors.length;
    return { anchors, index: nearIdx };
  }

  const next = anchors.map((a) => ({ ...a }));
  const i = hit.segIndex;
  const j = (i + 1) % next.length;
  const prev = next[i];
  const curr = next[j];
  const curved =
    (prev.outX != null && prev.outY != null) || (curr.inX != null && curr.inY != null);

  let mid: PenAnchor;
  if (!curved) {
    mid = { x: hit.x, y: hit.y };
  } else {
    const p0 = { x: prev.x, y: prev.y };
    const p1 = { x: prev.outX ?? prev.x, y: prev.outY ?? prev.y };
    const p2 = { x: curr.inX ?? curr.x, y: curr.inY ?? curr.y };
    const p3 = { x: curr.x, y: curr.y };
    const split = splitCubicAt(p0, p1, p2, p3, hit.t);
    next[i] = {
      ...prev,
      outX: split.prevOut.x,
      outY: split.prevOut.y,
    };
    next[j] = {
      ...curr,
      inX: split.nextIn.x,
      inY: split.nextIn.y,
    };
    mid = {
      x: split.mid.x,
      y: split.mid.y,
      inX: split.midIn.x,
      inY: split.midIn.y,
      outX: split.midOut.x,
      outY: split.midOut.y,
    };
  }

  const insertAt = i + 1;
  next.splice(insertAt, 0, mid);
  return { anchors: next, index: insertAt };
}
