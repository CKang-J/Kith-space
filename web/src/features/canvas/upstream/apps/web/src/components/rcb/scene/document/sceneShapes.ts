/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/scene/document/sceneShapes.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/** Regular polygon / star / stroke (line·arrow) geometry helpers. */

import { ARROW_HEAD as ARROW_HEAD_GEOM, arrowBaselinePath } from '@recombyn-native/components/rcb/core/geometry';

export const DEFAULT_SHAPE_SIDES = 5;
export const MIN_SHAPE_SIDES = 3;
export const MAX_SHAPE_SIDES = 24;
/** Inner / outer radius ratio for stars (内角半径). */
export const DEFAULT_STAR_INNER_RATIO = 0.45;
export const MIN_STAR_INNER_RATIO = 0.08;
export const MAX_STAR_INNER_RATIO = 0.92;

/** Circle / ellipse hole as fraction of outer radii (内半径). */
export const DEFAULT_ELLIPSE_INNER_RATIO = 0;
export const MIN_ELLIPSE_INNER_RATIO = 0;
export const MAX_ELLIPSE_INNER_RATIO = 0.92;
/** Circle / ellipse remaining sweep as % of full turn (弧度 / 周弧度). Signed. */
export const DEFAULT_ELLIPSE_ARC_PERCENT = 100;
export const MIN_ELLIPSE_ARC_PERCENT = 0.5;
export const MAX_ELLIPSE_ARC_PERCENT = 100;
/** Snap shut when gap to full is within this % (enter). */
export const ELLIPSE_ARC_SNAP_FULL_PCT = 5;
/** Must open past this % gap before leaving a snapped-full state (hysteresis). */
export const ELLIPSE_ARC_UNSNAP_FULL_PCT = 11;
/**
 * Snap inner hole → solid disk when ratio is within this.
 * Generous so dragging the hole closed is easy (was 3.5% ≈ 1–2px on small shapes).
 */
export const ELLIPSE_INNER_SNAP_SOLID = 0.12;
/** Also snap closed when the pointer is within this many screen px of the center. */
export const ELLIPSE_INNER_SNAP_SOLID_PX = 18;
/**
 * Fixed cut-end “开始位置” in atan2 degrees (0 = east, 90 = south).
 * Start knob does not drag; arc end must not cross past this ray.
 */
export const DEFAULT_ELLIPSE_START_DEG = 90;

export function clampEllipseInnerRatio(
  n: unknown,
  fallback = DEFAULT_ELLIPSE_INNER_RATIO
): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(MAX_ELLIPSE_INNER_RATIO, Math.max(MIN_ELLIPSE_INNER_RATIO, v));
}

/**
 * Signed arc percent in [−100, −0.5] ∪ [0.5, 100].
 * |value| = remaining sweep from 开始位置; sign = sweep direction.
 */
export function clampEllipseArcPercent(
  n: unknown,
  fallback = DEFAULT_ELLIPSE_ARC_PERCENT
): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  const sign = v < 0 ? -1 : 1;
  const mag = Math.min(MAX_ELLIPSE_ARC_PERCENT, Math.max(MIN_ELLIPSE_ARC_PERCENT, Math.abs(v)));
  return sign * mag;
}

/**
 * Near-zero hole → solid disk (easy restore).
 * Optional ``sceneDist`` + ``zoom`` also snap when the pointer is near the center in screen px.
 */
export function snapEllipseInnerRatio(
  n: unknown,
  opts?: { sceneDist?: number; zoom?: number }
): number {
  const v = clampEllipseInnerRatio(n);
  if (v <= ELLIPSE_INNER_SNAP_SOLID) return 0;
  const sceneDist = opts?.sceneDist;
  if (typeof sceneDist === 'number' && Number.isFinite(sceneDist)) {
    const zoom = Math.max(0.05, Number(opts?.zoom) || 1);
    if (sceneDist * zoom <= ELLIPSE_INNER_SNAP_SOLID_PX) return 0;
  }
  return v;
}

