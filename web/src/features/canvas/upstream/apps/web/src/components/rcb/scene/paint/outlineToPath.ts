/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/scene/paint/outlineToPath.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';
/**
 * Convert geometric shapes / text / strokes into editable SVG path `d`.
 * Used by 轮廓化 — each shapeType has its own outline*Local builder; shared
 * stroke/raster helpers stay below. Result is `shapeType: 'path'`.
 */

import {
  clampCornerRadii,
  radiiFromAttrs,
  roundedPolygonPath,
  roundedRectPath,
  vertexRadiiFromAttrs,
} from '@recombyn-native/components/rcb/scene/document/sceneRadii';
import {
  clampShapeSides,
  DEFAULT_SHAPE_SIDES,
  HEAVY_PATH_D_CHARS,
  shapeVertexPoints,
  sidesFromAttrs,
  starInnerRatioFromAttrs,
} from '@recombyn-native/components/rcb/scene/document/sceneShapes';
import {
  parseNodeText,
  parseNodeTextStyle,
  textVerticalOriginY,
  textVisualLines,
} from '@recombyn-native/components/rcb/scene/document/sceneText';
import {
  parsePathPressures,
  parseSimplePathPoints,
  pencilInkPathFromPoints,
} from '@recombyn-native/components/rcb/tools/pencilBrushes';
import { getShapeBaselineD, PathBuilder } from '@recombyn-native/components/rcb/core/geometry';
import { computeShapeBoolean, type ShapeBox } from '@recombyn-native/components/rcb/selection/shapeBoolean';
import { getInfiniteSvgPaintZoom } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';

export type OutlineResult = {
  pathD: string;
  closed: boolean;
  /** Fill color to keep after outlining (text → shape fill). */
  fillColor?: string;
  /** SVG fill-rule — text glyphs need evenodd for counters/holes. */
  fillRule?: 'nonzero' | 'evenodd';
  /** Tight local bounds of pathD (before any node translation). */
  bounds?: { minX: number; minY: number; width: number; height: number };
  /** Rotation was baked into pathD — outlineNodePatch must clear attrs.angle. */
  bakeAngle?: boolean;
};

/** Shapes / text / stroke tools that can become an editable filled path. */
export function canOutlineNode(node: SceneNodeInput): boolean {
  if (!node) return false;
  if (node.key === 'text') return Boolean(parseNodeText(node.attrs || {}).trim());
  if (node.key === 'rect' || node.key === 'ellipse') return true;
  if (node.key === 'path') {
    // Already a free path — outlining is a no-op (still editable via dblclick).
    return false;
  }
  if (node.key !== 'shape') return false;
  const t = String(node.attrs?.shapeType || 'rect');
  if (t === 'path') return false;
  // Pen / pencil / line: outline the painted SVG stroke (keep visual silhouette).
  if (t === 'pen' || t === 'pencil') {
    return Boolean(String(node.attrs?.path || node.attrs?.d || '').trim());
  }
  if (t === 'line' || t === 'arrow') return true;
  return ['rect', 'roundRect', 'circle', 'triangle', 'star', 'polygon', ''].includes(t);
}

/** Already an editable path (pen / boolean / outlined). */
export function isEditablePathNode(node: SceneNodeInput): boolean {
  if (!node) return false;
  if (node.key === 'path') {
    return Boolean(String(node.attrs?.path || node.attrs?.d || '').trim());
  }
  if (node.key !== 'shape') return false;
  const t = String(node.attrs?.shapeType || '');
  if (t === 'pen' || t === 'path') {
    return Boolean(String(node.attrs?.path || node.attrs?.d || '').trim());
  }
  return false;
}

/**
 * Vector baseline path in local space — delegates to geometry kernel (SoT).
 */
export function geometryIndicatorPathD(
  node: SceneNodeInput,
  opts?: { width?: number; height?: number }
): string | null {
  return getShapeBaselineD(node, opts);
}

/** Unit circle as 4 cubic Bézier segments in box [0,w]×[0,h]. */
export function ellipsePathD(w: number, h: number): string {
  return PathBuilder.ellipse(w, h).toD();
}

/**
 * Convert SVG arc / shorthand to line segments so penSubpathsFromD can parse.
 * Keeps Q/C as-is (penPath maps Q→cubic). Densifying outlined text Q curves
 * into L polylines used to freeze the UI after Outline.
 */
export function normalizePathDForEdit(d: string, sampleStep?: number): string {
  const raw = String(d || '').trim();
  if (!raw) return '';
  if (typeof document === 'undefined') return raw;
  // M/L/Q/C/Z (fontkit outlines) — keep; only densify arcs / S/T shorthand.
  if (!/[AaSsTt]/.test(raw)) return raw;

  // Multi-contour: normalize each subpath alone so getTotalLength does not
  // stitch glyph rings into one polyline (that caused filled “triangles”).
  const chunks = raw.split(/(?=[Mm])/).map((s) => s.trim()).filter(Boolean);
  if (chunks.length > 1) {
    return chunks
      .map((c) => normalizePathDForEdit(c, sampleStep))
      .filter(Boolean)
      .join(' ');
  }

  try {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    el.setAttribute('d', raw);
    const len = el.getTotalLength?.() ?? 0;
    if (!(len > 0)) return raw;
    // Default ~1.25px along path (was len/48 → very jagged on long strokes).
    const step = Math.max(0.75, Math.min(2.5, sampleStep ?? len / 400));
    const pts: Array<[number, number]> = [];
    for (let t = 0; t <= len; t += step) {
      const p = el.getPointAtLength(t);
      pts.push([p.x, p.y]);
    }
    const end = el.getPointAtLength(len);
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(last[0] - end.x, last[1] - end.y) > 0.35) {
      pts.push([end.x, end.y]);
    }
    const closed = /z\s*$/i.test(raw);
    if (pts.length < 2) return raw;
    let out = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
    for (let i = 1; i < pts.length; i += 1) {
      out += ` L ${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)}`;
    }
    if (closed) out += ' Z';
    return out;
  } catch {
    return raw;
  }
}

/** AABB of an SVG path `d` in local coordinates. */
export function pathDBounds(d: string): { minX: number; minY: number; width: number; height: number } | null {
  const raw = String(d || '').trim();
  if (!raw || typeof document === 'undefined') return null;
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.style.visibility = 'hidden';
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    el.setAttribute('d', raw);
    svg.appendChild(el);
    document.body.appendChild(svg);
    const bb = el.getBBox();
    document.body.removeChild(svg);
    if (!(bb.width > 0 || bb.height > 0)) return null;
    return {
      minX: bb.x,
      minY: bb.y,
      width: Math.max(1, bb.width),
      height: Math.max(1, bb.height),
    };
  } catch {
    return null;
  }
}

/**
 * Translate absolute-coordinate path so its top-left sits at origin.
 * Relative commands are left unchanged (caller should skip geometry fit).
 */
function translatePathD(d: string, dx: number, dy: number): string | null {
  if (!dx && !dy) return d;
  // Relative cmds only (lowercase). Do NOT use /i — that also matches absolute M/L/C
  // and made every stroked outline fail after the SVG-stroke outline rewrite.
  if (/[mlhvcsqta]/.test(d)) return null;
  return d.replace(
    /(-?\d*\.?\d+(?:e[-+]?\d+)?)\s*,?\s*(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi,
    (_, a: string, b: string) =>
      `${(parseFloat(a) - dx).toFixed(2)} ${(parseFloat(b) - dy).toFixed(2)}`
  );
}

function dedupePolylinePts(
  pts: Array<[number, number]>,
  eps = 0.05
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > eps) out.push(p);
  }
  return out;
}

/**
 * Corner vertices of an M/L/H/V polyline — no arc/curve densify.
 * Returns null when the path needs sampling (C/Q/A/S/T).
 */
