/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/selection/shapeBoolean.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import polygonClipping, {
  type MultiPolygon,
  type Polygon,
  type Ring,
} from 'polygon-clipping';
const { difference, intersection, union, xor } = polygonClipping;
import { getShapeBaselineD } from '@recombyn-native/components/rcb/core/geometry';
import {
  clampCornerRadii,
  filletPathD,
  maxRadius,
  radiiFromAttrs,
  type CornerRadii,
} from '@recombyn-native/components/rcb/scene/document/sceneRadii';
import {
  clampShapeSides,
  DEFAULT_SHAPE_SIDES,
  shapeVertexPoints,
  sidesFromAttrs,
  starInnerRatioFromAttrs,
} from '@recombyn-native/components/rcb/scene/document/sceneShapes';

export type ShapeBox = {
  left: number;
  top: number;
  width: number;
  height: number;
  shapeType: string;
  /** Local SVG path for path / pen shapes (coords relative to node box). */
  path?: string;
  /** Degrees; vertices are rotated around the box center. */
  angle?: number;
  /** Polygon side count / star point count. */
  sides?: number;
  /**
   * Full node attrs (radii, starInnerRatio, ellipse arc/inner, …).
   * Boolean rings are sampled from the painted baseline so round corners survive.
   */
  attrs?: Record<string, unknown>;
};

export type BoolMode = 'union' | 'subtract' | 'intersect' | 'exclude';

export type BoolResult = {
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fillRule: 'nonzero' | 'evenodd';
};

/**
 * Curve sample spacing. Adaptive per-shape — fixed 2.5px turned small circles
 * into coarse polygons after boolean sparsify.
 */
const SAMPLE_STEP_PX = 1.6;
const MIN_SAMPLE_POINTS = 24;
const FALLBACK_ELLIPSE_SEGMENTS = 192;
/** Post-boolean path-edit budget per ring (floor; grows with ring size). */
const BOOL_RING_MAX_PTS = 220;
const BOOL_RING_EPS = 0.08;

function ellipseSegmentCount(b: ShapeBox): number {
  const peri =
    Math.PI *
    (3 * (b.width + b.height) -
      Math.sqrt((3 * b.width + b.height) * (b.width + 3 * b.height)));
  // ~0.4 scene-px chord before clip/RDP.
  return Math.max(FALLBACK_ELLIPSE_SEGMENTS, Math.ceil(peri / 0.4));
}

function sampleStepForBox(b: ShapeBox): number {
  const m = Math.max(1, Math.min(b.width, b.height));
  return Math.max(0.35, Math.min(SAMPLE_STEP_PX, m / 80));
}

function rectRing(b: ShapeBox): Ring {
  const { left, top, width, height } = b;
  return [
    [left, top],
    [left + width, top],
    [left + width, top + height],
    [left, top + height],
    [left, top],
  ];
}

function ellipseRingFallback(b: ShapeBox, segments?: number): Ring {
  const cx = b.left + b.width / 2;
  const cy = b.top + b.height / 2;
  const rx = b.width / 2;
  const ry = b.height / 2;
  const n = segments ?? ellipseSegmentCount(b);
  const ring: Ring = [];
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2;
    ring.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]);
  }
  ring.push(ring[0]);
  return ring;
}

/**
 * Local-space rounded-rect ring (DOM-free). WebView2 often returns getTotalLength=0
 * on detached SVG paths with A commands — that used to fall through to a sharp AABB
 * and turn boolean subtract into a hard-corner L.
 */