/** Near ±100 → full circle (commit / non-drag helpers). Live drag uses hysteresis instead. */
export function snapEllipseArcPercent(n: unknown): number {
  const v = clampEllipseArcPercent(n);
  if (Math.abs(v) >= MAX_ELLIPSE_ARC_PERCENT - ELLIPSE_ARC_SNAP_FULL_PCT) {
    return v < 0 ? -MAX_ELLIPSE_ARC_PERCENT : MAX_ELLIPSE_ARC_PERCENT;
  }
  return v;
}

/** Resolve locked sweep sign for one gesture (never flips mid-drag). */
export function ellipseArcLockSign(
  prevPercent: number,
  deltaFromStart: number
): 1 | -1 {
  const prev = Number.isFinite(prevPercent) ? prevPercent : 100;
  if (Math.abs(prev) >= 99.95) {
    // From full: end on pointer side with near-full remaining (CW → +, CCW → −).
    if (Math.abs(deltaFromStart) < 1e-6) return 1;
    return deltaFromStart < 0 ? 1 : -1;
  }
  return prev < 0 ? -1 : 1;
}

/** Normalize degrees into [0, 360). */
export function clampEllipseStartDeg(
  n: unknown,
  fallback = DEFAULT_ELLIPSE_START_DEG
): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  const m = v % 360;
  return m < 0 ? m + 360 : m;
}