function polylineVertsFromLinearPath(d: string): Array<[number, number]> | null {
  const raw = String(d || '').trim();
  if (!raw) return null;
  if (/[AaCcQqSsTt]/.test(raw)) return null;
  const tokens = raw
    .replace(/,/g, ' ')
    .replace(/([MmLlHhVvZz])/g, ' $1 ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return null;

  const pts: Array<[number, number]> = [];
  let i = 0;
  let cmd = 'M';
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;

  const readNum = (): number | null => {
    if (i >= tokens.length) return null;
    const n = Number(tokens[i]);
    if (!Number.isFinite(n)) return null;
    i += 1;
    return n;
  };

  const push = (x: number, y: number) => {
    const last = pts[pts.length - 1];
    if (last && Math.hypot(last[0] - x, last[1] - y) < 1e-4) return;
    pts.push([x, y]);
  };

  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[MmLlHhVvZz]$/.test(t)) {
      cmd = t;
      i += 1;
      if (cmd === 'Z' || cmd === 'z') {
        cx = startX;
        cy = startY;
        continue;
      }
    }
    if (cmd === 'M' || cmd === 'L') {
      const x = readNum();
      const y = readNum();
      if (x == null || y == null) break;
      cx = x;
      cy = y;
      if (cmd === 'M') {
        startX = cx;
        startY = cy;
        cmd = 'L';
      }
      push(cx, cy);
      continue;
    }
    if (cmd === 'm' || cmd === 'l') {
      const dx = readNum();
      const dy = readNum();
      if (dx == null || dy == null) break;
      cx += dx;
      cy += dy;
      if (cmd === 'm') {
        startX = cx;
        startY = cy;
        cmd = 'l';
      }
      push(cx, cy);
      continue;
    }
    if (cmd === 'H') {
      const x = readNum();
      if (x == null) break;
      cx = x;
      push(cx, cy);
      continue;
    }
    if (cmd === 'h') {
      const dx = readNum();
      if (dx == null) break;
      cx += dx;
      push(cx, cy);
      continue;
    }
    if (cmd === 'V') {
      const y = readNum();
      if (y == null) break;
      cy = y;
      push(cx, cy);
      continue;
    }
    if (cmd === 'v') {
      const dy = readNum();
      if (dy == null) break;
      cy += dy;
      push(cx, cy);
      continue;
    }
    // Unknown token — not a pure polyline.
    return null;
  }
  const cleaned = dedupePolylinePts(pts, 0.02);
  return cleaned.length >= 2 ? cleaned : null;
}

function segUnitNormal(dx: number, dy: number): [number, number] {
  const len = Math.hypot(dx, dy) || 1;
  return [-dy / len, dx / len];
}

function segUnitTangent(dx: number, dy: number): [number, number] {
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

/** Seat a point on the stroke circle (same idea as corner-radius handle seats). */
function seatOnCircle(
  center: [number, number],
  p: [number, number],
  radius: number
): [number, number] {
  const r = Math.max(0.25, radius);
  const dx = p[0] - center[0];
  const dy = p[1] - center[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-8) return [center[0] + r, center[1]];
  return [center[0] + (dx / len) * r, center[1] + (dy / len) * r];
}

/** Offset-line intersection for miter tips (null if parallel). */
function intersectOffsetLines(
  a0: [number, number],
  a1: [number, number],
  b0: [number, number],
  b1: [number, number]
): [number, number] | null {
  const dax = a1[0] - a0[0];
  const day = a1[1] - a0[1];
  const dbx = b1[0] - b0[0];
  const dby = b1[1] - b0[1];
  const cross = dax * dby - day * dbx;
  if (Math.abs(cross) < 1e-10) return null;
  const t = ((b0[0] - a0[0]) * dby - (b0[1] - a0[1]) * dbx) / cross;
  return [a0[0] + t * dax, a0[1] + t * day];
}

/**
 * Round cap/join as L samples on the circle (no cubics — path-edit diamonds looked floated).
 * `outward` picks the exterior arc (CCW-always scalloped / bow-tie ends).
 *
 * Step size must stay fine on thick strokes: ~60° samples made a semicircle look like
 * a triangle (round tip → needle with tip + two shoulder knobs).
 */
function appendCircularArcPolyline(
  parts: string[],
  center: [number, number],
  from: [number, number],
  to: [number, number],
  radius: number,
  outward: [number, number]
) {
  const r = Math.max(0.25, radius);
  const fromS = seatOnCircle(center, from, r);
  const toS = seatOnCircle(center, to, r);
  const a0 = Math.atan2(fromS[1] - center[1], fromS[0] - center[0]);
  const a1 = Math.atan2(toS[1] - center[1], toS[0] - center[0]);

  let dCcw = a1 - a0;
  while (dCcw <= 1e-10) dCcw += Math.PI * 2;
  let dCw = a1 - a0;
  while (dCw >= -1e-10) dCw -= Math.PI * 2;

  const midDot = (delta: number) => {
    const mid = a0 + delta / 2;
    return Math.cos(mid) * outward[0] + Math.sin(mid) * outward[1];
  };
  let delta = midDot(dCcw) >= midDot(dCw) ? dCcw : dCw;
  if (Math.abs(delta) > Math.PI + 1e-3) {
    delta = delta > 0 ? Math.PI : -Math.PI;
  }
  if (Math.abs(delta) < 1e-4) {
    parts.push(`L ${toS[0].toFixed(2)} ${toS[1].toFixed(2)}`);
    return;
  }

  // ~60° / sample → semicircle ≈ 3 verts (corner knobs, not a bead arc).
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 3) - 1e-6));
  for (let s = 1; s <= steps; s += 1) {
    const ang = a0 + (delta * s) / steps;
    parts.push(
      `L ${(center[0] + Math.cos(ang) * r).toFixed(2)} ${(center[1] + Math.sin(ang) * r).toFixed(2)}`
    );
  }
}

/** Collapse centerline so geometric offset stays stable (no fold needles).
 * Always enforce seg ≳ half-width — long zigzags were the main spike source.
 */
function prepareStrokeCenterline(
  ptsIn: Array<[number, number]>,
  strokeWidth: number
): Array<[number, number]> {
  const half = Math.max(0.5, strokeWidth / 2);
  const minGap = Math.max(0.85, half * 0.5);
  const cleaned = dedupePolylinePts(ptsIn, minGap * 0.35);
  if (cleaned.length <= 2) return cleaned.length >= 2 ? cleaned : ptsIn.slice(0, 2);
  if (cleaned.length === 3) return enforceMinSegLength(cleaned, minGap);

  const eps = Math.max(0.9, half * 0.35);
  let out = simplifyRdp(cleaned, eps);
  const maxPts = 24;
  if (out.length > maxPts) {
    let e = eps;
    for (let g = 0; g < 10 && out.length > maxPts; g += 1) {
      e *= 1.35;
      out = simplifyRdp(cleaned, e);
    }
  }
  out = enforceMinSegLength(out.length >= 2 ? out : cleaned, minGap);
  return out.length >= 2 ? out : cleaned.slice(0, 2);
}

/**
 * Join policy for clean corner knobs:
 * - short simple polylines: keep requested miter/round
 * - long / many folds: bevel (accurate ribbon, no miter spikes)
 */
function strokeJoinForCenterline(
  pts: Array<[number, number]>,
  requested: CanvasLineJoin
): CanvasLineJoin {
  if (requested === 'bevel') return 'bevel';
  if (pts.length >= 5) return 'bevel';
  return requested;
}

/** Merge consecutive verts closer than `minLen` (keep endpoints). */
function enforceMinSegLength(
  pts: Array<[number, number]>,
  minLen: number
): Array<[number, number]> {
  if (pts.length <= 2) return pts;
  const out: Array<[number, number]> = [pts[0]];
  for (let i = 1; i < pts.length - 1; i += 1) {
    const prev = out[out.length - 1];
    const p = pts[i];
    if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) >= minLen) out.push(p);
  }
  const last = pts[pts.length - 1];
  const prev = out[out.length - 1];
  if (Math.hypot(last[0] - prev[0], last[1] - prev[1]) < minLen && out.length > 1) {
    out[out.length - 1] = last;
  } else if (Math.hypot(last[0] - prev[0], last[1] - prev[1]) >= 1e-6) {
    out.push(last);
  }
  return out.length >= 2 ? out : pts.slice(0, 2);
}

