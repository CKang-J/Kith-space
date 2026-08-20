/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/tools/pencilBrushes.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Pencil brushes — tip stamps along the path (PNG tips in /brushes/tips).
 * Vector (freehand) ink is a path-centered ribbon (pressure + taper).
 * Outline keeps sharp corners so the selection baseline stays inside the ink.
 */

import type { StrokeOptions } from 'perfect-freehand';

export type PencilBrushId = string;

export type PencilBrushDef = {
  id: PencilBrushId;
  label: string;
  /** Size multiplier relative to UI stroke width. */
  sizeFactor: number;
  options: Omit<StrokeOptions, 'size'>;
  /** Simulate pressure from stroke speed (calligraphy-like). */
  simulatePressure?: boolean;
  /** freehand (default) | stamp (image tip along path). */
  kind?: 'freehand' | 'stamp';
  /** Data-URL / URL for stamp tip (custom upload or builtin stamp). */
  stampSrc?: string;
  /** Stamp spacing as a fraction of brush size (default 0.12). Lower = more continuous. */
  spacingFactor?: number;
  /** User-uploaded brush. */
  custom?: boolean;
};

/** Legacy decorative stamp ids → treat as solid. */
const LEGACY_STAMP_IDS = new Set([
  'flower',
  'rose',
  'star',
  'heart',
  'sparkle',
  'leaf',
]);

const FREEHAND_DEFAULTS: Omit<StrokeOptions, 'size'> = {
  thinning: 0.05,
  smoothing: 0.45,
  streamline: 0.35,
  easing: (t) => t,
  start: { taper: 0, cap: true },
  end: { taper: 0, cap: true },
};

/** Builtin tip PNGs under apps/web/public/brushes/tips. */
const TIP_BASE = '/brushes/tips';

function tipUrl(file: string) {
  return `${TIP_BASE}/${file}`;
}

function tipBrush(
  id: string,
  label: string,
  tipFile: string,
  opts?: {
    sizeFactor?: number;
    /** Optional pack override; when omitted, spacing follows tool Hardness. */
    spacingFactor?: number;
    simulatePressure?: boolean;
  }
): PencilBrushDef {
  return {
    id,
    label,
    kind: 'stamp',
    sizeFactor: opts?.sizeFactor ?? 1.2,
    ...(opts?.spacingFactor != null ? { spacingFactor: opts.spacingFactor } : {}),
    simulatePressure: opts?.simulatePressure,
    stampSrc: tipUrl(tipFile),
    options: { ...FREEHAND_DEFAULTS },
  };
}

function vectorBrush(
  id: string,
  label: string,
  opts: {
    sizeFactor?: number;
    thinning?: number;
    smoothing?: number;
    streamline?: number;
    startTaper?: number;
    endTaper?: number;
  }
): PencilBrushDef {
  return {
    id,
    label,
    kind: 'freehand',
    sizeFactor: opts.sizeFactor ?? 1,
    options: {
      thinning: opts.thinning ?? 0.4,
      smoothing: opts.smoothing ?? 0.5,
      streamline: opts.streamline ?? 0.4,
      easing: (t) => t,
      start: { taper: opts.startTaper ?? 0, cap: true },
      end: { taper: opts.endTaper ?? 0, cap: true },
    },
  };
}

/**
 * Filled SVG outlines (no tip texture).
 * Stay sharp at any zoom — not raster tip stamps.
 */
export const VECTOR_INK_BRUSHES: PencilBrushDef[] = [
  // Balanced pressure ink (default vector) — width from hardware pressure only.
  vectorBrush('vector-ink', '矢量墨线', {
    thinning: 0.4,
    smoothing: 0.5,
    streamline: 0.4,
  }),
  // Near-constant width — like a marker / pen stroke.
  vectorBrush('vector-even', '矢量匀线', {
    sizeFactor: 1,
    thinning: 0.05,
    smoothing: 0.55,
    streamline: 0.45,
  }),
  // Strong pressure range — calligraphy feel.
  vectorBrush('vector-calligraphy', '矢量书法', {
    sizeFactor: 1.15,
    thinning: 0.72,
    smoothing: 0.42,
    streamline: 0.35,
  }),
];

/** @deprecated Prefer VECTOR_INK_BRUSHES[0]; kept for older imports. */
export const VECTOR_INK_BRUSH = VECTOR_INK_BRUSHES[0];

/**
 * Builtin tip stamps (PS-like tip texture along the path).
 * Spacing/hardness are tool params; uploads share the same stamp path.
 */
export const TIP_STAMP_BRUSHES: PencilBrushDef[] = [
  tipBrush('solid', '硬笔', 'hard-round.png', { sizeFactor: 1 }),
  tipBrush('pencil-hb', '铅笔', 'pencil.png', { sizeFactor: 0.95 }),
  tipBrush('soft', '软笔', 'soft-round.png', { sizeFactor: 1.35 }),
  tipBrush('fountain', '钢笔', 'needle.png', { sizeFactor: 0.7 }),
  tipBrush('calligraphy', '毛笔', 'calligraphy.png', { sizeFactor: 1.45 }),
  tipBrush('brushpen', '签字笔', 'hard-round.png', { sizeFactor: 1.1 }),
  tipBrush('marker', '马克笔', 'marker.png', { sizeFactor: 1.65 }),
  tipBrush('highlighter', '荧光笔', 'marker.png', { sizeFactor: 2.2 }),
  tipBrush('chalk', '粉笔', 'chalk.png', { sizeFactor: 1.45 }),
  tipBrush('charcoal', '炭笔', 'charcoal.png', { sizeFactor: 1.55 }),
  tipBrush('bristle', '鬃毛', 'bristle.png', { sizeFactor: 1.55 }),
  tipBrush('airbrush', '喷枪', 'airbrush.png', { sizeFactor: 2.0 }),
  tipBrush('watercolor', '水彩', 'watercolor.png', { sizeFactor: 1.7 }),
  tipBrush('needle', '细针', 'needle.png', { sizeFactor: 0.5 }),
  tipBrush('bold', '粗头', 'bold.png', { sizeFactor: 2.3 }),
];

/** Builtin wheel — vector brushes first, then tip stamps. */
export const PENCIL_BRUSHES: PencilBrushDef[] = [...VECTOR_INK_BRUSHES, ...TIP_STAMP_BRUSHES];

/** Tool / store default — first wheel entry (矢量墨线). */
export const DEFAULT_PENCIL_BRUSH_ID: PencilBrushId = VECTOR_INK_BRUSHES[0].id;

/** Open portable pack (JSON + tip data-URLs). Not Photoshop .abr. */
export const BRUSH_PACK_FORMAT = 'recombyn-brushpack' as const;
export const BRUSH_PACK_VERSION = 1 as const;

export type BrushPackV1 = {
  format: typeof BRUSH_PACK_FORMAT;
  version: typeof BRUSH_PACK_VERSION;
  name?: string;
  brushes: Array<{
    id: string;
    label: string;
    kind?: 'freehand' | 'stamp';
    sizeFactor?: number;
    spacingFactor?: number;
    simulatePressure?: boolean;
    stampSrc?: string;
    options?: {
      thinning?: number;
      smoothing?: number;
      streamline?: number;
      start?: { taper?: number; cap?: boolean };
      end?: { taper?: number; cap?: boolean };
    };
  }>;
};