/** Normalize angle delta into (−π, π]. */
export function wrapAngleDelta(delta: number): number {
  let d = delta;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

const TWO_PI = Math.PI * 2;

function minEllipseArcAlong(): number {
  return (MIN_ELLIPSE_ARC_PERCENT / 100) * TWO_PI;
}

/** Remaining sweep from start → pointer along ``lockSign``, in (0, 2π]. */
function ellipseArcAlongFromDelta(delta: number, lockSign: 1 | -1): number {
  if (lockSign > 0) {
    if (delta > 1e-6) return delta;
    if (delta < -1e-6) return delta + TWO_PI;
    return TWO_PI;
  }
  if (delta < -1e-6) return -delta;
  if (delta > 1e-6) return TWO_PI - delta;
  return TWO_PI;
}

/** Remaining sweep radians from signed arc percent. */
export function ellipseArcAlongRadFromPercent(percent: number): number {
  return (Math.abs(clampEllipseArcPercent(percent)) / 100) * TWO_PI;
}

/** Signed arc % from remaining radians + locked direction. */
export function ellipseArcPercentFromAlongRad(
  alongRad: number,
  sign: 1 | -1
): number {
  const along = Math.min(TWO_PI, Math.max(minEllipseArcAlong(), alongRad));
  return clampEllipseArcPercent(sign * (along / TWO_PI) * 100);
}

/**
 * Cut ends: a0 = fixed 开始位置, a1 = movable 弧度 end.
 * mid = bisector of the remaining sweep (inner-radius seat).
 */
export function ellipseArcEndAngles(
  arcPercent: number,
  startDeg: number = DEFAULT_ELLIPSE_START_DEG
): { a0: number; a1: number; mid: number; startRad: number } {
  const pct = clampEllipseArcPercent(arcPercent);
  const startRad = (clampEllipseStartDeg(startDeg) * Math.PI) / 180;
  const sweep = (Math.abs(pct) / 100) * Math.PI * 2;
  const signed = pct < 0 ? -sweep : sweep;
  const a0 = startRad;
  const a1 = startRad + signed;
  return { a0, a1, mid: startRad + signed / 2, startRad };
}

/** Read ellipse hole ratio (0 = solid disk). */
export function ellipseInnerRatioFromAttrs(
  attrs: Record<string, unknown> | null | undefined
): number {
  return clampEllipseInnerRatio(
    attrs?.ellipseInnerRatio ?? attrs?.circleInnerRatio ?? attrs?.['inner-radius'],
    DEFAULT_ELLIPSE_INNER_RATIO
  );
}

/** Read ellipse arc sweep percent (100 = full / 周弧度). */
export function ellipseArcPercentFromAttrs(
  attrs: Record<string, unknown> | null | undefined
): number {
  return clampEllipseArcPercent(
    attrs?.ellipseArcPercent ?? attrs?.circleArcPercent ?? attrs?.['arc-percent'],
    DEFAULT_ELLIPSE_ARC_PERCENT
  );
}

/** Read fixed 开始位置 degrees. */
export function ellipseStartDegFromAttrs(
  attrs: Record<string, unknown> | null | undefined
): number {
  return clampEllipseStartDeg(
    attrs?.ellipseStartDeg ?? attrs?.circleStartDeg ?? attrs?.['start-deg'],
    DEFAULT_ELLIPSE_START_DEG
  );
}

/**
 * Map pointer angle → remaining sweep so the end handle sits under the cursor.
 * ``prevAlong`` blocks jumping across 开始位置 (near-full ↔ tiny).
 */
export function ellipseArcAlongFromPointerAngle(
  pointerAngle: number,
  startRad: number,
  lockSign: 1 | -1,
  prevAlong: number
): number {
  const delta = wrapAngleDelta(pointerAngle - startRad);
  let along = ellipseArcAlongFromDelta(delta, lockSign);

  // Crossed the start ray from near-full → stay closed (only when already nearly full).
  if (prevAlong > TWO_PI * 0.85 && along < TWO_PI * 0.25) {
    along = TWO_PI;
  }
  // Crossed from a tiny pie → stay at minimum open.
  if (prevAlong < TWO_PI * 0.25 && along > TWO_PI * 0.85) {
    along = minEllipseArcAlong();
  }

  return Math.min(TWO_PI, Math.max(minEllipseArcAlong(), along));
}

/**
 * Open/close hysteresis so snapping to full does not chatter.
 * First open from full: no snap until gap > UNSNAP; then snap in / hold out.
 */
export function ellipseArcApplyFullHysteresis(
  alongRad: number,
  state: { openedOnce: boolean; heldFull: boolean }
): { along: number; openedOnce: boolean; heldFull: boolean } {
  const snapIn = (ELLIPSE_ARC_SNAP_FULL_PCT / 100) * TWO_PI;
  const snapOut = (ELLIPSE_ARC_UNSNAP_FULL_PCT / 100) * TWO_PI;
  const gap = Math.max(0, TWO_PI - alongRad);
  let { openedOnce, heldFull } = state;
  let along = alongRad;

  if (!openedOnce) {
    if (gap > snapOut) openedOnce = true;
    return { along, openedOnce, heldFull: false };
  }

  if (heldFull) {
    if (gap <= snapOut) along = TWO_PI;
    else heldFull = false;
  } else if (gap <= snapIn) {
    along = TWO_PI;
    heldFull = true;
  }

  return { along, openedOnce, heldFull };
}

/** Fixed arrowhead length in local (pre-rotation) units. */
export const ARROW_HEAD = ARROW_HEAD_GEOM;
export function clampShapeSides(n: unknown, fallback = DEFAULT_SHAPE_SIDES): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.min(MAX_SHAPE_SIDES, Math.max(MIN_SHAPE_SIDES, v));
}

export function clampStarInnerRatio(
  n: unknown,
  fallback = DEFAULT_STAR_INNER_RATIO
): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(MAX_STAR_INNER_RATIO, Math.max(MIN_STAR_INNER_RATIO, v));
}

/** Read sides from node attrs (polygon / star). */
export function sidesFromAttrs(attrs: Record<string, unknown> | null | undefined): number {
  return clampShapeSides(attrs?.sides, DEFAULT_SHAPE_SIDES);
}

/** Read star inner-radius ratio from attrs (fraction of outer radius). */
export function starInnerRatioFromAttrs(
  attrs: Record<string, unknown> | null | undefined
): number {
  return clampStarInnerRatio(
    attrs?.starInnerRatio ?? attrs?.innerRatio ?? attrs?.['inner-ratio'],
    DEFAULT_STAR_INNER_RATIO
  );
}