/**
 * Drop needle / hairline tips on a closed outline (self-crossed offset leftovers).
 * A vert is a needle when both adjacent edges are short and the turn is ~flat back.
 * Do not treat dense round-cap samples (short chords, gentle turn) as needles.
 */
function stripOutlineNeedles(
  ptsIn: Array<[number, number]>,
  strokeWidth: number
): Array<[number, number]> {
  if (ptsIn.length < 4) return ptsIn;
  // Only true spikes (≪ half-width); round-cap chords are ~3–4px and must stay.
  const minEdge = Math.max(0.8, strokeWidth * 0.12);
  let pts = ptsIn.slice();
  let guard = 0;
  while (guard < 24) {
    guard += 1;
    const n = pts.length;
    if (n < 4) break;
    let removed = false;
    const next: Array<[number, number]> = [];
    for (let i = 0; i < n; i += 1) {
      const prev = pts[(i - 1 + n) % n];
      const curr = pts[i];
      const nxt = pts[(i + 1) % n];
      const d0 = Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
      const d1 = Math.hypot(nxt[0] - curr[0], nxt[1] - curr[1]);
      if (d0 < minEdge && d1 < minEdge) {
        const ax = curr[0] - prev[0];
        const ay = curr[1] - prev[1];
        const bx = nxt[0] - curr[0];
        const by = nxt[1] - curr[1];
        const la = d0 || 1;
        const lb = d1 || 1;
        const dot = (ax / la) * (bx / lb) + (ay / la) * (by / lb);
        // Sharp reverse / hairline spike (not a gentle round-cap turn).
        if (dot < -0.45) {
          removed = true;
          continue;
        }
      }
      next.push(curr);
    }
    if (!removed || next.length < 3) break;
    pts = next;
  }
  return pts.length >= 3 ? pts : ptsIn;
}

function closedPathDFromPts(pts: Array<[number, number]>): string {
  if (pts.length < 3) return '';
  return `M ${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ')} Z`;
}

function parseClosedOutlineVerts(d: string): Array<[number, number]> | null {
  const linear = polylineVertsFromLinearPath(String(d || '').replace(/[Zz]\s*$/i, ''));
  return linear && linear.length >= 3 ? linear : null;
}

/**
 * Uniform-width stroke outline of a polyline.
 * Prepares centerline once, then offsets (bevel on long folds).
 */