/** Runtime custom brushes (hydrated from localStorage). */
let customBrushes: PencilBrushDef[] = [];

export function getCustomPencilBrushes(): PencilBrushDef[] {
  return customBrushes.slice();
}

export function setCustomPencilBrushes(list: PencilBrushDef[]) {
  customBrushes = Array.isArray(list)
    ? list.filter((b) => b?.id && (b.kind !== 'stamp' || Boolean(b.stampSrc)))
    : [];
}

/** Legacy ids → nearest builtin tip / vector. */
const LEGACY_FREEHAND_ALIAS: Record<string, string> = {
  crayon: 'chalk',
  dry: 'bristle',
  ink: 'calligraphy',
  sketch: 'pencil-hb',
  'tip-soft': 'soft',
  'tip-hard': 'solid',
  'tip-chalk': 'chalk',
  'tip-bristle': 'bristle',
  /** Older freehand-only seeds → vector family. */
  freehand: 'vector-ink',
  vector: 'vector-ink',
  blob: 'vector-ink',
  even: 'vector-even',
  'vector-uniform': 'vector-even',
  'vector-marker': 'vector-even',
  'vector-brush': 'vector-calligraphy',
  'vector-script': 'vector-calligraphy',
};

export function listPencilBrushes(): PencilBrushDef[] {
  return [...PENCIL_BRUSHES, ...customBrushes];
}

export function findPencilBrush(id: string | undefined | null): PencilBrushDef {
  // Prefer solid tip as fallback (not vector-ink) so unknown ids stay textured.
  const fallback = TIP_STAMP_BRUSHES[0] || PENCIL_BRUSHES[0];
  if (!id || LEGACY_STAMP_IDS.has(id)) return fallback;
  const resolved = LEGACY_FREEHAND_ALIAS[id] || id;
  const custom = customBrushes.find((b) => b.id === id || b.id === resolved);
  if (custom) return custom;
  return PENCIL_BRUSHES.find((b) => b.id === resolved) || fallback;
}

export function isStampBrush(id: string | undefined | null, stampSrc?: string | null) {
  if (stampSrc) return true;
  const b = findPencilBrush(id);
  return b.kind === 'stamp' && Boolean(b.stampSrc);
}

export type Pt = { x: number; y: number; pressure?: number };

export function brushSize(brush: PencilBrushDef, strokeWidth: number) {
  return Math.max(1, (Number(strokeWidth) || 1) * brush.sizeFactor);
}

/**
 * Dab spacing from tip size + tool Hardness.
 * Optional `brush.spacingFactor` is a pack override (uploads / .brushpack).
 *
 * Keep spacing well below tip size so stamps overlap into a continuous stroke.
 */
export function stampSpacing(
  brush: PencilBrushDef,
  strokeWidth: number,
  hardness: number = 80
) {
  const size = brushSize(brush, strokeWidth);
  const f = stampSpacingFrac(brush, hardness);
  return Math.max(size * 0.04, size * f);
}

/**
 * Soft stop for buildStampDabs — never sparsify spacing into dots.
 * SVG tip commits stay under this; live canvas preview uses STAMP_MAX_DABS_LIVE.
 */
export const STAMP_MAX_DABS = 4000;
/** Live canvas preview dab cap — coarsen spacing before hitting this (see spacingScale). */
export const STAMP_MAX_DABS_LIVE = 2400;
/** Max new tip draws per animation frame so fast strokes don't stall the main thread. */
export const STAMP_LIVE_BLIT_BUDGET = 140;

export function polylineLength(points: Pt[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i += 1) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return len;
}

/** Fixed tip spacing — never enlarge for dab budget. */
export function stampSpacingForPath(
  brush: PencilBrushDef,
  strokeWidth: number,
  hardness: number,
  _points?: Pt[],
  _maxDabs?: number
): number {
  void _points;
  void _maxDabs;
  return stampSpacing(brush, strokeWidth, hardness);
}

/** Heavy press grows tip up to this × slider size. */
const STAMP_PRESSURE_SIZE_RANGE = 3;
/** Max gap (scene px) before input interpolation. */
export const STROKE_GAP_INTERP = 4;
/** Tip lag along stroke before stamping (legacy bezier path; unused by buildStampDabs). */
const STAMP_LAG_DISTANCE = 5;
/** Reference spacing for flow compensation. */
const FLOW_SPACING_REF = 0.06;

export type StampDab = {
  x: number;
  y: number;
  size: number;
  /** Per-dab flow alpha (0-1), before stroke opacity. */
  opacity: number;
  /** Degrees — tip follows path tangent. */
  angle: number;
};

export function pointHasPressure(p: Pt): boolean {
  return typeof p.pressure === 'number' && Number.isFinite(p.pressure);
}

/** Cubic-bezier pressure curve LUT (default linear). */
type PressureCurveCp = { x: number; y: number };
let pressureCurveCp1: PressureCurveCp = { x: 0.25, y: 0.25 };
let pressureCurveCp2: PressureCurveCp = { x: 0.75, y: 0.75 };
let pressureCurveLut: number[] = [];