export function starPoints(
  cx: number,
  cy: number,
  spikes: number,
  outerR: number,
  innerR: number
): Array<[number, number]> {
  const points: [number, number][] = [];
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;
  for (let i = 0; i < spikes; i += 1) {
    points.push([cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR]);
    rot += step;
    points.push([cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR]);
    rot += step;
  }
  return points;
}

export function polygonPoints(
  cx: number,
  cy: number,
  sides: number,
  radius: number
): Array<[number, number]> {
  const points: [number, number][] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
    points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
  }
  return points;
}

/** Scale/translate points so their AABB exactly fills width × height. */
export function fitPointsToBox(
  points: Array<[number, number]>,
  width: number,
  height: number
): Array<[number, number]> {
  if (!points.length) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const bw = Math.max(1e-6, maxX - minX);
  const bh = Math.max(1e-6, maxY - minY);
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  return points.map(([x, y]) => [((x - minX) / bw) * w, ((y - minY) / bh) * h]);
}

/** Uniform scale + center — keeps regular polygon / star proportions. */
export function fitPointsUniformToBox(
  points: Array<[number, number]>,
  width: number,
  height: number
): Array<[number, number]> {
  if (!points.length) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const bw = Math.max(1e-6, maxX - minX);
  const bh = Math.max(1e-6, maxY - minY);
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const scale = Math.min(w / bw, h / bh);
  const ox = (w - bw * scale) / 2;
  const oy = (h - bh * scale) / 2;
  return points.map(([x, y]) => [(x - minX) * scale + ox, (y - minY) * scale + oy]);
}

/** Local vertices for triangle / star / polygon, fitted to the node box. */
export function shapeVertexPoints(
  shapeType: string,
  width: number,
  height: number,
  sides: number = DEFAULT_SHAPE_SIDES,
  innerRatio: number = DEFAULT_STAR_INNER_RATIO
): Array<[number, number]> {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  if (shapeType === 'triangle') {
    return [
      [w / 2, 0],
      [w, h],
      [0, h],
    ];
  }
  const n = clampShapeSides(sides);
  if (shapeType === 'star') {
    const ratio = clampStarInnerRatio(innerRatio, DEFAULT_STAR_INNER_RATIO);
    return fitPointsUniformToBox(starPoints(0, 0, n, 1, ratio), w, h);
  }
  if (shapeType === 'polygon') {
    // Stretch to path AABB so extrema sit on box edges (grid-aligned stroke outer).
    return fitPointsToBox(polygonPoints(0, 0, n, 1), w, h);
  }
  return [];
}

export function ptsAttr(pts: Array<[number, number]>) {
  return pts.map(([x, y]) => `${x},${y}`).join(' ');
}

/** Hit/selection thickness for line & arrow nodes (world units). */
export const STROKE_HIT = 24;

/**
 * Hit-test slop in **scene** units from a constant screen-pixel budget.
 * Must divide by zoom — using raw `STROKE_HIT/2` as scene pad makes a ~12u
 * fat finger at 4000% zoom (~480 CSS px) and blocks blank-click deselect.
 */
export function sceneHitSlop(
  zoom: number,
  screenPx: number = Math.max(STROKE_HIT / 2, 12)
): number {
  return Math.max(0, screenPx) / Math.max(0.05, Number(zoom) || 1);
}

export type StrokeEndpoints = { x0: number; y0: number; x1: number; y1: number };

/** Build node placement for a free-angle line/arrow from two endpoints. */
export function strokeNodeFromEndpoints(ep: StrokeEndpoints) {
  const dx = ep.x1 - ep.x0;
  const dy = ep.y1 - ep.y0;
  const length = Math.max(1, Math.hypot(dx, dy));
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const midX = (ep.x0 + ep.x1) / 2;
  const midY = (ep.y0 + ep.y1) / 2;
  const height = STROKE_HIT;
  return {
    x: midX - length / 2,
    y: midY - height / 2,
    width: length,
    height,
    angle: Number(angle.toFixed(2)),
  };
}