function outlinePolylineStroke(
  ptsIn: Array<[number, number]>,
  strokeWidth: number,
  linecap: CanvasLineCap = 'round',
  linejoin: CanvasLineJoin = 'round'
): string | null {
  const pts = prepareStrokeCenterline(ptsIn, strokeWidth);
  if (pts.length < 2) return null;
  const join = strokeJoinForCenterline(pts, linejoin);
  const half = Math.max(0.25, strokeWidth / 2);
  const n = pts.length;

  type SegOff = {
    l0: [number, number];
    l1: [number, number];
    r0: [number, number];
    r1: [number, number];
  };
  const segs: SegOff[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    const [nx, ny] = segUnitNormal(b[0] - a[0], b[1] - a[1]);
    segs.push({
      l0: [a[0] + nx * half, a[1] + ny * half],
      l1: [b[0] + nx * half, b[1] + ny * half],
      r0: [a[0] - nx * half, a[1] - ny * half],
      r1: [b[0] - nx * half, b[1] - ny * half],
    });
  }
  if (!segs.length) return null;

  const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
  // Skip near-duplicate verts so path-edit does not show stacked / “floated” knobs.
  // Keep below half-width so butt short-sides (length = strokeWidth) are not dropped.
  const mergeEps = Math.max(0.2, Math.min(0.85, half * 0.15));
  let curX = segs[0].l0[0];
  let curY = segs[0].l0[1];
  const parts: string[] = [`M ${curX.toFixed(2)} ${curY.toFixed(2)}`];
  const emitL = (x: number, y: number) => {
    if (Math.hypot(x - curX, y - curY) < mergeEps) return;
    parts.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`);
    curX = x;
    curY = y;
  };
  /** Exterior miter: replace the just-emitted offset end (`from`) with the tip. */
  const replaceCursorWith = (x: number, y: number) => {
    if (parts.length <= 1) {
      parts[0] = `M ${x.toFixed(2)} ${y.toFixed(2)}`;
    } else {
      parts[parts.length - 1] = `L ${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    curX = x;
    curY = y;
  };
  const emitArc = (
    center: [number, number],
    from: [number, number],
    to: [number, number],
    outward: [number, number]
  ) => {
    const before = parts.length;
    appendCircularArcPolyline(parts, center, from, to, half, outward);
    for (let i = parts.length - 1; i >= before; i -= 1) {
      const m = /^L\s+(-?[\d.]+)\s+(-?[\d.]+)/.exec(parts[i]);
      if (m) {
        curX = parseFloat(m[1]);
        curY = parseFloat(m[2]);
        break;
      }
    }
  };

  const appendJoin = (
    vertex: [number, number],
    from: [number, number],
    to: [number, number],
    leftSide: boolean,
    prevSeg: SegOff,
    nextSeg: SegOff
  ) => {
    const vx0 = from[0] - vertex[0];
    const vy0 = from[1] - vertex[1];
    const vx1 = to[0] - vertex[0];
    const vy1 = to[1] - vertex[1];
    const cr = cross(vx0, vy0, vx1, vy1);
    const exterior = leftSide ? cr > 1e-8 : cr < -1e-8;
    if (!exterior || join === 'bevel') {
      emitL(to[0], to[1]);
      return;
    }
    if (join === 'miter') {
      const tip = leftSide
        ? intersectOffsetLines(prevSeg.l0, prevSeg.l1, nextSeg.l0, nextSeg.l1)
        : intersectOffsetLines(prevSeg.r0, prevSeg.r1, nextSeg.r0, nextSeg.r1);
      if (tip) {
        const miterLen = Math.hypot(tip[0] - vertex[0], tip[1] - vertex[1]);
        // Tight limit (~SVG 2.5): longer tips become needles on acute folds.
        if (miterLen <= half * 2.5 + 1e-6) {
          if (Math.hypot(curX - from[0], curY - from[1]) < mergeEps * 4) {
            replaceCursorWith(tip[0], tip[1]);
          } else {
            emitL(tip[0], tip[1]);
          }
          return;
        }
      }
      emitL(to[0], to[1]);
      return;
    }
    const len0 = Math.hypot(vx0, vy0) || 1;
    const len1 = Math.hypot(vx1, vy1) || 1;
    emitArc(vertex, from, to, [vx0 / len0 + vx1 / len1, vy0 / len0 + vy1 / len1]);
  };

  for (let i = 0; i < segs.length; i += 1) {
    const seg = segs[i];
    if (i > 0) {
      appendJoin(pts[i], segs[i - 1].l1, seg.l0, true, segs[i - 1], seg);
    }
    emitL(seg.l1[0], seg.l1[1]);
  }

  const end = pts[n - 1];
  const last = segs[segs.length - 1];
  if (linecap === 'round') {
    const [tx, ty] = segUnitTangent(end[0] - pts[n - 2][0], end[1] - pts[n - 2][1]);
    emitArc(end, last.l1, last.r1, [tx, ty]);
  } else if (linecap === 'square') {
    const [tx, ty] = segUnitTangent(end[0] - pts[n - 2][0], end[1] - pts[n - 2][1]);
    emitL(last.l1[0] + tx * half, last.l1[1] + ty * half);
    emitL(last.r1[0] + tx * half, last.r1[1] + ty * half);
  } else {
    emitL(last.r1[0], last.r1[1]);
  }

  for (let i = segs.length - 1; i >= 0; i -= 1) {
    const seg = segs[i];
    if (i < segs.length - 1) {
      appendJoin(pts[i + 1], segs[i + 1].r0, seg.r1, false, segs[i + 1], seg);
    }
    emitL(seg.r0[0], seg.r0[1]);
  }

  const start = pts[0];
  const first = segs[0];
  if (linecap === 'round') {
    const [tx, ty] = segUnitTangent(pts[1][0] - start[0], pts[1][1] - start[1]);
    emitArc(start, first.r0, first.l0, [-tx, -ty]);
  } else if (linecap === 'square') {
    const [tx, ty] = segUnitTangent(pts[1][0] - start[0], pts[1][1] - start[1]);
    emitL(first.r0[0] - tx * half, first.r0[1] - ty * half);
    emitL(first.l0[0] - tx * half, first.l0[1] - ty * half);
  }

  parts.push('Z');
  const rawD = parts.join(' ');
  const verts = parseClosedOutlineVerts(rawD);
  if (!verts) return rawD;
  const cleaned = stripOutlineNeedles(verts, strokeWidth);
  return closedPathDFromPts(cleaned) || rawD;
}

/** Sample each SVG subpath into a polyline (absolute). */
function samplePathSubpaths(d: string, stepPx = 1.25): Array<Array<[number, number]>> {
  if (typeof document === 'undefined') return [];
  const chunks = String(d || '')
    .split(/(?=[Mm])/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: Array<Array<[number, number]>> = [];
  for (const chunk of chunks) {
    // Straight M/L/H/V polylines keep corner verts only (no px densify).
    const linear = polylineVertsFromLinearPath(chunk);
    if (linear) {
      out.push(linear);
      continue;
    }
    try {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      el.setAttribute('d', chunk);
      const len = el.getTotalLength?.() ?? 0;
      if (!(len > 0)) continue;
      const n = Math.max(2, Math.ceil(len / Math.max(0.5, stepPx)));
      const pts: Array<[number, number]> = [];
      for (let i = 0; i <= n; i += 1) {
        const p = el.getPointAtLength((len * i) / n);
        pts.push([p.x, p.y]);
      }
      // Curves: sample then RDP; outlinePolylineStroke prepares again for offset.
      const cleaned = dedupePolylinePts(pts);
      const simplified =
        cleaned.length > 8
          ? simplifyRdp(cleaned, Math.max(1.0, stepPx * 0.85))
          : cleaned;
      if (simplified.length >= 2) out.push(dedupePolylinePts(simplified));
    } catch {
      /* skip bad subpath */
    }
  }
  return out;
}

/**
 * Stroke → filled outline (pen / line / arrow / pencil).
 * Pure geometric offset — no raster. Clean corner knobs, no miter needles:
 * prepare centerline (seg ≳ half-width) → offset with bevel on long folds.
 */
function outlineFromSvgStroke(opts: {
  pathD: string;
  strokeWidth: number;
  linecap?: CanvasLineCap;
  linejoin?: CanvasLineJoin;
  fillColor: string;
  zoom?: number;
}): OutlineResult | null {
  const raw = String(opts.pathD || '').trim();
  const sw = Math.max(0.5, Number(opts.strokeWidth) || 1);
  if (!raw) return null;
  const linecap = opts.linecap || 'butt';
  const linejoin = opts.linejoin || 'miter';
  const zoom = opts.zoom ?? 1;

  const finish = (d: string | null): OutlineResult | null => {
    if (!d) return null;
    const cleaned = sparsifyOutlineForEdit(d, sw, zoom) || d;
    return { pathD: cleaned, closed: true, fillColor: opts.fillColor };
  };

  // M/L corners as-is; curves → sparse polyline, then the same geometric offset.
  const subpaths = samplePathSubpaths(raw, Math.max(1.5, Math.min(4, sw * 0.5)));
  if (!subpaths.length) return null;

  const parts: OutlineResult[] = [];
  for (const pts of subpaths) {
    const d = outlinePolylineStroke(pts, sw, linecap, linejoin);
    if (d) {
      parts.push({ pathD: d, closed: true, fillColor: opts.fillColor });
    }
  }
  if (!parts.length) return null;
  if (parts.length === 1) return finish(parts[0].pathD);

  // Arrow etc.: union geometric ribbons (still no raster).
  const u = unionOutlineResults(parts, opts.fillColor);
  return u ? finish(u.pathD) : finish(parts.map((p) => p.pathD).join(' '));
}

export type OutlineBuildOpts = {
  /** CSS zoom — denser edit verts when zoomed in, sparser when zoomed out. */
  zoom?: number;
};

/** Scene-space RDP / merge tolerance so edit knobs stay ~constant on screen. */
function outlineEditTolerance(strokeWidth: number, zoom = 1): number {
  const z = Math.max(0.15, Math.min(8, Number(zoom) || 1));
  const half = Math.max(0.5, strokeWidth / 2);
  // ~6 CSS px between knobs along the silhouette.
  const fromZoom = 6 / z;
  const floor = Math.max(0.4, half * 0.08);
  const ceil = Math.max(floor * 1.25, half * 0.38);
  return Math.min(ceil, Math.max(floor, fromZoom));
}

/** Soft cap on editable verts per ring — grows with zoom, hard-capped for UI. */
function outlineEditMaxPts(zoom = 1): number {
  const z = Math.max(0.15, Math.min(8, Number(zoom) || 1));
  return Math.round(Math.min(280, Math.max(28, 36 * Math.sqrt(z) * 2.2)));
}

/**
 * Drop near-duplicate / colinear verts so path-edit shows corner knobs only.
 * Tolerance + maxPts scale with zoom (zoomed out → fewer points).
 */
function sparsifyOutlineForEdit(
  d: string,
  strokeWidth: number,
  zoom = 1
): string | null {
  const eps = outlineEditTolerance(strokeWidth, zoom);
  const maxPts = outlineEditMaxPts(zoom);
  const mergeEps = Math.max(0.45, Math.min(eps * 0.85, eps));

  const rings = String(d || '')
    .split(/(?=[Mm])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!rings.length) return null;
  const out: string[] = [];
  for (const ring of rings) {
    let verts = polylineVertsFromLinearPath(ring.replace(/[Zz]\s*$/i, ''));
    if (!verts || verts.length < 3) {
      const sparse = sparsifyClosedPathD(ring, eps, maxPts);
      if (sparse) out.push(sparse);
      else out.push(ring);
      continue;
    }
    const merged: Array<[number, number]> = [];
    for (let i = 0; i < verts.length; i += 1) {
      const p = verts[i];
      const prev = merged[merged.length - 1];
      if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) >= mergeEps) merged.push(p);
    }
    if (merged.length > 2) {
      const a = merged[0];
      const b = merged[merged.length - 1];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < mergeEps) merged.pop();
    }
    const simplified = simplifyClosedPolylineCornerAware(
      merged.length >= 3 ? merged : verts,
      eps,
      maxPts
    );
    if (simplified.length < 3) {
      out.push(ring);
      continue;
    }
    out.push(
      `M ${simplified.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ')} Z`
    );
  }
  return out.length ? out.join(' ') : null;
}

/** RDP each closed subpath so boolean/raster results stay path-edit friendly. */
function sparsifyClosedPathD(d: string, epsilon: number, maxPts: number): string | null {
  const rings = String(d || '')
    .split(/(?=[Mm])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!rings.length) return null;
  const out: string[] = [];
  for (const ring of rings) {
    const verts = polylineVertsFromLinearPath(ring.replace(/[Zz]\s*$/i, ''));
    if (!verts || verts.length < 3) {
      // Fall back: sample then simplify (curves / boolean soup).
      if (typeof document === 'undefined') {
        out.push(ring);
        continue;
      }
      try {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        el.setAttribute('d', ring);
        const len = el.getTotalLength?.() ?? 0;
        if (!(len > 0)) {
          out.push(ring);
          continue;
        }
        // Dense sample so round joins survive; corner-aware drop later.
        const n = Math.max(16, Math.ceil(len / Math.max(0.75, epsilon)));
        const pts: Array<[number, number]> = [];
        for (let i = 0; i <= n; i += 1) {
          const p = el.getPointAtLength((len * i) / n);
          pts.push([p.x, p.y]);
        }
        const simplified = simplifyClosedPolylineCornerAware(pts, epsilon, maxPts);
        if (simplified.length < 3) {
          out.push(ring);
          continue;
        }
        out.push(
          `M ${simplified.map(([a, b]) => `${a.toFixed(2)} ${b.toFixed(2)}`).join(' L ')} Z`
        );
      } catch {
        out.push(ring);
      }
      continue;
    }
    const simplified = simplifyClosedPolylineCornerAware(verts, epsilon, maxPts);
    if (simplified.length < 3) {
      out.push(ring);
      continue;
    }
    out.push(
      `M ${simplified.map(([a, b]) => `${a.toFixed(2)} ${b.toFixed(2)}`).join(' L ')} Z`
    );
  }
  return out.length ? out.join(' ') : null;
}