function bezierComp(t: number, p0: number, p1: number, p2: number, p3: number) {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function rebuildPressureCurveLut() {
  const samples = 512;
  const pts: PressureCurveCp[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    pts.push({
      x: bezierComp(t, 0, pressureCurveCp1.x, pressureCurveCp2.x, 1),
      y: bezierComp(t, 0, pressureCurveCp1.y, pressureCurveCp2.y, 1),
    });
  }
  const lut: number[] = [];
  let pi = 0;
  const n = 256;
  for (let i = 0; i < n; i += 1) {
    const targetX = i / (n - 1);
    while (pi < pts.length - 1 && pts[pi + 1].x < targetX) pi += 1;
    if (pi >= pts.length - 1) {
      lut.push(pts[pts.length - 1].y);
      continue;
    }
    const a = pts[pi];
    const b = pts[pi + 1];
    const dx = b.x - a.x;
    const frac = dx === 0 ? 0 : (targetX - a.x) / dx;
    lut.push(a.y + (b.y - a.y) * frac);
  }
  pressureCurveLut = lut;
}
rebuildPressureCurveLut();

export function setStampPressureCurve(cp1: PressureCurveCp, cp2: PressureCurveCp) {
  pressureCurveCp1 = {
    x: Math.min(1, Math.max(0, cp1.x)),
    y: Math.min(1, Math.max(0, cp1.y)),
  };
  pressureCurveCp2 = {
    x: Math.min(1, Math.max(0, cp2.x)),
    y: Math.min(1, Math.max(0, cp2.y)),
  };
  rebuildPressureCurveLut();
}

export function resetStampPressureCurve() {
  setStampPressureCurve({ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 });
}

function evaluatePressureCurve(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (!pressureCurveLut.length) return t;
  const idx = t * (pressureCurveLut.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, pressureCurveLut.length - 1);
  const frac = idx - lo;
  return pressureCurveLut[lo] * (1 - frac) + pressureCurveLut[hi] * frac;
}

function stampPressureOrNull(pressure?: number): number | null {
  if (typeof pressure !== 'number' || !Number.isFinite(pressure)) return null;
  return evaluatePressureCurve(Math.min(1, Math.max(0, pressure)));
}

/** Spacing as a fraction of tip size — keep well under ink diameter so soft tips merge. */
export function stampSpacingFrac(brush: PencilBrushDef, hardness: number = 80): number {
  const h = Math.max(0, Math.min(1, (Number(hardness) || 80) / 100));
  const override = Number(brush.spacingFactor);
  // Clamp pack overrides — large factors leave visible gaps between soft tips.
  if (Number.isFinite(override) && override > 0) {
    return Math.min(0.12, Math.max(0.03, override));
  }
  // Soft denser, hard slightly sparser — soft tips need ~5% to hide feather gaps.
  return 0.04 + h * 0.04; // 4% … 8%
}

export function stampDabSize(
  brush: PencilBrushDef,
  strokeWidth: number,
  pressure?: number,
  pressureEnabled = true
) {
  const base = brushSize(brush, strokeWidth);
  if (!pressureEnabled) return base;
  const p = stampPressureOrNull(pressure);
  if (p == null) return base;
  const maxSize = base * STAMP_PRESSURE_SIZE_RANGE;
  return Math.max(1, base + p * (maxSize - base));
}

export function stampDabFlow(
  pressure: number | undefined,
  pressureEnabled: boolean,
  spacingFrac: number
): number {
  let flow = 1;
  if (pressureEnabled) {
    const p = stampPressureOrNull(pressure);
    flow = p == null ? 1 : Math.max(0.08, p);
  }
  const spacingMul = Math.min(2.5, Math.max(0.35, spacingFrac / FLOW_SPACING_REF));
  return Math.min(1, Math.max(0.05, flow * spacingMul));
}

export function normalizeStampPressures(points: Pt[]): Pt[] {
  if (points.length < 1) return [];
  if (!points.some(pointHasPressure)) return points.map((p) => ({ x: p.x, y: p.y }));

  let ema =
    typeof points[0].pressure === 'number' && Number.isFinite(points[0].pressure)
      ? Math.min(1, Math.max(0, points[0].pressure))
      : null;
  return points.map((p, i) => {
    if (!pointHasPressure(p)) {
      return ema == null ? { x: p.x, y: p.y } : { x: p.x, y: p.y, pressure: ema };
    }
    const raw = Math.min(1, Math.max(0, p.pressure as number));
    ema = i === 0 || ema == null ? raw : ema * 0.25 + raw * 0.75;
    return { x: p.x, y: p.y, pressure: ema };
  });
}

function pressureAtSegment(a: Pt, b: Pt, t: number): number | undefined {
  const ha = pointHasPressure(a);
  const hb = pointHasPressure(b);
  if (!ha && !hb) return undefined;
  const pa = ha ? Math.min(1, Math.max(0, a.pressure as number)) : 0;
  const pb = hb ? Math.min(1, Math.max(0, b.pressure as number)) : pa;
  if (!ha) return pb;
  if (!hb) return pa;
  return pa + (pb - pa) * t;
}

export function interpolateStrokeGaps(points: Pt[], maxGap: number = STROKE_GAP_INTERP): Pt[] {
  if (points.length < 2 || maxGap <= 0) return points.map((p) => ({ ...p }));
  const out: Pt[] = [{ ...points[0] }];
  for (let i = 1; i < points.length; i += 1) {
    const a = out[out.length - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist > maxGap) {
      const steps = Math.ceil(dist / maxGap);
      for (let s = 1; s < steps; s += 1) {
        const t = s / steps;
        const pr = pressureAtSegment(a, b, t);
        out.push({
          x: a.x + dx * t,
          y: a.y + dy * t,
          ...(pr != null ? { pressure: pr } : {}),
        });
      }
    }
    out.push({ ...b });
  }
  return out;
}

function stampControlPoint(p1: Pt, p2: Pt, p3: Pt): { x: number; y: number } {
  return {
    x: p2.x + (p2.x - p1.x) * 0.15 + (p3.x - p2.x) * 0.15,
    y: p2.y + (p2.y - p1.y) * 0.15 + (p3.y - p2.y) * 0.15,
  };
}

function quadBezierPoint(
  t: number,
  a: Pt,
  c: { x: number; y: number },
  b: Pt
): { x: number; y: number } {
  const mt = 1 - t;
  return {
    x: mt * mt * a.x + 2 * mt * t * c.x + t * t * b.x,
    y: mt * mt * a.y + 2 * mt * t * c.y + t * t * b.y,
  };
}

export function smoothStrokeBezierLag(
  points: Pt[],
  spacing: number,
  lagDistance: number = STAMP_LAG_DISTANCE
): Pt[] {
  if (points.length < 2) return points.map((p) => ({ ...p }));
  const space = Math.max(0.5, spacing);
  const lag = Math.max(0, lagDistance);
  const out: Pt[] = [{ ...points[0] }];

  const emitSegment = (from: Pt, to: Pt, via?: Pt) => {
    let dist = Math.hypot(to.x - from.x, to.y - from.y);
    if (dist <= 1e-6) return;
    let end = to;
    if (dist > lag + space) {
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      end = {
        x: from.x + Math.cos(angle) * (dist - lag),
        y: from.y + Math.sin(angle) * (dist - lag),
        ...(pointHasPressure(to) ? { pressure: to.pressure } : {}),
      };
      dist -= lag;
    }
    const control = via
      ? stampControlPoint(via, from, end)
      : { x: (from.x + end.x) / 2, y: (from.y + end.y) / 2 };
    const steps = Math.max(1, Math.ceil(dist / space));
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      const pt = quadBezierPoint(t, from, control, end);
      const pr = pressureAtSegment(from, end, t);
      out.push({
        x: pt.x,
        y: pt.y,
        ...(pr != null ? { pressure: pr } : {}),
      });
    }
  };

  if (points.length === 2) {
    emitSegment(points[0], points[1]);
  } else {
    for (let i = 1; i < points.length; i += 1) {
      emitSegment(points[i - 1], points[i], i >= 2 ? points[i - 2] : undefined);
    }
  }

  const last = points[points.length - 1];
  const tip = out[out.length - 1];
  if (!tip || Math.hypot(last.x - tip.x, last.y - tip.y) > 0.5) out.push({ ...last });
  else out[out.length - 1] = { ...last };
  return out;
}

function materializeDab(
  p: Pt,
  brush: PencilBrushDef,
  strokeWidth: number,
  pressureOn: boolean,
  spacingFrac: number,
  taper: number
): StampDab {
  // No tip rotation — rotating soft tips leaves visible gaps.
  const sized = stampDabSize(brush, strokeWidth, p.pressure, pressureOn) * taper;
  const flow = stampDabFlow(p.pressure, pressureOn, spacingFrac) * (0.55 + 0.45 * taper);
  return {
    x: p.x,
    y: p.y,
    size: Math.max(1, sized),
    opacity: Math.min(1, Math.max(0.05, flow)),
    angle: 0,
  };
}