/** World-space endpoints of a line/arrow AABB + angle (local shaft left→right). */
export function strokeEndpointsFromBox(
  box: { left: number; top: number; width: number; height: number },
  angleDeg: number
): StrokeEndpoints {
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const rad = ((Number(angleDeg) || 0) * Math.PI) / 180;
  const hx = (box.width / 2) * Math.cos(rad);
  const hy = (box.width / 2) * Math.sin(rad);
  return {
    x0: cx - hx,
    y0: cy - hy,
    x1: cx + hx,
    y1: cy + hy,
  };
}

/**
 * Drag an endpoint freely: opposite end stays fixed; length + angle update together.
 * `handle` `e` moves the right/local end; `w` moves the left/local start.
 */
export function resizeStrokeByEndpoint(
  box: { left: number; top: number; width: number; height: number },
  angleDeg: number,
  handle: 'e' | 'w',
  pointerX: number,
  pointerY: number
) {
  const ep = strokeEndpointsFromBox(box, angleDeg);
  if (handle === 'e') {
    return strokeNodeFromEndpoints({ x0: ep.x0, y0: ep.y0, x1: pointerX, y1: pointerY });
  }
  return strokeNodeFromEndpoints({ x0: pointerX, y0: pointerY, x1: ep.x1, y1: ep.y1 });
}

/** Distance from point to segment (for line/arrow hit-testing). */
export function distPointToSegment(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-8) return Math.hypot(px - x0, py - y0);
  let t = ((px - x0) * dx + (py - y0) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

/**
 * Canvas Path2D geometry cache — reuse for hit-test + overlay batch stroke.
 * Committed ink stays SVG hosts; Path2D is the shared vector kernel.
 */
const PATH2D_CACHE_MAX = 256;
const path2dByD = new Map<string, Path2D>();
const path2dTouch: string[] = [];
/** nodeId → path `d` fingerprint currently cached for that node. */
const nodePathFp = new Map<string, string>();

let hitCtx: CanvasRenderingContext2D | null = null;

function getPath2DHitCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (hitCtx) return hitCtx;
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 1;
  hitCtx = c.getContext('2d', { willReadFrequently: true });
  return hitCtx;
}

function touchPath2DKey(d: string) {
  const i = path2dTouch.indexOf(d);
  if (i >= 0) path2dTouch.splice(i, 1);
  path2dTouch.push(d);
  while (path2dTouch.length > PATH2D_CACHE_MAX) {
    const drop = path2dTouch.shift();
    if (drop) path2dByD.delete(drop);
  }
}

/** Cached Path2D for an SVG path `d` (empty / invalid → null). */
export function getCachedPath2D(pathD: string): Path2D | null {
  const d = String(pathD || '').trim();
  if (!d || typeof Path2D === 'undefined') return null;
  let path = path2dByD.get(d);
  if (path) {
    touchPath2DKey(d);
    return path;
  }
  try {
    path = new Path2D(d);
  } catch {
    return null;
  }
  path2dByD.set(d, path);
  touchPath2DKey(d);
  return path;
}

/** Bind a node id to a path `d` so paint remounts can drop the entry. */
export function rememberNodePath2D(nodeId: string, pathD: string): Path2D | null {
  const id = String(nodeId || '');
  const d = String(pathD || '').trim();
  if (!id || !d) return null;
  const prev = nodePathFp.get(id);
  if (prev && prev !== d) {
    // Keep Path2D for `prev` if other nodes share it — only forget the binding.
  }
  nodePathFp.set(id, d);
  return getCachedPath2D(d);
}

export function invalidateNodePath2D(nodeId: string) {
  const id = String(nodeId || '');
  if (!id) return;
  nodePathFp.delete(id);
}

export function clearPath2DCache() {
  path2dByD.clear();
  path2dTouch.length = 0;
  nodePathFp.clear();
}

export type Path2DHitOpts = {
  /** Test fill (closed shapes / pencil blobs). */
  fill?: boolean;
  /** Stroke hit width in local units (0 / omit → skip stroke test). */
  strokeWidth?: number;
  fillRule?: CanvasFillRule;
  lineCap?: CanvasLineCap;
  lineJoin?: CanvasLineJoin;
};