/** Map absolute path coordinates (M/L/C/Q/… numeric pairs). */
function mapAbsolutePathPoints(
  d: string,
  fn: (x: number, y: number) => [number, number]
): string | null {
  if (/[mlhvcsqta]/.test(d)) return null;
  return d.replace(
    /(-?\d*\.?\d+(?:e[-+]?\d+)?)\s*,?\s*(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi,
    (_, a: string, b: string) => {
      const [x, y] = fn(parseFloat(a), parseFloat(b));
      return `${x.toFixed(2)} ${y.toFixed(2)}`;
    }
  );
}

/**
 * Bake node rotation into path so path-edit anchors match the on-canvas silhouette
 * (path-edit chrome is axis-aligned; leaving angle only on attrs looked “水平”).
 */
function bakeNodeAngleIntoOutline(
  outline: OutlineResult,
  boxW: number,
  boxH: number,
  angleDeg: number
): OutlineResult {
  if (!outline.pathD || Math.abs(angleDeg) < 0.01) return outline;
  const cx = boxW / 2;
  const cy = boxH / 2;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rotated = mapAbsolutePathPoints(outline.pathD, (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  });
  if (!rotated) return outline;
  return { ...outline, pathD: rotated, bakeAngle: true };
}

function readStrokeLinecap(
  attrs: Record<string, unknown> | undefined,
  shapeType?: string
): CanvasLineCap {
  const raw = attrs?.strokeLinecap ?? attrs?.['stroke-linecap'];
  if (raw != null) {
    const v = String(raw).toLowerCase();
    if (v === 'butt' || v === 'square' || v === 'round') return v;
  }
  // Match create / stroke panel: pen + line + arrow → butt; pencil → round.
  if (shapeType === 'pencil') return 'round';
  if (shapeType === 'pen' || shapeType === 'line' || shapeType === 'arrow') return 'butt';
  return 'butt';
}

function readStrokeLinejoin(
  attrs: Record<string, unknown> | undefined,
  shapeType?: string
): CanvasLineJoin {
  const raw = attrs?.strokeLinejoin ?? attrs?.['stroke-linejoin'];
  if (raw != null) {
    const v = String(raw).toLowerCase();
    if (v === 'bevel' || v === 'miter' || v === 'round') return v;
  }
  if (shapeType === 'pencil') return 'round';
  if (shapeType === 'pen' || shapeType === 'line' || shapeType === 'arrow') return 'miter';
  return 'miter';
}

function distPointToSeg(
  p: [number, number],
  a: [number, number],
  b: [number, number]
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) {
    const ex = p[0] - a[0];
    const ey = p[1] - a[1];
    return Math.hypot(ex, ey);
  }
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Ramer–Douglas–Peucker polyline simplify (open). */
function simplifyRdp(pts: Array<[number, number]>, epsilon: number): Array<[number, number]> {
  if (pts.length <= 2) return pts.slice();
  let maxDist = 0;
  let maxIdx = 0;
  const first = pts[0];
  const last = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i += 1) {
    const d = distPointToSeg(pts[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }
  if (maxDist <= epsilon) return [first, last];
  const left = simplifyRdp(pts.slice(0, maxIdx + 1), epsilon);
  const right = simplifyRdp(pts.slice(maxIdx), epsilon);
  return left.slice(0, -1).concat(right);
}

/** Simplify a closed contour and hard-cap vertex count for path-edit UX. */
function simplifyClosedPolyline(
  pts: Array<[number, number]>,
  epsilon: number,
  maxPts: number,
  maxEpsilon?: number
): Array<[number, number]> {
  if (pts.length < 3) return pts.slice();
  let ring = pts;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) {
    ring = ring.slice(0, -1);
  }
  if (ring.length < 3) return pts.slice();

  const closeRing = (arr: Array<[number, number]>) => {
    if (arr.length < 2) return arr;
    const f = arr[0];
    const l = arr[arr.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-6) return arr.slice(0, -1);
    return arr;
  };

  let out = closeRing(simplifyRdp(ring.concat([ring[0]]), epsilon));
  if (out.length > maxPts) {
    // Grow eps only up to maxEpsilon — unbounded growth collapsed thin ribbons
    // into wedges / digons (line vanished; ends became needles).
    const epsCap = maxEpsilon ?? Math.max(epsilon * 4, epsilon + 0.5);
    let eps = epsilon;
    let guarded = 0;
    while (out.length > maxPts && guarded < 12 && eps < epsCap - 1e-6) {
      eps = Math.min(epsCap, eps * 1.35);
      out = closeRing(simplifyRdp(ring.concat([ring[0]]), eps));
      guarded += 1;
    }
    if (out.length > maxPts) {
      // Drop least-turny verts (preserve butt corners / round-cap samples).
      const turnMag = (i: number) => {
        const n = out.length;
        const prev = out[(i - 1 + n) % n];
        const curr = out[i];
        const next = out[(i + 1) % n];
        const ax = curr[0] - prev[0];
        const ay = curr[1] - prev[1];
        const bx = next[0] - curr[0];
        const by = next[1] - curr[1];
        const la = Math.hypot(ax, ay) || 1;
        const lb = Math.hypot(bx, by) || 1;
        const dot = Math.max(-1, Math.min(1, (ax / la) * (bx / lb) + (ay / la) * (by / lb)));
        return Math.acos(dot);
      };
      while (out.length > maxPts && out.length > 3) {
        let minI = 0;
        let minTurn = Infinity;
        for (let i = 0; i < out.length; i += 1) {
          const t = turnMag(i);
          if (t < minTurn) {
            minTurn = t;
            minI = i;
          }
        }
        out = out.filter((_, i) => i !== minI);
      }
    }
  }
  return out.length >= 3 ? out : ring.slice(0, Math.min(ring.length, maxPts));
}

/**
 * Like simplifyClosedPolyline, but when capping count drop the *least* turny
 * verts first — preserves corners / round-cap samples that sit on the silhouette
 * (uniform stride was what made anchors look floated off barb tips).
 */
function simplifyClosedPolylineCornerAware(
  pts: Array<[number, number]>,
  epsilon: number,
  maxPts: number
): Array<[number, number]> {
  let out = simplifyClosedPolyline(pts, epsilon, Math.max(maxPts * 2, 96));
  if (out.length <= maxPts) return out;

  const turnMag = (i: number) => {
    const n = out.length;
    const prev = out[(i - 1 + n) % n];
    const curr = out[i];
    const next = out[(i + 1) % n];
    const ax = curr[0] - prev[0];
    const ay = curr[1] - prev[1];
    const bx = next[0] - curr[0];
    const by = next[1] - curr[1];
    const la = Math.hypot(ax, ay) || 1;
    const lb = Math.hypot(bx, by) || 1;
    const dot = Math.max(-1, Math.min(1, (ax / la) * (bx / lb) + (ay / la) * (by / lb)));
    return Math.acos(dot);
  };

  while (out.length > maxPts && out.length > 3) {
    let minI = 1;
    let minTurn = Infinity;
    for (let i = 0; i < out.length; i += 1) {
      const t = turnMag(i);
      if (t < minTurn) {
        minTurn = t;
        minI = i;
      }
    }
    out = out.filter((_, i) => i !== minI);
  }
  return out;
}

function outlineResultToShapeBox(o: OutlineResult): ShapeBox | null {
  if (!o.pathD) return null;
  const bb = o.bounds ?? pathDBounds(o.pathD);
  if (!bb) return null;
  let path = o.pathD;
  if (Math.abs(bb.minX) > 0.01 || Math.abs(bb.minY) > 0.01) {
    // translatePathD subtracts (dx,dy) — same contract as fitOutlineResult.
    const shifted = translatePathD(path, bb.minX, bb.minY);
    if (shifted) path = shifted;
  }
  return {
    left: bb.minX,
    top: bb.minY,
    width: Math.max(1, bb.width),
    height: Math.max(1, bb.height),
    shapeType: 'path',
    path,
  };
}

function unionOutlineResults(parts: OutlineResult[], fillColor: string): OutlineResult | null {
  const boxes = parts.map(outlineResultToShapeBox).filter(Boolean) as ShapeBox[];
  if (!boxes.length) return null;
  if (boxes.length === 1) return parts[0];
  const { result } = computeShapeBoolean(boxes, 'union');
  if (!result?.path) return parts[0];
  return {
    pathD: result.path,
    closed: true,
    fillColor,
    fillRule: result.fillRule,
    bounds: {
      minX: result.x,
      minY: result.y,
      width: result.width,
      height: result.height,
    },
  };
}

/** Open centerline + width → closed fill path (path-edit boolean union). */
export function strokeCenterlineToFilledOutline(
  pathD: string,
  strokeWidth: number,
  attrs?: Record<string, unknown>
): OutlineResult | null {
  const raw = String(pathD || '').trim();
  if (!raw) return null;
  return outlineFromSvgStroke({
    pathD: raw,
    strokeWidth,
    linecap: readStrokeLinecap(attrs),
    linejoin: readStrokeLinejoin(attrs),
    fillColor: '#000000',
  });
}

function nodeBoxSize(node: SceneNodeInput): { w: number; h: number } {
  return {
    w: Math.max(1, Number(node.width) || 1),
    h: Math.max(1, Number(node.height) || 1),
  };
}

function nodeStrokeWidth(node: SceneNodeInput, fallback = 2): number {
  return Math.max(
    1,
    Number(node.attrs?.['border-width'] ?? node.attrs?.borderWidth ?? fallback) || fallback
  );
}

function nodeStrokeInk(node: SceneNodeInput, fallback = '#333333'): string {
  return String(node.attrs?.['border-color'] || node.attrs?.stroke || fallback);
}

function nodeFillColor(node: SceneNodeInput, fallback = '#FFFFFF'): string {
  return String(node.attrs?.['fill-color'] || node.attrs?.fill || fallback);
}

/** Bake attrs.angle into path so every shape’s path-edit matches the painted silhouette. */
function withBakedNodeAngle(node: SceneNodeInput, outline: OutlineResult | null): OutlineResult | null {
  if (!outline) return null;
  const { w, h } = nodeBoxSize(node);
  return bakeNodeAngleIntoOutline(outline, w, h, Number(node.attrs?.angle) || 0);
}

function outlinePencilLocal(node: SceneNodeInput, zoom = 1): OutlineResult | null {
  const raw = String(node.attrs?.path || node.attrs?.d || '').trim();
  if (!raw) return null;
  const sw = nodeStrokeWidth(node, 10);
  const brushId = String(node.attrs?.brushStyle || 'solid');
  const ink = nodeStrokeInk(node);
  const linecap = readStrokeLinecap(node.attrs, 'pencil');
  const pts = parseSimplePathPoints(raw);
  if (pts.length < 2) return null;

  // Match scene paint ribbon, but RDP the centerline first — live capture is dense.
  const pressures = parsePathPressures(node.attrs?.pathPressure, pts.length);
  const outlineD = pencilInkPathFromPoints(pts, sw, brushId, {
    linecap,
    pressures,
    pressureEnabled: true,
    simplify: true,
    pathStyle: 'linear',
  });
  if (!outlineD.trim()) return null;
  // Q midpoints → screen-space sparse M/L ring for path-edit knobs.
  const sparse = sparsifyOutlineForEdit(outlineD, sw, zoom) || outlineD;
  return withBakedNodeAngle(node, {
    pathD: normalizePathDForEdit(sparse) || sparse,
    closed: true,
    fillColor: ink,
  });
}

function outlinePenLocal(node: SceneNodeInput, zoom = 1): OutlineResult | null {
  const raw = String(node.attrs?.path || node.attrs?.d || '').trim();
  if (!raw) return null;
  return withBakedNodeAngle(
    node,
    outlineFromSvgStroke({
      pathD: raw,
      strokeWidth: nodeStrokeWidth(node, 2),
      linecap: readStrokeLinecap(node.attrs, 'pen'),
      linejoin: readStrokeLinejoin(node.attrs, 'pen'),
      fillColor: nodeStrokeInk(node),
      zoom,
    })
  );
}

/** Horizontal shaft stroke → filled ribbon; rotation baked afterward. */
function outlineLineLocal(node: SceneNodeInput, zoom = 1): OutlineResult | null {
  const { w, h } = nodeBoxSize(node);
  const mid = h / 2;
  return withBakedNodeAngle(
    node,
    outlineFromSvgStroke({
      pathD: `M 0 ${mid} L ${w} ${mid}`,
      strokeWidth: nodeStrokeWidth(node, 2),
      linecap: readStrokeLinecap(node.attrs, 'line'),
      linejoin: readStrokeLinejoin(node.attrs, 'line'),
      fillColor: nodeStrokeInk(node),
      zoom,
    })
  );
}

/** Shaft + V head (multi-subpath stroke) → one silhouette; rotation baked afterward. */
function outlineArrowLocal(node: SceneNodeInput, zoom = 1): OutlineResult | null {
  const { w, h } = nodeBoxSize(node);
  const d = getShapeBaselineD({
    key: 'shape',
    width: w,
    height: h,
    attrs: { ...(node.attrs || {}), shapeType: 'arrow' },
  });
  if (!d) return null;
  return withBakedNodeAngle(
    node,
    outlineFromSvgStroke({
      pathD: d,
      strokeWidth: nodeStrokeWidth(node, 2),
      linecap: readStrokeLinecap(node.attrs, 'arrow'),
      linejoin: readStrokeLinejoin(node.attrs, 'arrow'),
      fillColor: nodeStrokeInk(node),
      zoom,
    })
  );
}

/** Circle / ellipse fill baseline (inner hole + arc params preserved). */
function outlineCircleLocal(node: SceneNodeInput): OutlineResult | null {
  const { w, h } = nodeBoxSize(node);
  const d =
    getShapeBaselineD({
      key: 'shape',
      width: w,
      height: h,
      attrs: { ...(node.attrs || {}), shapeType: 'circle' },
    }) || ellipsePathD(w, h);
  const fillColor = nodeFillColor(node);
  const fillNone =
    !fillColor ||
    fillColor === 'transparent' ||
    fillColor === 'none' ||
    fillColor === 'rgba(0,0,0,0)';
  return withBakedNodeAngle(node, {
    pathD: d,
    closed: true,
    fillColor: fillNone ? undefined : fillColor,
  });
}

/**
 * Rect / roundRect fill only — keep SVG stroke on the node (outlineNodePatch).
 * Do NOT densify A-arcs (normalizePathDForEdit); round joins would scallop edges.
 */
function outlineRectLocal(node: SceneNodeInput): OutlineResult | null {
  const { w, h } = nodeBoxSize(node);
  const r = clampCornerRadii(radiiFromAttrs(node.attrs), w, h);
  return withBakedNodeAngle(node, {
    pathD: roundedRectPath(w, h, r),
    closed: true,
    fillColor: nodeFillColor(node),
  });
}

/** Triangle / star / polygon fill (rounded vertices kept as A arcs). */
function outlinePolyLocal(node: SceneNodeInput, shapeType: 'triangle' | 'star' | 'polygon'): OutlineResult | null {
  const { w, h } = nodeBoxSize(node);
  const sides = sidesFromAttrs(node.attrs) || DEFAULT_SHAPE_SIDES;
  const pts = shapeVertexPoints(
    shapeType,
    w,
    h,
    clampShapeSides(sides),
    starInnerRatioFromAttrs(node.attrs)
  );
  if (pts.length < 3) return null;
  const vertexRadii = vertexRadiiFromAttrs(node.attrs, pts.length, shapeType);
  const d = roundedPolygonPath(pts, vertexRadii);
  return withBakedNodeAngle(node, {
    pathD: d || `M ${pts.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`,
    closed: true,
    fillColor: nodeFillColor(node),
  });
}

/**
 * Per-shape outline entry — each kind has its own builder so stroke vs fill,
 * multi-subpath arrows, and angle baking stay explicit and consistent.
 */
function outlineShapeLocal(node: SceneNodeInput, zoom = 1): OutlineResult | null {
  const key = node.key;
  let shapeType = String(node.attrs?.shapeType || 'rect');
  if (key === 'ellipse') shapeType = 'circle';
  else if (key === 'rect') shapeType = 'rect';

  switch (shapeType) {
    case 'pencil':
      return outlinePencilLocal(node, zoom);
    case 'pen':
      return outlinePenLocal(node, zoom);
    case 'line':
      return outlineLineLocal(node, zoom);
    case 'arrow':
      return outlineArrowLocal(node, zoom);
    case 'circle':
      return outlineCircleLocal(node);
    case 'rect':
    case 'roundRect':
    case '':
      return outlineRectLocal(node);
    case 'triangle':
      return outlinePolyLocal(node, 'triangle');
    case 'star':
      return outlinePolyLocal(node, 'star');
    case 'polygon':
      return outlinePolyLocal(node, 'polygon');
    default:
      return null;
  }
}

/**
 * Moore-neighborhood contour walker for a binary mask.
 * `region` is true for pixels that belong to the component being traced.
 */
function traceContoursInRegion(
  region: (x: number, y: number) => boolean,
  cw: number,
  ch: number
): Array<Array<[number, number]>> {
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];
  const visited = new Uint8Array(cw * ch);
  const contours: Array<Array<[number, number]>> = [];

  const floodMark = (sx: number, sy: number) => {
    const stack: Array<[number, number]> = [[sx, sy]];
    while (stack.length) {
      const [x, y] = stack.pop()!;
      const i = y * cw + x;
      if (x < 0 || y < 0 || x >= cw || y >= ch) continue;
      if (visited[i] || !region(x, y)) continue;
      visited[i] = 1;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  };

  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) {
      const i = y * cw + x;
      // Left edge of a region component.
      if (visited[i] || !region(x, y) || region(x - 1, y)) continue;

      const sx = x;
      const sy = y;
      const pts: Array<[number, number]> = [];
      let cx = sx;
      let cy = sy;
      let dir = 0;
      const maxSteps = cw * ch * 2;
      for (let step = 0; step < maxSteps; step += 1) {
        pts.push([cx, cy]);
        let found = false;
        for (let k = 0; k < 8; k += 1) {
          const nd = (dir + 6 + k) % 8;
          const nx = cx + dx[nd];
          const ny = cy + dy[nd];
          if (region(nx, ny)) {
            cx = nx;
            cy = ny;
            dir = nd;
            found = true;
            break;
          }
        }
        if (!found) break;
        if (cx === sx && cy === sy && pts.length > 8) break;
      }

      floodMark(sx, sy);
      if (pts.length >= 8) contours.push(pts);
    }
  }

  return contours;
}