function stampEndpointTaperMul(
  distFromStart: number,
  distFromEnd: number,
  tipSize: number
): number {
  const taper = Math.max(tipSize * 0.9, 2);
  const edge = Math.min(distFromStart, distFromEnd);
  if (edge >= taper) return 1;
  const t = Math.max(0, Math.min(1, edge / taper));
  return 0.28 + 0.72 * (t * t * (3 - 2 * t));
}

/**
 * Prepare points: gap fill only.
 * Do not EMA-smooth pressure here — that reshapes earlier dabs every frame
 * (live jitter) and makes commit differ from the preview centerline.
 */
function prepareStampPoints(
  points: Pt[],
  pressureOn: boolean
): Pt[] {
  const pts = pressureOn
    ? points.map((p) =>
        pointHasPressure(p)
          ? { x: p.x, y: p.y, pressure: p.pressure }
          : { x: p.x, y: p.y }
      )
    : points.map((p) => ({ x: p.x, y: p.y }));
  return interpolateStrokeGaps(pts, STROKE_GAP_INTERP);
}

/**
 * Stamp pipeline: walk by arc length, step = size × spacing, no tip rotation.
 * Uses an accumulator so short input segments still get dense overlapping tips.
 */
export function buildStampDabs(
  points: Pt[],
  brush: PencilBrushDef,
  strokeWidth: number,
  opts: {
    hardness?: number;
    pressureEnabled?: boolean;
    maxDabs?: number;
    /** Skip endpoint taper rematerialize (live preview — keeps ink snappy). */
    skipTaper?: boolean;
  } = {}
): StampDab[] {
  const pressureOn = opts.pressureEnabled !== false;
  const hardness = opts.hardness ?? 80;
  const maxDabs = opts.maxDabs ?? STAMP_MAX_DABS;
  const spacingFrac = stampSpacingFrac(brush, hardness);
  const pts = prepareStampPoints(points, pressureOn);
  if (pts.length < 1) return [];

  const out: StampDab[] = [];
  out.push(materializeDab(pts[0], brush, strokeWidth, pressureOn, spacingFrac, 1));
  if (pts.length < 2) return out;

  let carry = 0; // distance already covered toward the next dab
  for (let i = 1; i < pts.length; i += 1) {
    if (out.length >= maxDabs) break;
    const prev = pts[i - 1];
    const curr = pts[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const segLen = Math.hypot(dx, dy);
    if (segLen < 1e-6) continue;

    const sizeA = stampDabSize(brush, strokeWidth, prev.pressure, pressureOn);
    const sizeB = stampDabSize(brush, strokeWidth, curr.pressure, pressureOn);
    // Step from the smaller tip so pressure spikes don't open gaps.
    const step = Math.max(0.25, Math.min(sizeA, sizeB) * spacingFrac);

    let consumed = 0;
    while (out.length < maxDabs) {
      const need = step - carry;
      if (consumed + need > segLen + 1e-9) {
        carry += segLen - consumed;
        break;
      }
      consumed += need;
      carry = 0;
      const t = consumed / segLen;
      const pr = pressureAtSegment(prev, curr, t);
      const sample: Pt = {
        x: prev.x + dx * t,
        y: prev.y + dy * t,
        ...(pr != null ? { pressure: pr } : {}),
      };
      out.push(materializeDab(sample, brush, strokeWidth, pressureOn, spacingFrac, 1));
    }
  }

  if (opts.skipTaper || out.length < 2) return out;

  const base = brushSize(brush, strokeWidth);
  const segLens: number[] = [0];
  for (let i = 1; i < out.length; i += 1) {
    segLens.push(
      segLens[i - 1] + Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y)
    );
  }
  const total = segLens[segLens.length - 1] || 0;
  for (let i = 0; i < out.length; i += 1) {
    const tMul = stampEndpointTaperMul(segLens[i], total - segLens[i], base);
    const idx = Math.min(
      pts.length - 1,
      Math.max(0, Math.round((segLens[i] / Math.max(total, 1e-6)) * (pts.length - 1)))
    );
    out[i] = materializeDab(
      { x: out[i].x, y: out[i].y, pressure: pts[idx]?.pressure },
      brush,
      strokeWidth,
      pressureOn,
      spacingFrac,
      tMul
    );
  }
  return out;
}

/** Incremental live-preview stamp walk — only extends when new input points arrive. */
export type StampLiveWalk = {
  dabs: StampDab[];
  carry: number;
  /** Number of input points already walked (segment ends at walkedPts - 1). */
  walkedPts: number;
};

export function emptyStampLiveWalk(): StampLiveWalk {
  return { dabs: [], carry: 0, walkedPts: 0 };
}

/**
 * Extend live stamp dabs from new pointer samples.
 * Assumes `points` are already gap-filled (capture path); skips endpoint taper.
 *
 * `spacingScale` / `minStep` sparsify live previews so the tip can keep up when
 * drawing fast; commit still uses buildStampDabs at full density.
 */