/**
 * Local-space hit against a cached Path2D (same coords as path `d`).
 * Prefer this over sampling `getPointAtLength` for pen/path hover.
 */
export function hitTestPath2DLocal(
  pathD: string,
  lx: number,
  ly: number,
  opts?: Path2DHitOpts
): boolean {
  if (![lx, ly].every(Number.isFinite)) return false;
  const path = getCachedPath2D(pathD);
  if (!path) return false;
  const ctx = getPath2DHitCtx();
  if (!ctx) return false;

  const wantFill = Boolean(opts?.fill);
  const sw = Math.max(0, Number(opts?.strokeWidth) || 0);
  const rule: CanvasFillRule =
    opts?.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';

  try {
    if (wantFill && ctx.isPointInPath(path, lx, ly, rule)) return true;
    if (sw > 0 && typeof ctx.isPointInStroke === 'function') {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.lineWidth = sw;
      ctx.lineCap = opts?.lineCap || 'round';
      ctx.lineJoin = opts?.lineJoin || 'round';
      ctx.miterLimit = 10;
      if (ctx.isPointInStroke(path, lx, ly)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** Stroke a cached Path2D onto a Canvas2D context (overlay / draft batch). */
export function strokeCachedPath2D(
  ctx: CanvasRenderingContext2D,
  pathD: string,
  style?: { strokeStyle?: string; lineWidth?: number; lineCap?: CanvasLineCap; lineJoin?: CanvasLineJoin }
): boolean {
  const path = getCachedPath2D(pathD);
  if (!path) return false;
  if (style?.strokeStyle) ctx.strokeStyle = style.strokeStyle;
  if (style?.lineWidth != null) ctx.lineWidth = style.lineWidth;
  if (style?.lineCap) ctx.lineCap = style.lineCap;
  if (style?.lineJoin) ctx.lineJoin = style.lineJoin;
  ctx.stroke(path);
  return true;
}

/** Fill a cached Path2D (closed geo / pencil). */
export function fillCachedPath2D(
  ctx: CanvasRenderingContext2D,
  pathD: string,
  style?: { fillStyle?: string; fillRule?: CanvasFillRule }
): boolean {
  const path = getCachedPath2D(pathD);
  if (!path) return false;
  if (style?.fillStyle) ctx.fillStyle = style.fillStyle;
  const rule = style?.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
  ctx.fill(path, rule);
  return true;
}

/** Reused off-DOM path for length sampling (Bezier pen / freehand). */
let measurePathEl: SVGPathElement | null = null;

function getMeasurePathEl(): SVGPathElement {
  if (measurePathEl) return measurePathEl;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute(
    'style',
    'position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden;pointer-events:none'
  );
  measurePathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  svg.appendChild(measurePathEl);
  if (typeof document !== 'undefined') {
    document.documentElement.appendChild(svg);
  }
  return measurePathEl;
}

/** Outlined text / dense logos — avoid re-parsing & dense sampling every pointermove. */
export const HEAVY_PATH_D_CHARS = 12_000;

let measurePathDCache = '';
let measurePathRuleCache = '';

function syncMeasurePathD(el: SVGPathElement, d: string, fillRule?: string) {
  if (measurePathDCache !== d) {
    el.setAttribute('d', d);
    measurePathDCache = d;
  }
  if (fillRule != null) {
    const rule = fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
    if (measurePathRuleCache !== rule) {
      el.setAttribute('fill-rule', rule);
      measurePathRuleCache = rule;
    }
  }
}

/**
 * Whether a local-space point lies inside a path fill (respects `fill-rule`, incl. boolean holes).
 */
export function pathDContainsPoint(
  px: number,
  py: number,
  pathD: string,
  fillRule: string = 'nonzero'
): boolean {
  const d = String(pathD || '').trim();
  if (!d || typeof document === 'undefined') return false;
  // Prefer Canvas Path2D (cached) — no DOM CTM / createSVGPoint per probe.
  if (
    hitTestPath2DLocal(d, px, py, {
      fill: true,
      fillRule: fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
    })
  ) {
    return true;
  }
  try {
    const el = getMeasurePathEl();
    syncMeasurePathD(el, d, fillRule);
    if (typeof el.isPointInFill !== 'function') return false;
    const svg = el.ownerSVGElement;
    if (!svg?.createSVGPoint) return false;
    const pt = svg.createSVGPoint();
    pt.x = px;
    pt.y = py;
    return el.isPointInFill(pt);
  } catch {
    return false;
  }
}

/**
 * Min distance from a local-space point to an SVG path `d` (samples the stroke centerline).
 * Used so pen/pencil selection requires clicking near the ink — not the AABB.
 */
export function distPointToPathD(px: number, py: number, d: string): number {
  const pathD = String(d || '').trim();
  if (!pathD || typeof document === 'undefined') return Infinity;
  // Outlined text / multi-glyph paths: dense getPointAtLength walks freeze the main thread.
  if (pathD.length >= HEAVY_PATH_D_CHARS) return Infinity;
  try {
    const el = getMeasurePathEl();
    syncMeasurePathD(el, pathD);
    const len = el.getTotalLength();
    if (!(len > 0) || !Number.isFinite(len)) return Infinity;
    const step = Math.max(1.5, Math.min(6, len / 120));
    let min = Infinity;
    let prev = el.getPointAtLength(0);
    for (let t = step; t < len; t += step) {
      const p = el.getPointAtLength(t);
      min = Math.min(min, distPointToSegment(px, py, prev.x, prev.y, p.x, p.y));
      prev = p;
      if (min <= 0.5) return min;
    }
    const end = el.getPointAtLength(len);
    return Math.min(min, distPointToSegment(px, py, prev.x, prev.y, end.x, end.y));
  } catch {
    return Infinity;
  }
}

/** Resolve SVG.js wrapper or raw DOM element → Element. */
function asDomElement(el: unknown): Element | null {
  if (!el || typeof el !== 'object') return null;
  const rec = el as { nodeType?: number; node?: { nodeType?: number } };
  if (typeof rec.nodeType === 'number' && rec.nodeType === 1) return el as Element;
  if (rec.node && typeof rec.node.nodeType === 'number' && rec.node.nodeType === 1) {
    return rec.node as Element;
  }
  return null;
}

/**
 * Liang–Barsky: true when segment (x0,y0)→(x1,y1) intersects the closed AABB.
 * Midpoint-only checks miss small marquees that a stroke segment crosses off-center.
 */
export function segmentIntersectsAabb(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  left: number,
  top: number,
  right: number,
  bottom: number
): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const edges: Array<[number, number]> = [
    [-dx, x0 - left],
    [dx, right - x0],
    [-dy, y0 - top],
    [dy, bottom - y0],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1;
}

/**
 * Whether a local-space path stroke intersects a world-space AABB
 * (marquee / box select). Samples the centerline — not the path's own AABB.
 */
export function pathStrokeHitsSceneBox(
  pathD: string,
  nodeBox: { left: number; top: number; width: number; height: number },
  angleDeg: number,
  sceneBox: { left: number; top: number; width: number; height: number },
  pad = 2
): boolean {
  const d = String(pathD || '').trim();
  if (!d || typeof document === 'undefined') return false;
  const left = sceneBox.left - pad;
  const top = sceneBox.top - pad;
  const right = sceneBox.left + sceneBox.width + pad;
  const bottom = sceneBox.top + sceneBox.height + pad;
  const angle = Number(angleDeg) || 0;
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = nodeBox.width / 2;
  const cy = nodeBox.height / 2;
  const toWorld = (lx: number, ly: number) => {
    const dx = lx - cx;
    const dy = ly - cy;
    return {
      x: nodeBox.left + cx + dx * cos - dy * sin,
      y: nodeBox.top + cy + dx * sin + dy * cos,
    };
  };
  const inBox = (x: number, y: number) => x >= left && x <= right && y >= top && y <= bottom;
  try {
    const el = getMeasurePathEl();
    el.setAttribute('d', d);
    const len = el.getTotalLength();
    if (!(len > 0) || !Number.isFinite(len)) return false;
    const step = Math.max(1.5, Math.min(8, len / 100));
    let prev = toWorld(el.getPointAtLength(0).x, el.getPointAtLength(0).y);
    if (inBox(prev.x, prev.y)) return true;
    for (let t = step; t <= len; t += step) {
      const lp = el.getPointAtLength(Math.min(t, len));
      const p = toWorld(lp.x, lp.y);
      if (inBox(p.x, p.y)) return true;
      if (segmentIntersectsAabb(prev.x, prev.y, p.x, p.y, left, top, right, bottom)) {
        return true;
      }
      prev = p;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Hit-test the rendered SVG node with browser geometry APIs.
 * Pen: stroke only. Pencil outline: fill (ink blob) and/or stroke.
 * Returns false when the element is missing — caller should fall back.
 */
export function hitTestSvgNodeAtClient(
  el: unknown,
  clientX: number,
  clientY: number,
  opts?: { mode?: 'stroke' | 'fill' | 'auto'; strokeHitWidth?: number }
): boolean {
  const root = asDomElement(el);
  if (!root || typeof document === 'undefined') return false;

  const geoms: SVGGeometryElement[] = [];
  const push = (n: Element | null | undefined) => {
    if (!n) return;
    const anyN = n as SVGGeometryElement;
    if (typeof anyN.isPointInStroke === 'function' || typeof anyN.isPointInFill === 'function') {
      geoms.push(anyN);
    }
  };
  push(root);
  root.querySelectorAll?.('path,line,polyline,polygon,circle,ellipse,rect').forEach((n) => push(n));

  const mode = opts?.mode || 'auto';
  const hitW = opts?.strokeHitWidth;

  for (const geom of geoms) {
    const svg = geom.ownerSVGElement;
    if (!svg) continue;
    const ctm = geom.getScreenCTM?.();
    if (!ctm) continue;
    let local: DOMPoint;
    try {
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      local = pt.matrixTransform(ctm.inverse());
    } catch {
      continue;
    }

    try {
      const fill = String(geom.getAttribute('fill') || '').toLowerCase();
      // SVG default fill is black when the attribute is omitted — only skip explicit none.
      const skipFill = fill === 'none' || fill === 'transparent';

      if (mode === 'fill' || mode === 'auto') {
        if (!skipFill && typeof geom.isPointInFill === 'function' && geom.isPointInFill(local)) {
          return true;
        }
      }

      if (mode === 'stroke' || mode === 'auto') {
        if (typeof geom.isPointInStroke === 'function') {
          let prev: string | null = null;
          if (hitW != null && hitW > 0) {
            prev = geom.getAttribute('stroke-width');
            geom.setAttribute('stroke-width', String(hitW));
            // Some engines ignore stroke hit when stroke is none / transparent.
            const prevStroke = geom.getAttribute('stroke');
            if (!prevStroke || prevStroke === 'none') {
              geom.setAttribute('stroke', '#000');
              const hit = geom.isPointInStroke(local);
              if (prevStroke == null) geom.removeAttribute('stroke');
              else geom.setAttribute('stroke', prevStroke);
              if (prev != null) geom.setAttribute('stroke-width', prev);
              else geom.removeAttribute('stroke-width');
              if (hit) return true;
              continue;
            }
          }
          const hit = geom.isPointInStroke(local);
          if (hitW != null) {
            if (prev != null) geom.setAttribute('stroke-width', prev);
            else geom.removeAttribute('stroke-width');
          }
          if (hit) return true;
        }
      }
    } catch {
      /* try next geom */
    }
  }
  return false;
}

/** Local SVG path for an open arrow — geometry kernel SoT. */
export function arrowLocalPath(width: number, height: number, head = ARROW_HEAD) {
  return arrowBaselinePath(width, height, head);
}