/** Mark empty pixels connected to the canvas border (outside / background). */
function markOutsideEmpty(
  solid: (x: number, y: number) => boolean,
  cw: number,
  ch: number
): Uint8Array {
  const outside = new Uint8Array(cw * ch);
  const stack: Array<[number, number]> = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= cw || y >= ch) return;
    const i = y * cw + x;
    if (outside[i] || solid(x, y)) return;
    outside[i] = 1;
    stack.push([x, y]);
  };
  for (let x = 0; x < cw; x += 1) {
    push(x, 0);
    push(x, ch - 1);
  }
  for (let y = 0; y < ch; y += 1) {
    push(0, y);
    push(cw - 1, y);
  }
  while (stack.length) {
    const [x, y] = stack.pop()!;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  return outside;
}

/**
 * Approximate text glyphs as closed paths via canvas alpha contour.
 * Fallback when the font file is unavailable — prefer `outlineTextFromFont` (fontkit).
 * Traces each character separately so adjacent CJK glyphs do not merge / cancel.
 */
function outlineTextLocal(node: SceneNodeInput): OutlineResult | null {
  if (typeof document === 'undefined') return null;
  const plain = parseNodeText(node.attrs || {}).trim();
  if (!plain) return null;
  const style = parseNodeTextStyle(node.attrs || {});
  const boxW = Math.max(1, Math.round(Number(node.width) || 1));
  const boxH = Math.max(1, Math.round(Number(node.height) || 1));
  const autoSize = String(node.attrs?.autoSize ?? 'true') !== 'false';
  const pad = 4;
  const scale = 6;
  const fontSize = Math.max(1, style.fontSize) * scale;
  const lineHeight = Math.max(0.8, Number(style.lineHeight) || 1.4);
  const lh = lineHeight * fontSize;
  const letterSpacing = (Number(style.letterSpacing) || 0) * scale;
  const align = String(style.textAlign || 'left');
  const lines = textVisualLines(plain, style, { width: boxW, autoSize });
  // Keep CJK / system fallbacks so canvas matches on-screen text when the
  // primary face lacks glyphs (fontkit already bailed on .notdef).
  const family = String(style.fontFamily || 'sans-serif');
  const fontCss = `${style.fontWeight || 400} ${fontSize}px ${family}, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`;

  const measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return null;
  measureCtx.font = fontCss;

  const measureLine = (line: string) => {
    if (!letterSpacing) return measureCtx.measureText(line || ' ').width;
    let total = 0;
    const chars = Array.from(line);
    chars.forEach((ch, i) => {
      total += measureCtx.measureText(ch).width;
      if (i < chars.length - 1) total += letterSpacing;
    });
    return total || measureCtx.measureText(' ').width;
  };

  const parts: string[] = [];
  const originY = !autoSize
    ? textVerticalOriginY(boxH, style.fontSize, lineHeight, Math.max(1, lines.length))
    : 0;

  const traceChar = (ch: string, destX: number, destY: number) => {
    if (!ch.trim()) return;
    const metrics = measureCtx.measureText(ch);
    const gw = Math.ceil(Math.max(metrics.width, fontSize * 0.4) + pad * 2 * scale);
    const gh = Math.ceil(fontSize * 1.35 + pad * 2 * scale);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(8, gw);
    canvas.height = Math.max(8, gh);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';
    ctx.font = fontCss;
    ctx.fillText(ch, pad * scale, pad * scale);

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const solid = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return false;
      return data[(y * canvas.width + x) * 4 + 3] > 20;
    };
    const outside = markOutsideEmpty(solid, canvas.width, canvas.height);
    const outer = traceContoursInRegion(solid, canvas.width, canvas.height);
    const hole = traceContoursInRegion(
      (x, y) => {
        if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return false;
        return !solid(x, y) && !outside[y * canvas.width + x];
      },
      canvas.width,
      canvas.height
    );
    for (const pts of [...outer, ...hole]) {
      const world: Array<[number, number]> = pts.map(([px, py]) => [
        px / scale - pad + destX,
        py / scale - pad + destY,
      ]);
      const simplified = simplifyClosedPolyline(world, 0.35, 180);
      if (simplified.length < 3) continue;
      parts.push(
        `M ${simplified.map(([a, b]) => `${a.toFixed(1)} ${b.toFixed(1)}`).join(' L ')} Z`
      );
    }
  };

  lines.forEach((line, lineIdx) => {
    const lineW = measureLine(line) / scale;
    let x = 0;
    if (align === 'center') x = (boxW - lineW) / 2;
    else if (align === 'right') x = boxW - lineW;
    const y = originY + (lineIdx * lh) / scale;
    let cx = x;
    const chars: string[] = Array.from(line.length ? line : ' ');
    for (const ch of chars) {
      const cw = measureCtx.measureText(ch).width / scale;
      traceChar(ch, cx, y);
      cx += cw + (letterSpacing ? letterSpacing / scale : 0);
    }
  });

  if (!parts.length) return null;

  return {
    pathD: parts.join(' '),
    closed: true,
    fillColor: String(style.fill || '#333333'),
    fillRule: 'evenodd',
  };
}