export function extendStampLiveWalk(
  walk: StampLiveWalk,
  points: Pt[],
  brush: PencilBrushDef,
  strokeWidth: number,
  opts: {
    hardness?: number;
    pressureEnabled?: boolean;
    maxDabs?: number;
    /** ≥1 — larger = fewer live dabs (preview only). */
    spacingScale?: number;
    minStep?: number;
  } = {}
): StampLiveWalk {
  const pressureOn = opts.pressureEnabled !== false;
  const hardness = opts.hardness ?? 80;
  const maxDabs = opts.maxDabs ?? STAMP_MAX_DABS_LIVE;
  const spacingScale = Math.max(1, Number(opts.spacingScale) || 1);
  const minStep = Math.max(0.25, Number(opts.minStep) || 0.25);
  const spacingFrac = stampSpacingFrac(brush, hardness);

  // Points replaced/shrunk (streamline on commit shouldn't hit this mid-draw).
  if (points.length < walk.walkedPts || walk.walkedPts === 0) {
    walk = emptyStampLiveWalk();
  }
  if (points.length < 1) return walk;

  const dabs = walk.dabs;
  let carry = walk.carry;
  let walkedPts = walk.walkedPts;

  if (walkedPts === 0) {
    dabs.push(materializeDab(points[0], brush, strokeWidth, pressureOn, spacingFrac, 1));
    walkedPts = 1;
    carry = 0;
  }

  for (let i = Math.max(1, walkedPts); i < points.length; i += 1) {
    if (dabs.length >= maxDabs) {
      // Do not mark remaining points walked — caller remeshes with coarser spacing.
      return { dabs, carry, walkedPts };
    }
    const prev = points[i - 1];
    const curr = points[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const segLen = Math.hypot(dx, dy);
    if (segLen < 1e-6) {
      walkedPts = i + 1;
      continue;
    }

    const sizeA = stampDabSize(brush, strokeWidth, prev.pressure, pressureOn);
    const sizeB = stampDabSize(brush, strokeWidth, curr.pressure, pressureOn);
    const step = Math.max(minStep, Math.min(sizeA, sizeB) * spacingFrac * spacingScale);

    let consumed = 0;
    let segDone = false;
    while (dabs.length < maxDabs) {
      const need = step - carry;
      if (consumed + need > segLen + 1e-9) {
        carry += segLen - consumed;
        segDone = true;
        break;
      }
      consumed += need;
      carry = 0;
      const t = consumed / segLen;
      const pr = pressureAtSegment(prev, curr, t);
      const sample: Pt = {
        x: prev.x + dx * t,
        y: prev.y + dy * t,
        ...(pr != null ? { pressure: pr } : {}),
      };
      dabs.push(materializeDab(sample, brush, strokeWidth, pressureOn, spacingFrac, 1));
    }
    if (!segDone) {
      // Hit dab cap mid-segment — keep walkedPts at i so remesh covers the rest.
      return { dabs, carry: 0, walkedPts: i };
    }
    walkedPts = i + 1;
  }

  return { dabs, carry, walkedPts };
}

/** Draw stamp dabs onto a 2D context (live preview + brush list). */
export function paintStampDabs(
  ctx: CanvasRenderingContext2D,
  dabs: StampDab[],
  tip: CanvasImageSource,
  strokeOpacity = 1,
  fromIndex = 0,
  toIndex?: number,
  quality: 'low' | 'medium' | 'high' = 'high'
) {
  ctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) {
    (ctx as CanvasRenderingContext2D).imageSmoothingQuality = quality;
  }
  const start = Math.max(0, Math.min(dabs.length, fromIndex | 0));
  const end =
    toIndex == null
      ? dabs.length
      : Math.max(start, Math.min(dabs.length, toIndex | 0));
  for (let i = start; i < end; i += 1) {
    const dab = dabs[i];
    const size = Math.max(1, dab.size);
    const alpha = strokeOpacity * Math.max(0.08, Math.min(1, dab.opacity));
    if (alpha <= 0.01) continue;
    ctx.globalAlpha = alpha;
    ctx.drawImage(tip, dab.x - size / 2, dab.y - size / 2, size, size);
  }
  ctx.globalAlpha = 1;
}

/** Convert input points for outline freehand (real pressure only; else constant). */
export function toStrokeInput(
  points: Pt[],
  brush: PencilBrushDef
): Array<[number, number, number]> {
  const hasReal = points.some(pointHasPressure);
  if (hasReal) {
    return points.map((p) => [
      p.x,
      p.y,
      pointHasPressure(p) ? Math.min(1, Math.max(0, p.pressure as number)) : 0.5,
    ]);
  }
  // No hardware pressure — constant width (do not invent velocity pressure).
  void brush;
  return points.map((p) => [p.x, p.y, 0.5]);
}