function roundedRectLocalRing(w: number, h: number, radii: CornerRadii, stepPx: number): Ring {
  const width = Math.max(1, w);
  const height = Math.max(1, h);
  const { tl, tr, br, bl } = clampCornerRadii(radii, width, height);
  const step = Math.max(0.35, stepPx);
  const pts: Array<[number, number]> = [];

  const pushArc = (
    cx: number,
    cy: number,
    r: number,
    a0: number,
    a1: number
  ) => {
    if (!(r > 0.5)) {
      pts.push([cx + r * Math.cos(a1), cy + r * Math.sin(a1)]);
      return;
    }
    const arcLen = Math.abs(a1 - a0) * r;
    const n = Math.max(3, Math.ceil(arcLen / step));
    for (let i = 1; i <= n; i += 1) {
      const t = i / n;
      const a = a0 + (a1 - a0) * t;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };

  // Match roundedRectPath winding (screen y-down, sweep=1 arcs).
  pts.push([tl, 0]);
  if (width - tr > tl) pts.push([width - tr, 0]);
  pushArc(width - tr, tr, tr, -Math.PI / 2, 0);
  if (height - br > tr) pts.push([width, height - br]);
  pushArc(width - br, height - br, br, 0, Math.PI / 2);
  if (bl < width - br) pts.push([bl, height]);
  pushArc(bl, height - bl, bl, Math.PI / 2, Math.PI);
  if (tl < height - bl) pts.push([0, tl]);
  pushArc(tl, tl, tl, Math.PI, (3 * Math.PI) / 2);

  return closeRing(dedupeRingPts(pts, Math.max(0.25, step * 0.35)));
}

function closeRing(pts: Array<[number, number]>): Ring {
  if (pts.length < 3) return pts as Ring;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return pts as Ring;
  return [...pts, [first[0], first[1]]] as Ring;
}

function rotateRing(ring: Ring, cx: number, cy: number, angleDeg: number): Ring {
  if (!angleDeg || !Number.isFinite(angleDeg)) return ring;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return ring.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos] as [number, number];
  });
}

function translateRing(ring: Ring, dx: number, dy: number): Ring {
  return ring.map(([x, y]) => [x + dx, y + dy] as [number, number]);
}

function ringAbsArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(a) / 2;
}

function dedupeRingPts(pts: Array<[number, number]>, eps = 0.05): Array<[number, number]> {
  if (pts.length < 2) return pts;
  const out: Array<[number, number]> = [pts[0]];
  for (let i = 1; i < pts.length; i += 1) {
    const prev = out[out.length - 1];
    const p = pts[i];
    if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) >= eps) out.push(p);
  }
  return out;
}

/** Corner verts of an M/L/H/V polyline — skip densify (outlined strokes are already L). */
function linearPathCornerVerts(d: string): Array<[number, number]> | null {
  const raw = String(d || '').trim();
  if (!raw || /[AaCcQqSsTt]/.test(raw)) return null;
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
      }
      push(cx, cy);
      if (cmd === 'M') cmd = 'L';
    } else if (cmd === 'm' || cmd === 'l') {
      const x = readNum();
      const y = readNum();
      if (x == null || y == null) break;
      cx += x;
      cy += y;
      if (cmd === 'm') {
        startX = cx;
        startY = cy;
      }
      push(cx, cy);
      if (cmd === 'm') cmd = 'l';
    } else if (cmd === 'H') {
      const x = readNum();
      if (x == null) break;
      cx = x;
      push(cx, cy);
    } else if (cmd === 'h') {
      const x = readNum();
      if (x == null) break;
      cx += x;
      push(cx, cy);
    } else if (cmd === 'V') {
      const y = readNum();
      if (y == null) break;
      cy = y;
      push(cx, cy);
    } else if (cmd === 'v') {
      const y = readNum();
      if (y == null) break;
      cy += y;
      push(cx, cy);
    } else {
      break;
    }
  }
  return pts.length >= 2 ? pts : null;
}