/** Normalize outline into node-local top-left space + tight bounds. */
function fitOutlineResult(result: OutlineResult): OutlineResult | null {
  if (!result?.pathD) return null;
  const bounds = pathDBounds(result.pathD);
  if (!bounds) return result;
  const needShift = Math.abs(bounds.minX) > 0.01 || Math.abs(bounds.minY) > 0.01;
  const shifted = needShift
    ? translatePathD(result.pathD, bounds.minX, bounds.minY)
    : result.pathD;
  if (shifted != null) {
    return {
      ...result,
      pathD: shifted,
      bounds: {
        minX: bounds.minX,
        minY: bounds.minY,
        width: bounds.width,
        height: bounds.height,
      },
    };
  }
  return {
    ...result,
    bounds: {
      minX: 0,
      minY: 0,
      width: Math.max(bounds.width + bounds.minX, 1),
      height: Math.max(bounds.height + bounds.minY, 1),
    },
  };
}

/** Build local-space outline path for a node (sync; text uses canvas fallback). */
export function buildOutlinePath(node: SceneNodeInput, opts?: OutlineBuildOpts): OutlineResult | null {
  if (!canOutlineNode(node)) return null;
  const zoom = resolveOutlineZoom(opts?.zoom);
  let result: OutlineResult | null = null;
  if (node.key === 'text') result = outlineTextLocal(node);
  else result = outlineShapeLocal(node, zoom);
  return fitOutlineResult(result as OutlineResult);
}