/** Outline polygon → SVG path `d` (quadratic midpoints, closed). */
export function getSvgPathFromStroke(stroke: number[][]): string {
  if (!stroke.length) return '';
  const d: (string | number)[] = [];
  const first = stroke[0];
  d.push('M', first[0], first[1], 'Q');
  for (let i = 1; i < stroke.length; i += 1) {
    const [x0, y0] = stroke[i];
    const [x1, y1] = stroke[(i + 1) % stroke.length];
    d.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  d.push('Z');
  return d.join(' ');
}

export type PencilStrokeDrawOpts = {
  /** Maps stroke-linecap onto freehand start/end caps. */
  linecap?: 'butt' | 'round' | 'square';
  /** Per-point pressure 0–1 (same length as points). Overrides speed simulation when set. */
  pressures?: number[];
  /** When false, force constant pressure (ignore brush simulatePressure + real pressure). */
  pressureEnabled?: boolean;
  /**
   * Tip / freehand hardness 0–100.
   * Stamp: tip edge + dab spacing. Freehand: soft → more pressure width + taper; hard → flatter.
   */
  hardness?: number;
  /**
   * When false, skip RDP simplify (live preview — simplify reshapes the tail every
   * frame and reads as jitter). Commit should leave this unset / true.
   */
  simplify?: boolean;
  /**
   * `quad` (default): midpoint Q silhouette for paint.
   * `linear`: M/L/Z polygon — for 轮廓化 path-edit (Q midpoints resist sparsify).
   */
  pathStyle?: 'quad' | 'linear';
};

function clampStrokeHardness(hardness?: number | null): number {
  const n = Number(hardness);
  if (!Number.isFinite(n)) return 80;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Soft (0) → more taper; hard (100) → flatter ends. */
function applyFreehandHardness(
  options: Omit<StrokeOptions, 'size'>,
  hardness0to100: number
): Omit<StrokeOptions, 'size'> {
  const h = clampStrokeHardness(hardness0to100) / 100;
  const taperMul = 1.55 - h * 1.3; // soft≈1.55, hard≈0.25
  const start = (options.start || {}) as { taper?: number; cap?: boolean };
  const end = (options.end || {}) as { taper?: number; cap?: boolean };
  return {
    ...options,
    smoothing: Math.min(0.85, Number(options.smoothing ?? 0.5) + (1 - h) * 0.1),
    start: {
      ...start,
      taper: Math.max(0, Number(start.taper ?? 0) * taperMul),
      cap: start.cap !== false,
    },
    end: {
      ...end,
      taper: Math.max(0, Number(end.taper ?? 0) * taperMul),
      cap: end.cap !== false,
    },
  };
}

function extendPolylineEnds(points: Pt[], pad: number): Pt[] {
  if (points.length < 2 || pad <= 0) return points;
  const out = points.slice();
  const a0 = out[0];
  const a1 = out[1];
  const d0 = Math.hypot(a1.x - a0.x, a1.y - a0.y) || 1;
  out[0] = {
    x: a0.x - ((a1.x - a0.x) / d0) * pad,
    y: a0.y - ((a1.y - a0.y) / d0) * pad,
    ...(a0.pressure != null ? { pressure: a0.pressure } : {}),
  };
  const b0 = out[out.length - 2];
  const b1 = out[out.length - 1];
  const d1 = Math.hypot(b1.x - b0.x, b1.y - b0.y) || 1;
  out[out.length - 1] = {
    x: b1.x + ((b1.x - b0.x) / d1) * pad,
    y: b1.y + ((b1.y - b0.y) / d1) * pad,
    ...(b1.pressure != null ? { pressure: b1.pressure } : {}),
  };
  return out;
}

/** Left-hand unit normal of directed segment a→b. */
function segmentLeftNormal(ax: number, ay: number, bx: number, by: number): [number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  return [-dy / len, dx / len];
}

/** Half-widths along the polyline from real pointer pressure only (no geometric fake taper). */
function ribbonRadiiAlongPath(
  pts: Pt[],
  size: number,
  thinning: number,
  pressureOn: boolean
): number[] {
  const thin = Math.max(0, Math.min(0.92, thinning));
  // thinning 0.4 → min 60% size; thinning 0.72 → ~28% (calligraphy).
  const minScale = Math.max(0.08, 1 - thin);
  const anyPressure = pressureOn && pts.some(pointHasPressure);
  const radii: number[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    let diam = size;
    if (anyPressure) {
      const raw = pointHasPressure(pts[i])
        ? Math.min(1, Math.max(0, pts[i].pressure as number))
        : 0.5;
      // Same curve LUT as stamp tips — hardware pressure → width.
      const p = evaluatePressureCurve(raw);
      diam = size * (minScale + (1 - minScale) * p);
    }
    radii.push(Math.max(0.35, diam / 2));
  }
  return radii;
}

/** Semicircle from `from` → `to` around `center`, passing through `via` side. */
function roundCapPoints(
  center: Pt,
  from: [number, number],
  to: [number, number],
  via: [number, number],
  steps = 5
): number[][] {
  const a0 = Math.atan2(from[1] - center.y, from[0] - center.x);
  const a1 = Math.atan2(to[1] - center.y, to[0] - center.x);
  const aVia = Math.atan2(via[1] - center.y, via[0] - center.x);
  const r = Math.hypot(from[0] - center.x, from[1] - center.y) || 1;
  function sweep(fromA: number, toA: number): number {
    let d = toA - fromA;
    while (d <= -Math.PI) d += Math.PI * 2;
    while (d > Math.PI) d -= Math.PI * 2;
    return d;
  }
  // Choose direction so the arc passes near `via`.
  let delta = sweep(a0, a1);
  const midDirect = a0 + delta / 2;
  let midErr = Math.abs(sweep(midDirect, aVia));
  const deltaAlt = delta > 0 ? delta - Math.PI * 2 : delta + Math.PI * 2;
  const midAlt = a0 + deltaAlt / 2;
  if (Math.abs(sweep(midAlt, aVia)) < midErr) delta = deltaAlt;
  const out: number[][] = [];
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const a = a0 + delta * t;
    out.push([center.x + Math.cos(a) * r, center.y + Math.sin(a) * r]);
  }
  return out;
}

/**
 * Filled outline centered on the polyline (round caps, bisector joins).
 * Keeps every input vertex inside the silhouette.
 */
function centeredRibbonOutline(pts: Pt[], radii: number[]): number[][] {
  const n = pts.length;
  if (n < 2) return [];
  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];

  for (let i = 0; i < n; i += 1) {
    const r = radii[i] ?? radii[radii.length - 1] ?? 1;
    const p = pts[i];
    let nx: number;
    let ny: number;
    if (i === 0) {
      [nx, ny] = segmentLeftNormal(p.x, p.y, pts[1].x, pts[1].y);
    } else if (i === n - 1) {
      [nx, ny] = segmentLeftNormal(pts[i - 1].x, pts[i - 1].y, p.x, p.y);
    } else {
      const [n0x, n0y] = segmentLeftNormal(pts[i - 1].x, pts[i - 1].y, p.x, p.y);
      const [n1x, n1y] = segmentLeftNormal(p.x, p.y, pts[i + 1].x, pts[i + 1].y);
      let ax = n0x + n1x;
      let ay = n0y + n1y;
      const al = Math.hypot(ax, ay);
      if (al < 1e-6) {
        nx = n0x;
        ny = n0y;
      } else {
        // Unit bisector × r (no miter inflate) — path stays inside joins.
        nx = ax / al;
        ny = ay / al;
      }
    }
    left.push([p.x + nx * r, p.y + ny * r]);
    right.push([p.x - nx * r, p.y - ny * r]);
  }

  const p0 = pts[0];
  const p1 = pts[1];
  const t0x = p1.x - p0.x;
  const t0y = p1.y - p0.y;
  const t0l = Math.hypot(t0x, t0y) || 1;
  const startVia: [number, number] = [p0.x - (t0x / t0l) * radii[0], p0.y - (t0y / t0l) * radii[0]];

  const pNm1 = pts[n - 2];
  const pN = pts[n - 1];
  const t1x = pN.x - pNm1.x;
  const t1y = pN.y - pNm1.y;
  const t1l = Math.hypot(t1x, t1y) || 1;
  const endVia: [number, number] = [
    pN.x + (t1x / t1l) * radii[n - 1],
    pN.y + (t1y / t1l) * radii[n - 1],
  ];

  const startCap = roundCapPoints(p0, right[0], left[0], startVia);
  const endCap = roundCapPoints(pN, left[n - 1], right[n - 1], endVia);

  return startCap.concat(left).concat(endCap).concat(right.reverse());
}

export function outlinePathFromPoints(
  points: Pt[],
  strokeWidth: number,
  brushId?: string | null,
  strokeOpts?: PencilStrokeDrawOpts
): string {
  if (points.length < 2) return '';
  const brush = findPencilBrush(brushId);
  const size = brushSize(brush, strokeWidth);
  let pts: Pt[] = points.map((p, i) => {
    const pr = strokeOpts?.pressures?.[i];
    return pr != null && Number.isFinite(pr) ? { ...p, pressure: pr } : { ...p };
  });
  // Drop colinear noise before ribbon (commit). Live preview skips this —
  // RDP reshaping the tail every sample reads as jitter.
  if (strokeOpts?.simplify !== false) {
    pts = simplifyPencilCenterline(pts, pencilSimplifyEpsilon(size));
  }
  const options: Omit<StrokeOptions, 'size'> = applyFreehandHardness(
    {
      ...(brush.kind === 'stamp' ? FREEHAND_DEFAULTS : brush.options),
    },
    strokeOpts?.hardness ?? 80
  );
  const hard01 = clampStrokeHardness(strokeOpts?.hardness) / 100;
  const cap = strokeOpts?.linecap;
  if (cap === 'square') {
    pts = extendPolylineEnds(pts, size * 0.45);
  }
  const pressureOn = strokeOpts?.pressureEnabled !== false;
  if (!pressureOn) {
    pts = pts.map((p) => ({ x: p.x, y: p.y }));
  }
  const hasRealPressure = pressureOn && pts.some(pointHasPressure);
  // Soft brush → stronger pressure dynamic range; hard → flatter.
  const baseThin = Number(options.thinning ?? 0.4);
  const thinning = hasRealPressure
    ? Math.max(0.12, baseThin * (1.15 - hard01 * 0.55))
    : 0;
  const radii = ribbonRadiiAlongPath(pts, size, thinning, hasRealPressure);
  const outline = centeredRibbonOutline(pts, radii);
  if (strokeOpts?.pathStyle === 'linear') {
    if (outline.length < 3) return '';
    return `M ${outline.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`;
  }
  return getSvgPathFromStroke(outline);
}