function simplifyRdp(pts: Array<[number, number]>, epsilon: number): Array<[number, number]> {
  if (pts.length <= 2) return pts.slice();
  const sq = epsilon * epsilon;
  const keep = new Array(pts.length).fill(false);
  keep[0] = true;
  keep[pts.length - 1] = true;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [s0, e0] = stack.pop()!;
    let maxDist = 0;
    let maxIdx = s0;
    const ax = pts[s0][0];
    const ay = pts[s0][1];
    const bx = pts[e0][0];
    const by = pts[e0][1];
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    for (let i = s0 + 1; i < e0; i += 1) {
      const px = pts[i][0];
      const py = pts[i][1];
      let dist: number;
      if (lenSq < 1e-12) {
        dist = (px - ax) * (px - ax) + (py - ay) * (py - ay);
      } else {
        let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const qx = ax + t * dx;
        const qy = ay + t * dy;
        dist = (px - qx) * (px - qx) + (py - qy) * (py - qy);
      }
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }
    if (maxDist > sq) {
      keep[maxIdx] = true;
      if (maxIdx - s0 > 1) stack.push([s0, maxIdx]);
      if (e0 - maxIdx > 1) stack.push([maxIdx, e0]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** RDP + drop least-turny verts so boolean results stay path-edit friendly. */
function sparsifyClosedRing(
  ringIn: Ring,
  epsilon = BOOL_RING_EPS,
  maxPts = BOOL_RING_MAX_PTS
): Ring {
  let pts = ringIn.map(([x, y]) => [x, y] as [number, number]);
  if (pts.length >= 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) pts = pts.slice(0, -1);
  }
  if (pts.length < 3) return closeRing(pts);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const diag = Math.hypot(maxX - minX, maxY - minY) || 1;
  // Max chord error ~0.04–0.08u so boolean crescents stay visually round.
  const eps = Math.max(0.025, Math.min(epsilon, diag * 0.00055));
  const budget = Math.min(640, Math.max(maxPts, Math.round(diag / 0.35)));

  let out = simplifyRdp(pts.concat([pts[0]]), eps);
  if (out.length >= 2) {
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-6) out = out.slice(0, -1);
  }
  // Only cull when far over budget — never flatten arcs just to hit a low cap.
  if (out.length > budget) {
    const turnMag = (idx: number) => {
      const n = out.length;
      const prev = out[(idx - 1 + n) % n];
      const curr = out[idx];
      const next = out[(idx + 1) % n];
      const ax = curr[0] - prev[0];
      const ay = curr[1] - prev[1];
      const bx = next[0] - curr[0];
      const by = next[1] - curr[1];
      const la = Math.hypot(ax, ay) || 1;
      const lb = Math.hypot(bx, by) || 1;
      const dot = Math.max(-1, Math.min(1, (ax / la) * (bx / lb) + (ay / la) * (by / lb)));
      return Math.acos(dot);
    };
    while (out.length > budget && out.length > 3) {
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
  return closeRing(out.length >= 3 ? out : pts);
}

/** Local-space painted silhouette `d` (includes corner radii / ellipse params). */
function localBaselinePathD(b: ShapeBox): string {
  const t = String(b.shapeType || 'rect');
  if (t === 'path' || t === 'pen') {
    const raw = String(b.path || b.attrs?.path || b.attrs?.d || '').trim();
    if (!raw || t === 'pen') return raw;
    // Closed paths keep a sharp base + live radii; boolean must sample the
    // painted fillet or nested boolean / path×rect ops lose round corners.
    const radii = radiiFromAttrs(b.attrs);
    if (maxRadius(radii) > 0.5) return filletPathD(raw, radii, b.attrs);
    return raw;
  }
  const attrs: Record<string, unknown> = {
    ...(b.attrs || {}),
    shapeType: t,
  };
  if (b.sides != null && attrs.sides == null) attrs.sides = b.sides;
  if (b.path && attrs.path == null) attrs.path = b.path;
  return (
    getShapeBaselineD({
      key: t === 'ellipse' ? 'ellipse' : 'shape',
      width: b.width,
      height: b.height,
      attrs,
    }) || ''
  );
}

/**
 * Sharp geo verts for star / polygon / triangle — reliable boolean rings without
 * SVG Path sampling (arcs / empty getTotalLength used to fall through to AABB).
 */
function geoShapeLocalRing(b: ShapeBox): Ring | null {
  const t = String(b.shapeType || 'rect');
  if (t !== 'star' && t !== 'polygon' && t !== 'triangle') return null;
  const sides =
    b.sides != null && Number.isFinite(Number(b.sides))
      ? clampShapeSides(Number(b.sides), DEFAULT_SHAPE_SIDES)
      : sidesFromAttrs(b.attrs);
  const pts = shapeVertexPoints(
    t,
    b.width,
    b.height,
    sides,
    starInnerRatioFromAttrs(b.attrs)
  );
  if (pts.length < 3) return null;
  const cleaned = dedupeRingPts(
    pts.map(([x, y]) => [x, y] as [number, number]),
    0.25
  );
  if (cleaned.length < 3) return null;
  return closeRing(cleaned);
}

/**
 * Nonzero star fill as a simple outer ring (triangle-fan ∪).
 * Tip–valley star polylines self-intersect; polygon-clipping then throws or
 * returns empty when the star is the subtract base — triggering AABB fallback.
 */
function simpleRingFromStarFan(localClosed: Ring): Ring | null {
  let pts = localClosed.map(([x, y]) => [x, y] as [number, number]);
  if (
    pts.length >= 2 &&
    Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6
  ) {
    pts = pts.slice(0, -1);
  }
  if (pts.length < 3) return null;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of pts) {
    cx += x;
    cy += y;
  }
  cx /= pts.length;
  cy /= pts.length;

  let mp: MultiPolygon | null = null;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const tri: Polygon = [
      [
        [cx, cy],
        [a[0], a[1]],
        [b[0], b[1]],
        [cx, cy],
      ],
    ];
    try {
      mp = mp ? (union(mp, tri) as MultiPolygon) : [tri];
    } catch {
      return null;
    }
  }
  if (!mp?.length) return null;
  // Largest outer ring (fan union is usually one polygon).
  let best: Ring | null = null;
  let bestArea = -1;
  for (const poly of mp) {
    const outer = poly[0];
    if (!outer || outer.length < 4) continue;
    const a = ringAbsArea(outer);
    if (a > bestArea) {
      bestArea = a;
      best = outer;
    }
  }
  return best ? closeRing(dedupeRingPts(best.map(([x, y]) => [x, y] as [number, number]), 0.2)) : null;
}

/**
 * Sample each SVG subpath into a closed ring (browser Path API — keeps C/Q/A curves).
 * Largest ring first (outer), then holes.
 */
function sampleLocalPathToRings(d: string, stepPx = SAMPLE_STEP_PX): Ring[] {
  const raw = String(d || '').trim();
  if (!raw) return [];
  if (typeof document === 'undefined') return [];

  const chunks = raw
    .split(/(?=[Mm])/)
    .map((s) => s.trim())
    .filter(Boolean);
  const rings: Ring[] = [];

  // WebView2 / some engines: getTotalLength() is 0 on detached <path> with arcs.
  // Mount once under a hidden SVG for the whole sample pass.
  const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  host.setAttribute('width', '0');
  host.setAttribute('height', '0');
  host.style.cssText =
    'position:absolute;left:0;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none';
  document.documentElement.appendChild(host);

  try {
    for (const chunk of chunks) {
      // Straight polylines (outlined strokes): keep corners only — densify made
      // boolean results a bead string of path-edit knobs.
      const linear = linearPathCornerVerts(chunk.replace(/[Zz]\s*$/i, ''));
      if (linear && linear.length >= 3) {
        rings.push(closeRing(dedupeRingPts(linear, 0.35)));
        continue;
      }
      try {
        const live = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        live.setAttribute('d', chunk);
        host.appendChild(live);
        const len = live.getTotalLength?.() ?? 0;
        if (!(len > 0)) {
          live.remove();
          continue;
        }
        const n = Math.max(MIN_SAMPLE_POINTS, Math.ceil(len / Math.max(0.75, stepPx)));
        const pts: Array<[number, number]> = [];
        for (let i = 0; i <= n; i += 1) {
          const p = live.getPointAtLength((len * i) / n);
          pts.push([p.x, p.y]);
        }
        live.remove();
        const cleaned = dedupeRingPts(pts, Math.max(0.35, stepPx * 0.35));
        if (cleaned.length < 3) continue;
        rings.push(closeRing(cleaned));
      } catch {
        /* skip bad subpath */
      }
    }
  } finally {
    host.remove();
  }

  if (rings.length <= 1) return rings;
  return rings.sort((a, b) => ringAbsArea(b) - ringAbsArea(a));
}

/**
 * Convert a scene shape into a world-space polygon (outer + holes) for clipping.
 * Uses painted baseline geometry so rounded corners / arcs are preserved.
 */
function shapeToPolygon(b: ShapeBox): Polygon | null {
  const cx = b.left + b.width / 2;
  const cy = b.top + b.height / 2;
  const angle = b.angle || 0;
  const toWorld = (ring: Ring): Ring =>
    rotateRing(translateRing(ring, b.left, b.top), cx, cy, angle);

  // Circles / ellipses: dense parametric rings (SVG A sampling + RDP flattened arcs).
  const t = String(b.shapeType || 'rect');
  if (t === 'circle' || t === 'ellipse') {
    const local = ellipseRingFallback(
      { ...b, left: 0, top: 0 },
      ellipseSegmentCount(b)
    );
    return [toWorld(local)];
  }

  // Rounded rect: parametric ring (no DOM). Detached SVG A-path length is often 0
  // in desktop WebView → old code used sharp AABB → boolean became a hard L.
  if (t === 'rect') {
    const radii = clampCornerRadii(radiiFromAttrs(b.attrs), b.width, b.height);
    if (maxRadius(radii) > 0.5) {
      const local = roundedRectLocalRing(b.width, b.height, radii, sampleStepForBox(b));
      if (local.length >= 4) return [toWorld(local)];
    }
  }

  // Star / polygon / triangle: prefer sharp verts so concave tips never become AABB.
  const geo = geoShapeLocalRing(b);
  if (geo && geo.length >= 4) {
    if (t === 'star') {
      // Always use the simple nonzero fill — self-intersecting tip–valley rings
      // break polygon-clipping when the star is the subtract/union subject.
      const simple = simpleRingFromStarFan(geo);
      if (simple && simple.length >= 4) {
        return [toWorld(simple)];
      }
    }
    const d = localBaselinePathD(b);
    // Rounded geo still try curve sample; fall back to sharp verts if sample empty.
    if (d && /[AaCcQqSsTt]/.test(d)) {
      const localRings = sampleLocalPathToRings(d, sampleStepForBox(b));
      if (localRings.length && localRings[0] && localRings[0].length >= 4) {
        return localRings.map((ring) => toWorld(ring));
      }
    }
    return [toWorld(geo)];
  }

  const d = localBaselinePathD(b);
  const localRings = d ? sampleLocalPathToRings(d, sampleStepForBox(b)) : [];

  if (localRings.length) {
    const world = localRings.map((ring) => toWorld(ring));
    if (world[0] && world[0].length >= 4) return world;
  }

  // DOM-less / empty baseline fallback (sharp AABB).
  const ring = rotateRing(rectRing(b), cx, cy, angle);
  return ring.length >= 4 ? [ring] : null;
}

function multipolygonBounds(mp: MultiPolygon) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of mp) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