/** Ensure the CSS face used for canvas tracing is ready (avoids empty / tofu outlines). */
async function ensureTextFontsLoaded(node: SceneNodeInput): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  try {
    const style = parseNodeTextStyle(node.attrs || {});
    const family = String(style.fontFamily || 'sans-serif');
    const size = Math.max(1, Number(style.fontSize) || 14);
    const weight = style.fontWeight || 400;
    const css = `${weight} ${size}px ${family}, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`;
    await document.fonts.load(css);
    await document.fonts.ready;
  } catch {
    /* ignore — canvas still attempts with whatever is available */
  }
}

/**
 * Prefer fontkit glyph outlines for text (complete Chinese counters, no missing strokes).
 * Falls back to canvas contour when the face has no downloadable font file
 * or the face is missing glyphs for the text (.notdef boxes).
 */
export async function buildOutlinePathAsync(
  node: SceneNodeInput,
  opts?: OutlineBuildOpts
): Promise<OutlineResult | null> {
  if (!canOutlineNode(node)) return null;
  const zoom = resolveOutlineZoom(opts?.zoom);
  if (node.key === 'text') {
    try {
      const { outlineTextFromFont } = await import('@recombyn-native/components/rcb/scene/paint/outlineTextFont');
      const fromFont = await outlineTextFromFont(node);
      if (fromFont?.pathD) {
        // Keep fontkit Q/C contours. Flattening to M/L shreds letterforms and
        // floods selection with false “corner radius” sites; path-edit knobs
        // only appear after the user enters path-edit mode.
        return fitOutlineResult(fromFont);
      }
    } catch (err) {
      console.warn('[outline] fontkit outline failed, using canvas fallback', err);
    }
    await ensureTextFontsLoaded(node);
    return fitOutlineResult(outlineTextLocal(node) as OutlineResult);
  }
  try {
    return fitOutlineResult(outlineShapeLocal(node, zoom) as OutlineResult);
  } catch (err) {
    console.warn('[outline] shape outline failed', err);
    return null;
  }
}

function resolveOutlineZoom(explicit?: number): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) {
    return Math.max(0.15, Math.min(8, explicit));
  }
  return Math.max(0.15, Math.min(8, getInfiniteSvgPaintZoom() || 1));
}

/** Attrs + geometry patch after outline — keeps paint, switches to editable path. */
export function outlineNodePatch(node: SceneNodeInput, outline: OutlineResult) {
  const prev = { ...(node.attrs || {}) };
  const fill =
    outline.fillColor ||
    String(prev['fill-color'] || prev.fill || '#FFFFFF');
  delete prev.sides;
  delete prev.ORIGIN_DATA;
  delete prev.DATA;
  delete prev.markdown;
  delete prev.brushStyle;
  delete prev.brushStampSrc;
  delete prev.d;
  // Radius / side-stroke are baked into path geometry (or unsupported on path).
  // Leaving them makes filletPathD re-round densified verts and confuse stroke.
  delete prev.radius;
  delete prev.radiusTL;
  delete prev.radiusTR;
  delete prev.radiusBR;
  delete prev.radiusBL;
  delete prev.radiusLinked;
  delete prev.cornerRadius;
  delete prev.rx;
  delete prev.ry;
  delete prev.L;
  delete prev.R;
  delete prev.T;
  delete prev.B;
  delete prev.radiusVertices;

  const b = outline.bounds;
  const left = Number(node.x ?? node.left ?? 0) + (b?.minX ?? 0);
  const top = Number(node.y ?? node.top ?? 0) + (b?.minY ?? 0);
  const width = b ? Math.max(1, b.width) : Math.max(1, Number(node.width) || 1);
  const height = b ? Math.max(1, b.height) : Math.max(1, Number(node.height) || 1);

  const shapeType = String(node.attrs?.shapeType || node.key || 'rect');
  // Stroke-ink tools bake the ribbon into fill — disable SVG stroke to avoid a
  // double outline. Filled shapes (rect / polygon / …) keep their border paint.
  const strokeBakedIntoFill =
    shapeType === 'pen' ||
    shapeType === 'pencil' ||
    shapeType === 'line' ||
    shapeType === 'arrow' ||
    node.key === 'text';
  if (strokeBakedIntoFill) {
    prev['stroke-enabled'] = 'false';
    prev['border-width'] = 0;
  } else {
    // Keep original stroke state — don't invent a border after outlining.
    const prevStrokeOn = String(prev['stroke-enabled'] ?? 'true') !== 'false';
    const prevBw = Number(prev['border-width'] ?? prev.strokeWidth ?? 0);
    if (!prevStrokeOn || !(prevBw > 0)) {
      prev['stroke-enabled'] = 'false';
      prev['stroke-visible'] = 'false';
      prev['border-width'] = 0;
    }
    // Keep strokeAlign as-is (do not force center — outside→center looks thinner).
  }
  // Rotation baked into pathD for every shape (line/arrow/rect/…).
  if (outline.bakeAngle) {
    prev.angle = 0;
  }
  const fillNone =
    !fill ||
    fill === 'transparent' ||
    fill === 'none' ||
    fill === 'rgba(0,0,0,0)';
  if (fillNone) {
    prev['fill-enabled'] = 'false';
    prev['fill-visible'] = 'false';
  }
  if (outline.fillRule) {
    prev['fill-rule'] = outline.fillRule;
  }

  return {
    key: 'shape' as const,
    x: left,
    y: top,
    width,
    height,
    attrs: {
      ...prev,
      shapeType: 'path',
      // Single copy — readers use path || d; duplicating doubles history/clone cost.
      path: outline.pathD,
      closed: outline.closed ? 'true' : 'false',
      'fill-color': fillNone ? 'transparent' : fill,
      'fill-type': String(prev['fill-type'] || 'solid'),
      'fill-enabled': fillNone ? 'false' : 'true',
      'fill-visible': fillNone ? 'false' : 'true',
    },
  };
}

/**
 * Fire after outline so canvas can open path-edit chrome.
 * Skip for heavy multi-glyph outlines — hundreds of anchors freeze the UI;
 * user can still enter path edit manually from the toolbar.
 * Also skip when the path is many closed rings (outlined text) — auto-enter
 * dumps every silhouette vert as knobs and looks like “points flying around”.
 */
export function requestEnterPathEdit(nodeId: string, pathD?: string) {
  if (typeof window === 'undefined' || !nodeId) return;
  const d = pathD != null ? String(pathD) : '';
  if (d.length >= HEAVY_PATH_D_CHARS) return;
  if (d) {
    const rings = d.split(/(?=[Mm])/).filter((s) => s.trim()).length;
    if (rings >= 4) return;
  }
  queueMicrotask(() => {
    window.dispatchEvent(
      new CustomEvent('resume:enter-path-edit', { detail: { nodeId } })
    );
  });
}