/** Split a polyline into dash / gap segments (dasharray like SVG: "8 4"). */
export function splitPolylineByDash(points: Pt[], dasharray: string): Pt[][] {
  const raw = dasharray
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0);
  if (points.length < 2 || raw.length === 0) return [points];
  const pattern = raw.map((n) => Math.max(0.5, n));
  if (pattern.length % 2 === 1) pattern.push(pattern[pattern.length - 1]);

  const dashes: Pt[][] = [];
  let patternIdx = 0;
  let remaining = pattern[0];
  let drawing = true;
  let current: Pt[] = drawing ? [{ ...points[0] }] : [];

  const flush = () => {
    if (current.length >= 2) dashes.push(current);
    current = [];
  };

  for (let i = 1; i < points.length; i += 1) {
    let ax = points[i - 1].x;
    let ay = points[i - 1].y;
    const bx = points[i].x;
    const by = points[i].y;
    let left = Math.hypot(bx - ax, by - ay);
    if (left <= 1e-6) continue;
    while (left > 1e-6) {
      const take = Math.min(left, remaining);
      const full = Math.hypot(bx - ax, by - ay) || 1;
      const mx = ax + ((bx - ax) / full) * take;
      const my = ay + ((by - ay) / full) * take;
      if (drawing) {
        if (!current.length) current.push({ x: ax, y: ay });
        current.push({ x: mx, y: my });
      }
      ax = mx;
      ay = my;
      left -= take;
      remaining -= take;
      if (remaining <= 1e-6) {
        if (drawing) flush();
        patternIdx = (patternIdx + 1) % pattern.length;
        remaining = pattern[patternIdx];
        drawing = !drawing;
        if (drawing) current = [{ x: ax, y: ay }];
      }
    }
  }
  if (drawing) flush();
  return dashes.length ? dashes : [points];
}

/**
 * Build freehand outline path(s); dashed styles return multiple closed outlines joined.
 * Silhouette is a path-centered ribbon (selection baseline stays inside the ink).
 */
export function pencilInkPathFromPoints(
  points: Pt[],
  strokeWidth: number,
  brushId?: string | null,
  strokeOpts?: PencilStrokeDrawOpts & { dasharray?: string }
): string {
  if (points.length < 2) return '';
  const dash = strokeOpts?.dasharray?.trim();
  if (!dash) {
    return outlinePathFromPoints(points, strokeWidth, brushId, strokeOpts);
  }
  const segs = splitPolylineByDash(points, dash);
  return segs
    .map((seg) => outlinePathFromPoints(seg, strokeWidth, brushId, strokeOpts))
    .filter(Boolean)
    .join(' ');
}

/** Polyline → SVG path `d` (baseline centerline). */
export function polylinePathD(points: Pt[]): string {
  if (points.length < 1) return '';
  return points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');
}

/** Half-extent so the node bbox covers painted ink around the baseline. */
export function brushPad(brush: PencilBrushDef, strokeWidth: number) {
  const size = brushSize(brush, strokeWidth);
  if (brush.kind === 'stamp') return Math.max(size * 0.65, strokeWidth / 2);
  // Freehand outline can flare beyond size/2 (thinning / taper).
  return Math.max(size * 0.7, strokeWidth / 2);
}

/** Parse simple M/L path into points (pencil centerline). */
export function parseSimplePathPoints(d: string): Pt[] {
  const pts: Pt[] = [];
  const re = /[ML]\s*([-\d.]+)\s+([-\d.]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    pts.push({ x: Number(m[1]), y: Number(m[2]) });
  }
  return pts;
}

/** Serialize / parse per-point pressure stored on pencil nodes. */
export function serializePathPressures(points: Pt[]): string | undefined {
  if (!points.some(pointHasPressure)) return undefined;
  return points
    .map((p) =>
      pointHasPressure(p)
        ? Math.min(1, Math.max(0, p.pressure as number)).toFixed(3)
        : '0'
    )
    .join(',');
}

export function parsePathPressures(raw: unknown, pointCount: number): number[] | undefined {
  if (raw == null || raw === '' || pointCount < 1) return undefined;
  const parts = String(raw)
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== pointCount) return undefined;
  return parts.map((p) => (Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0));
}

/** Sample S-curve for brush list previews (viewBox 0 0 120 28). */
function buildBrushPreviewPoints(): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= 24; i += 1) {
    const t = i / 24;
    const x = 6 + t * 108;
    const y = 14 + Math.sin(t * Math.PI * 2) * 7;
    // Fake a pressure ramp so preview shows thinning / taper differences.
    const pressure = 0.25 + 0.7 * Math.sin(t * Math.PI);
    pts.push({ x, y, pressure });
  }
  return pts;
}

export const BRUSH_PREVIEW_POINTS: Pt[] = buildBrushPreviewPoints();

export function brushPreviewPath(
  brush: PencilBrushDef,
  previewWidth = 10,
  hardness = 80
): string {
  return outlinePathFromPoints(BRUSH_PREVIEW_POINTS, previewWidth, brush.id, {
    pressureEnabled: true,
    hardness,
  });
}

/** Evenly space points along a polyline (always includes the endpoint). */
export function samplePolyline(points: Pt[], spacing: number): Pt[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [points[0]];
  if (spacing <= 0) return [points[0], points[points.length - 1]];

  const pressureAt = (a: Pt, b: Pt, t: number) => {
    const ha = pointHasPressure(a);
    const hb = pointHasPressure(b);
    if (!ha && !hb) return undefined;
    const pa = ha ? Math.min(1, Math.max(0, a.pressure as number)) : 0;
    const pb = hb ? Math.min(1, Math.max(0, b.pressure as number)) : pa;
    if (!ha) return pb;
    if (!hb) return pa;
    return pa + (pb - pa) * t;
  };

  const out: Pt[] = [
    {
      x: points[0].x,
      y: points[0].y,
      ...(pointHasPressure(points[0]) ? { pressure: points[0].pressure } : {}),
    },
  ];
  let acc = 0;
  let next = spacing;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg < 1e-6) continue;
    while (acc + seg >= next) {
      const t = (next - acc) / seg;
      const pr = pressureAt(a, b, t);
      out.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        ...(pr != null ? { pressure: pr } : {}),
      });
      next += spacing;
    }
    acc += seg;
  }
  const last = points[points.length - 1];
  const prev = out[out.length - 1];
  const lastPt: Pt = {
    x: last.x,
    y: last.y,
    ...(typeof last.pressure === 'number' ? { pressure: last.pressure } : {}),
  };
  if (!prev || Math.hypot(last.x - prev.x, last.y - prev.y) > spacing * 0.2) {
    out.push(lastPt);
  } else {
    out[out.length - 1] = lastPt;
  }
  return out;
}

/**
 * Ramer–Douglas–Peucker on pencil centerlines (MIT-safe in-repo impl).
 * Keeps endpoints and per-point pressure on retained vertices.
 */
export function simplifyPencilCenterline(points: Pt[], epsilon: number): Pt[] {
  if (points.length <= 2) return points.map((p) => ({ ...p }));
  const eps = Number(epsilon);
  if (!(eps > 0)) return points.map((p) => ({ ...p }));

  function distToSeg(p: Pt, a: Pt, b: Pt): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  function rdp(pts: Pt[]): Pt[] {
    if (pts.length <= 2) return pts;
    let maxDist = 0;
    let maxIdx = 0;
    const first = pts[0];
    const last = pts[pts.length - 1];
    for (let i = 1; i < pts.length - 1; i += 1) {
      const d = distToSeg(pts[i], first, last);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist <= eps) return [first, last];
    const left = rdp(pts.slice(0, maxIdx + 1));
    const right = rdp(pts.slice(maxIdx));
    return left.slice(0, -1).concat(right);
  }

  return rdp(points.map((p) => ({ ...p })));
}