function ringToPath(ring: Ring, originX: number, originY: number): string {
  if (ring.length < 2) return '';
  const closed =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1];
  const pts = closed ? ring.slice(0, -1) : ring;
  if (!pts.length) return '';

  const fmt = (x: number, y: number) =>
    `${Math.round((x - originX) * 1000) / 1000} ${Math.round((y - originY) * 1000) / 1000}`;
  let d = `M${fmt(pts[0][0], pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    d += `L${fmt(pts[i][0], pts[i][1])}`;
  }
  return `${d}Z`;
}

function multipolygonToPath(mp: MultiPolygon, originX: number, originY: number): string {
  let d = '';
  for (const poly of mp) {
    for (const ring of poly) {
      // Clip libraries keep every sample — sparsify so path-edit is not a bead string.
      d += ringToPath(sparsifyClosedRing(ring), originX, originY);
    }
  }
  return d;
}

function multipolygonHasHoles(mp: MultiPolygon): boolean {
  return mp.some((poly) => poly.length > 1);
}

function clipShapes(
  boxes: ShapeBox[],
  mode: BoolMode
): { failed: true } | { failed: false; mp: MultiPolygon } {
  const polygons: Polygon[] = [];
  for (const b of boxes) {
    const poly = shapeToPolygon(b);
    if (!poly || !poly[0] || poly[0].length < 4) return { failed: true };
    polygons.push(poly);
  }
  if (polygons.length < 2) return { failed: true };

  try {
    let mp: MultiPolygon;
    if (mode === 'union') {
      const [first, ...rest] = polygons;
      mp = union(first, ...rest);
    } else if (mode === 'subtract') {
      const [base, ...rest] = polygons;
      mp = difference(base, ...rest);
    } else if (mode === 'intersect') {
      const [first, ...rest] = polygons;
      mp = intersection(first, ...rest);
    } else {
      const [first, ...rest] = polygons;
      mp = xor(first, ...rest);
    }
    return { failed: false, mp: mp || [] };
  } catch {
    return { failed: true };
  }
}

/** Rect-only fallback when polygon-clipping is unavailable or fails. */
function rectOnlyFallback(boxes: ShapeBox[], mode: BoolMode): BoolResult | null {
  if (boxes.length < 2) return null;

  const originL = Math.min(...boxes.map((b) => b.left));
  const originT = Math.min(...boxes.map((b) => b.top));
  const originR = Math.max(...boxes.map((b) => b.left + b.width));
  const originB = Math.max(...boxes.map((b) => b.top + b.height));

  const localRect = (b: ShapeBox, reverse = false) => {
    const x = b.left - originL;
    const y = b.top - originT;
    if (reverse) {
      return `M${x} ${y + b.height}v${-b.height}h${b.width}v${b.height}h${-b.width}Z`;
    }
    return `M${x} ${y}h${b.width}v${b.height}h${-b.width}Z`;
  };

  let path = '';
  let outL = originL;
  let outT = originT;
  let outW = originR - originL;
  let outH = originB - originT;
  let fillRule: 'nonzero' | 'evenodd' = 'nonzero';

  if (mode === 'union') {
    path = boxes.map((b) => localRect(b)).join('');
  } else if (mode === 'subtract') {
    const [base, ...rest] = boxes;
    path = localRect(base) + rest.map((b) => localRect(b, true)).join('');
  } else if (mode === 'exclude') {
    fillRule = 'evenodd';
    path = boxes.map((b) => localRect(b)).join('');
  } else {
    let hit: { left: number; top: number; width: number; height: number } | null = {
      left: boxes[0].left,
      top: boxes[0].top,
      width: boxes[0].width,
      height: boxes[0].height,
    };
    for (let i = 1; i < boxes.length; i++) {
      const b = boxes[i];
      const left = Math.max(hit.left, b.left);
      const top = Math.max(hit.top, b.top);
      const right = Math.min(hit.left + hit.width, b.left + b.width);
      const bottom = Math.min(hit.top + hit.height, b.top + b.height);
      if (right <= left || bottom <= top) {
        hit = null;
        break;
      }
      hit = { left, top, width: right - left, height: bottom - top };
    }
    if (!hit) return null;
    outL = hit.left;
    outT = hit.top;
    outW = hit.width;
    outH = hit.height;
    path = `M0 0h${outW}v${outH}h${-outW}Z`;
  }

  return { path, x: outL, y: outT, width: outW, height: outH, fillRule };
}

export function computeShapeBoolean(
  boxes: ShapeBox[],
  mode: BoolMode
): { result: BoolResult | null; usedFallback: boolean; hasNonRect: boolean } {
  if (boxes.length < 2) {
    return { result: null, usedFallback: false, hasNonRect: false };
  }

  const hasNonRect = boxes.some((b) => {
    const t = String(b.shapeType || 'rect');
    return t !== 'rect';
  });
  // Subtract: punch smaller from larger (click/stack order often puts the star first).
  const ordered =
    mode === 'subtract' && boxes.length >= 2
      ? [...boxes].sort((a, b) => b.width * b.height - a.width * a.height)
      : boxes;
  const clipped = clipShapes(ordered, mode);

  // Hard failure only — empty subtract is a valid "nothing left", not AABB soup.
  if (clipped.failed === true) {
    const fallback = rectOnlyFallback(boxes, mode);
    return { result: fallback, usedFallback: Boolean(fallback), hasNonRect };
  }
  const mp = clipped.mp;
  if (!mp.length) {
    return { result: null, usedFallback: false, hasNonRect };
  }

  const { minX, minY, maxX, maxY } = multipolygonBounds(mp);
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    const fallback = rectOnlyFallback(boxes, mode);
    return { result: fallback, usedFallback: Boolean(fallback), hasNonRect };
  }

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const path = multipolygonToPath(mp, minX, minY);
  if (!path) {
    const fallback = rectOnlyFallback(boxes, mode);
    return { result: fallback, usedFallback: Boolean(fallback), hasNonRect };
  }

  return {
    result: {
      path,
      x: minX,
      y: minY,
      width,
      height,
      // Holes from subtract / donut operands need evenodd when windings are mixed.
      fillRule: multipolygonHasHoles(mp) || mode === 'exclude' ? 'evenodd' : 'nonzero',
    },
    usedFallback: false,
    hasNonRect,
  };
}

/**
 * Max painted corner radius across boolean operands (rects / paths with R).
 * Result paths keep a sharp base; paint fillets sharp verts via these attrs
 * (incl. the reentrant L elbow that boolean geometry never rounds).
 */
export function maxBooleanOperandRadius(boxes: ShapeBox[]): number {
  let maxR = 0;
  for (const b of boxes) {
    maxR = Math.max(maxR, maxRadius(radiiFromAttrs(b.attrs)));
  }
  return maxR;
}

/**
 * Copy operand roundness onto the boolean result path node.
 * createShapeNode zeroes radius*; without this, outer arcs may stay as samples
 * while new sharp corners (inner L) stay hard right angles.
 */
export function applyBooleanResultRadii(attrs: Record<string, unknown>, boxes: ShapeBox[]) {
  const maxR = maxBooleanOperandRadius(boxes);
  if (!(maxR > 0.5)) return;
  const v = Math.max(1, Math.round(maxR));
  attrs.radiusTL = v;
  attrs.radiusTR = v;
  attrs.radiusBR = v;
  attrs.radiusBL = v;
  attrs.cornerRadius = v;
  attrs.radiusLinked = 'true';
  // Linked uniform expands to every sharp corner (incl. concave elbows).
  delete attrs.radiusVertices;
}

/**
 * Apply the primary operand's fill + stroke onto a boolean result path node.
 * Uses center stroke — outside underlays often disappear on tight path AABBs.
 */
export function applyBooleanResultPaint(
  attrs: Record<string, unknown>,
  sampleAttrs: Record<string, unknown> | null | undefined,
  fallback: { stroke: string; borderWidth: number }
) {
  const src =
    sampleAttrs && typeof sampleAttrs === 'object' ? sampleAttrs : ({} as Record<string, unknown>);
  for (const key of Object.keys(src)) {
    if (
      key.startsWith('fill') ||
      key.startsWith('stroke') ||
      key.startsWith('border') ||
      key === 'opacity' ||
      key === 'blendMode' ||
      key.startsWith('gradient') ||
      key.startsWith('mesh')
    ) {
      attrs[key] = src[key];
    }
  }

  const enabled = src['stroke-enabled'];
  const visible = src['stroke-visible'];
  const strokeOff =
    enabled === false ||
    enabled === 'false' ||
    visible === false ||
    visible === 'false';
  if (strokeOff) {
    attrs['stroke-enabled'] = 'false';
    attrs['stroke-visible'] = 'false';
    return;
  }

  const bw = parseFloat(String(attrs['border-width'] ?? fallback.borderWidth));
  attrs['stroke-enabled'] = 'true';
  attrs['stroke-visible'] = 'true';
  attrs['border-color'] = String(
    attrs['border-color'] || attrs.stroke || fallback.stroke || '#333333'
  );
  attrs['border-width'] =
    Number.isFinite(bw) && bw > 0 ? bw : Math.max(1, Number(fallback.borderWidth) || 1);
  attrs.strokeAlign = 'center';
  attrs['stroke-align'] = 'center';
}