/** Scene-space epsilon for freehand bake / commit (~4.5% of tip size, min 0.25). */
export function pencilSimplifyEpsilon(strokeSize: number): number {
  const s = Number(strokeSize);
  if (!(s > 0)) return 0.35;
  return Math.max(0.25, s * 0.045);
}

/**
 * EMA streamline for live pencil capture (brush.options.streamline).
 * `amount` 0 = raw, ~0.35–0.7 = smoother. Last point stays on the tip.
 */
export function streamlinePencilPoints(points: Pt[], amount: number): Pt[] {
  if (points.length < 2) return points.slice();
  const a = Math.min(0.92, Math.max(0, Number(amount) || 0));
  if (!(a > 0)) return points.map((p) => ({ ...p }));
  const out: Pt[] = [{ ...points[0] }];
  let px = points[0].x;
  let py = points[0].y;
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i];
    px = px + (p.x - px) * (1 - a);
    py = py + (p.y - py) * (1 - a);
    out.push({
      x: px,
      y: py,
      ...(p.pressure != null ? { pressure: p.pressure } : {}),
    });
  }
  const last = points[points.length - 1];
  out[out.length - 1] = {
    x: last.x,
    y: last.y,
    ...(last.pressure != null ? { pressure: last.pressure } : {}),
  };
  return out;
}

/** Min scene step between stored samples — scales with ink size, stays dense at high zoom. */
export function pencilSampleMinStep(strokeWidth: number, brush?: PencilBrushDef | null): number {
  const size = brush ? brushSize(brush, strokeWidth) : Math.max(1, strokeWidth);
  return Math.max(0.12, Math.min(0.4, size * 0.1));
}

export function stampSizeForBrush(brush: PencilBrushDef, strokeWidth: number) {
  return brushSize(brush, strokeWidth);
}

export function stampSpacingForBrush(
  brush: PencilBrushDef,
  strokeWidth: number,
  hardness: number = 80,
  points?: Pt[],
  maxDabs: number = STAMP_MAX_DABS
) {
  if (points?.length) {
    return stampSpacingForPath(brush, strokeWidth, hardness, points, maxDabs);
  }
  return stampSpacing(brush, strokeWidth, hardness);
}

/** Build a custom stamp brush def from an uploaded tip image. */
export function makeCustomStampBrush(opts: {
  id?: string;
  label: string;
  stampSrc: string;
  sizeFactor?: number;
  spacingFactor?: number;
}): PencilBrushDef {
  const id =
    opts.id ||
    `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    label: opts.label || '自定义画笔',
    sizeFactor: opts.sizeFactor ?? 1.4,
    spacingFactor: opts.spacingFactor ?? 0.15,
    kind: 'stamp',
    stampSrc: opts.stampSrc,
    custom: true,
    options: { ...FREEHAND_DEFAULTS },
  };
}

function packBrushFromJson(raw: BrushPackV1['brushes'][number]): PencilBrushDef | null {
  const id = String(raw?.id || '').trim();
  if (!id) return null;
  const label = String(raw.label || id).slice(0, 48);
  const stampSrc = typeof raw.stampSrc === 'string' ? raw.stampSrc.trim() : '';
  const kind = raw.kind === 'stamp' || stampSrc ? 'stamp' : 'freehand';
  if (kind === 'stamp') {
    if (!stampSrc.startsWith('data:image/') && !/^https?:\/\//i.test(stampSrc)) return null;
    return makeCustomStampBrush({
      id,
      label,
      stampSrc,
      sizeFactor: Number(raw.sizeFactor) || 1.4,
      spacingFactor: Number(raw.spacingFactor) || 0.15,
    });
  }
  const o = raw.options || {};
  return {
    id,
    label,
    custom: true,
    kind: 'freehand',
    sizeFactor: Number(raw.sizeFactor) || 1,
    simulatePressure: Boolean(raw.simulatePressure),
    options: {
      thinning: Number(o.thinning ?? 0.05),
      smoothing: Number(o.smoothing ?? 0.45),
      streamline: Number(o.streamline ?? 0.35),
      easing: (t) => t,
      start: {
        taper: Number(o.start?.taper ?? 0),
        cap: o.start?.cap !== false,
      },
      end: {
        taper: Number(o.end?.taper ?? 0),
        cap: o.end?.cap !== false,
      },
    },
  };
}

/** Parse open brush-pack JSON (recombyn-brushpack v1). */
export function parseBrushPackJson(text: string): { name: string; brushes: PencilBrushDef[] } {
  const parsed = JSON.parse(String(text || ''));
  if (!parsed || typeof parsed !== 'object') throw new Error('invalid-pack');
  const format = String((parsed as BrushPackV1).format || '');
  if (format !== BRUSH_PACK_FORMAT) throw new Error('bad-format');
  const version = Number((parsed as BrushPackV1).version);
  if (version !== BRUSH_PACK_VERSION) throw new Error('bad-version');
  const list = Array.isArray((parsed as BrushPackV1).brushes) ? (parsed as BrushPackV1).brushes : [];
  const brushes = list.map(packBrushFromJson).filter(Boolean) as PencilBrushDef[];
  if (!brushes.length) throw new Error('empty-pack');
  return {
    name: String((parsed as BrushPackV1).name || 'Brush pack').slice(0, 64),
    brushes,
  };
}

/** Serialize brushes to portable pack JSON (easing is dropped — restored as identity). */
export function serializeBrushPack(brushes: PencilBrushDef[], name = 'Custom brushes'): string {
  const pack: BrushPackV1 = {
    format: BRUSH_PACK_FORMAT,
    version: BRUSH_PACK_VERSION,
    name,
    brushes: brushes.map((b) => ({
      id: b.id,
      label: b.label,
      kind: b.kind === 'stamp' ? 'stamp' : 'freehand',
      sizeFactor: b.sizeFactor,
      spacingFactor: b.spacingFactor,
      simulatePressure: b.simulatePressure,
      stampSrc: b.stampSrc,
      options: {
        thinning: b.options.thinning,
        smoothing: b.options.smoothing,
        streamline: b.options.streamline,
        start: {
          taper: typeof b.options.start === 'object' ? Number((b.options.start as any).taper) || 0 : 0,
          cap: typeof b.options.start === 'object' ? (b.options.start as any).cap !== false : true,
        },
        end: {
          taper: typeof b.options.end === 'object' ? Number((b.options.end as any).taper) || 0 : 0,
          cap: typeof b.options.end === 'object' ? (b.options.end as any).cap !== false : true,
        },
      },
    })),
  };
  return `${JSON.stringify(pack, null, 2)}\n`;
}

export function isBrushPackFileName(name: string): boolean {
  const n = String(name || '').toLowerCase();
  return n.endsWith('.brushpack') || n.endsWith('.brush.json') || n.endsWith('.json');
}
