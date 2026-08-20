/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/scene/document/sceneFill.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { normalizeColor } from './sceneEffects';
import { boolEffectAttr, hexWithOpacity, resolveFillColor } from './sceneEffects';
import {
  bakeDiffuseMeshDataUrl,
  createMeshGrid,
  normalizeMeshPoints,
  type MeshPoint,
  type MeshSize,
} from './sceneDiffuseMesh';
import type { SceneDocument, SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';

/**
 * Solid / linear / radial / angular (conic) / diffuse mesh / image.
 * UI exposes all modes in the fill panel type strip.
 */
export type FillType = 'solid' | 'linear' | 'radial' | 'angular' | 'image' | 'diffuse';

export type FillStop = {
  offset: number;
  color: string;
  opacity?: number;
};

export type FillGradient = {
  type: 'linear' | 'radial' | 'angular' | 'diffuse';
  /** Linear / angular start direction in degrees. */
  angle?: number;
  /**
   * Linear gradient endpoints as percent of the node box (0–100).
   * When set, the vector can be shorter than the full box.
   * When omitted, endpoints are derived from `angle` spanning the box.
   */
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  /** Radial / angular center as percent 0–100. */
  cx?: number;
  cy?: number;
  /** Outer radius as percent of half-diagonal (0–100+). */
  r?: number;
  colorStops: FillStop[];
  /** Diffuse mesh: grid density 3–8. */
  meshSize?: MeshSize;
  /** Diffuse mesh: N×N control points (percent coords + color). */
  meshPoints?: MeshPoint[];
};

export type FillImageFit = 'fill' | 'fit' | 'crop' | 'tile';
export type FillImageRotate = 0 | 90 | 180 | 270;

export type FillImageAdjust = {
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  hue: number;
  highlights: number;
  shadows: number;
};

export const DEFAULT_FILL_IMAGE_ADJUST: FillImageAdjust = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  hue: 0,
  highlights: 0,
  shadows: 0,
};

export type SvgPaint =
  | { kind: 'none' }
  | { kind: 'solid'; color: string }
  | { kind: 'linear'; gradient: FillGradient; opacityPct: number }
  | { kind: 'radial'; gradient: FillGradient; opacityPct: number }
  | {
      kind: 'pattern';
      dataUrl: string;
      width: number;
      height: number;
      opacityPct?: number;
      imageFit?: FillImageFit;
      imageRotate?: FillImageRotate;
      imageFilter?: string;
    };

export const FILL_PANEL_TYPES: FillType[] = [
  'solid',
  'linear',
  'radial',
  'angular',
  'diffuse',
  'image',
];

export const FILL_TYPES: FillType[] = [
  'solid',
  'linear',
  'radial',
  'angular',
  'image',
  'diffuse',
];

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

function clampPct(n: number, fallback: number) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : fallback;
}

/** Linear endpoints may sit slightly outside the box. */
function clampLinearPct(n: unknown, fallback: number) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(150, Math.max(-50, v)) : fallback;
}

function hasLinearEndpoints(gradient: Pick<FillGradient, 'x1' | 'y1' | 'x2' | 'y2'>) {
  return (
    Number.isFinite(Number(gradient.x1)) &&
    Number.isFinite(Number(gradient.y1)) &&
    Number.isFinite(Number(gradient.x2)) &&
    Number.isFinite(Number(gradient.y2))
  );
}

function normalizeStops(raw: unknown, fallbackColor: string): FillStop[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [
      { offset: 0, color: normalizeColor(fallbackColor), opacity: 100 },
      { offset: 1, color: normalizeColor(fallbackColor), opacity: 0 },
    ];
  }
  return raw
    .map((s) => {
      const rec = s && typeof s === 'object' ? (s as Record<string, unknown>) : {};
      return {
        offset: clamp01(Number(rec.offset) || 0),
        color: normalizeColor(String(rec.color || fallbackColor)),
        opacity: clampPct(Number(rec.opacity ?? 100), 100),
      };
    })
    .sort((a, b) => a.offset - b.offset);
}

function normalizeMeshSize(raw: unknown): MeshSize {
  const n = Math.round(Number(raw) || 3);
  if (n <= 3) return 3;
  if (n >= 8) return 8;
  return n as MeshSize;
}

function hexLuminance(hex: string): number {
  const raw = normalizeColor(hex).replace('#', '');
  if (raw.length !== 6) return 0.5;
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Pick start/end so a newly switched gradient never looks like a solid. */
function defaultGradientStops(baseColor: string): [FillStop, FillStop] {
  const color = normalizeColor(baseColor);
  const lum = hexLuminance(color);
  // Near-white solid → white → mid gray (visible ramp).
  if (lum > 0.88) {
    return [
      { offset: 0, color: '#FFFFFF', opacity: 100 },
      { offset: 1, color: '#737373', opacity: 100 },
    ];
  }
  // Near-black solid → light gray → base.
  if (lum < 0.12) {
    return [
      { offset: 0, color: '#E5E5E5', opacity: 100 },
      { offset: 1, color, opacity: 100 },
    ];
  }
  return [
    { offset: 0, color: '#FFFFFF', opacity: 100 },
    { offset: 1, color, opacity: 100 },
  ];
}

export function defaultGradient(
  type: Exclude<FillType, 'solid' | 'image'>,
  baseColor = '#FFFFFF'
): FillGradient {
  const color = normalizeColor(baseColor);
  const colorStops = defaultGradientStops(color);
  if (type === 'linear') {
    return {
      type: 'linear',
      angle: 90,
      colorStops,
    };
  }
  if (type === 'radial') {
    return {
      type: 'radial',
      cx: 50,
      cy: 50,
      r: 50,
      colorStops,
    };
  }
  if (type === 'angular') {
    return {
      type: 'angular',
      angle: 0,
      cx: 50,
      cy: 50,
      colorStops,
    };
  }
  const meshSize: MeshSize = 4;
  const meshPoints = createMeshGrid(meshSize, color);
  return {
    type: 'diffuse',
    meshSize,
    meshPoints,
    colorStops: [
      { offset: 0, color: meshPoints[0]?.color || color, opacity: 100 },
      { offset: 1, color: meshPoints[meshPoints.length - 1]?.color || color, opacity: 100 },
    ],
  };
}

function clampAdjust(n: number) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(100, Math.max(-100, Math.round(v))) : 0;
}

export function parseFillImageFit(raw: unknown): FillImageFit {
  const v = String(raw || 'fill');
  if (v === 'fit' || v === 'crop' || v === 'tile') return v;
  return 'fill';
}

export function parseFillImageRotate(raw: unknown): FillImageRotate {
  const n = Number(raw);
  if (n === 90 || n === 180 || n === 270) return n;
  return 0;
}

export function parseFillImageAdjust(raw: unknown): FillImageAdjust {
  let parsed: unknown = raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_FILL_IMAGE_ADJUST };
  const rec = parsed as Record<string, unknown>;
  return {
    exposure: clampAdjust(Number(rec.exposure)),
    contrast: clampAdjust(Number(rec.contrast)),
    saturation: clampAdjust(Number(rec.saturation)),
    temperature: clampAdjust(Number(rec.temperature)),
    tint: clampAdjust(Number(rec.tint)),
    hue: clampAdjust(Number(rec.hue)),
    highlights: clampAdjust(Number(rec.highlights)),
    shadows: clampAdjust(Number(rec.shadows)),
  };
}

export function serializeFillImageAdjust(adjust: FillImageAdjust): string {
  const a = parseFillImageAdjust(adjust);
  return JSON.stringify(a);
}

/** Approximate image adjustments as a CSS filter string (preview + SVG pattern image). */
export function buildImageAdjustFilterCss(adjust: FillImageAdjust): string {
  const a = parseFillImageAdjust(adjust);
  const parts: string[] = [];
  if (a.exposure !== 0) parts.push(`brightness(${1 + a.exposure / 100})`);
  if (a.contrast !== 0) parts.push(`contrast(${1 + a.contrast / 100})`);
  if (a.saturation !== 0) parts.push(`saturate(${Math.max(0, 1 + a.saturation / 100)})`);
  if (a.hue !== 0) parts.push(`hue-rotate(${a.hue * 1.8}deg)`);
  if (a.temperature > 0) parts.push(`sepia(${a.temperature / 200})`);
  else if (a.temperature < 0) parts.push(`hue-rotate(${a.temperature * 0.6}deg)`);
  if (a.tint !== 0) parts.push(`hue-rotate(${a.tint * 0.9}deg)`);
  if (a.highlights !== 0) parts.push(`brightness(${1 + a.highlights / 300})`);
  if (a.shadows > 0) parts.push(`brightness(${1 + a.shadows / 250})`);
  else if (a.shadows < 0) parts.push(`contrast(${1 - a.shadows / 300})`);
  return parts.length ? parts.join(' ') : 'none';
}

/**
 * Image-node「调整」panel values → CSS filter.
 * Maps light / whites / blacks into exposure/contrast so sliders have visible effect.
 */
export function buildNodeAdjustFilterCss(raw: Record<string, unknown> | null | undefined): string {
  const n = (k: string) => {
    const v = Number(raw?.[k]);
    return Number.isFinite(v) ? Math.max(-100, Math.min(100, v)) : 0;
  };
  const light = n('light');
  const whites = n('whites');
  const blacks = n('blacks');
  return buildImageAdjustFilterCss({
    exposure: n('exposure') + light * 0.55 + whites * 0.3 - blacks * 0.25,
    contrast: n('contrast') + blacks * 0.2,
    saturation: n('saturation'),
    temperature: n('temperature'),
    tint: n('tint'),
    hue: n('hue'),
    highlights: n('highlights'),
    shadows: n('shadows'),
  });
}

export function fillImageFieldsFromAttrs(attrs: Record<string, any> = {}) {
  return {
    fillImageSrc: attrs['fill-image-src'] != null ? String(attrs['fill-image-src']) : undefined,
    fillImageFit: parseFillImageFit(attrs['fill-image-fit']),
    fillImageRotate: parseFillImageRotate(attrs['fill-image-rotate']),
    fillImageAdjust: parseFillImageAdjust(attrs['fill-image-adjust']),
  };
}

export function parseFillType(raw: unknown): FillType {
  const v = String(raw || 'solid');
  if (
    v === 'linear' ||
    v === 'radial' ||
    v === 'angular' ||
    v === 'image' ||
    v === 'diffuse'
  ) {
    return v;
  }
  return 'solid';
}

export function parseFillGradient(
  raw: unknown,
  typeHint?: Exclude<FillType, 'solid' | 'image'>,
  fallbackColor = '#FFFFFF'
): FillGradient {
  let parsed: unknown = raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  const rec = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  const type: Exclude<FillType, 'solid' | 'image'> =
    rec?.type === 'linear' ||
    rec?.type === 'radial' ||
    rec?.type === 'angular' ||
    rec?.type === 'diffuse'
      ? rec.type
      : typeHint || 'linear';
  const base = defaultGradient(type, fallbackColor);
  if (!rec) return base;

  const meshSize = type === 'diffuse' ? normalizeMeshSize(rec.meshSize ?? base.meshSize) : undefined;
  const meshPoints =
    type === 'diffuse'
      ? normalizeMeshPoints(rec.meshPoints ?? base.meshPoints, meshSize || 3, fallbackColor)
      : undefined;

  return {
    type,
    angle: Number.isFinite(Number(rec.angle)) ? Number(rec.angle) : base.angle,
    cx: clampPct(Number(rec.cx ?? base.cx), base.cx ?? 50),
    cy: clampPct(Number(rec.cy ?? base.cy), base.cy ?? 50),
    r: Math.max(1, Number(rec.r ?? base.r ?? 50) || 50),
    colorStops: normalizeStops(rec.colorStops, fallbackColor),
    ...(type === 'linear' && hasLinearEndpoints(rec)
      ? {
          x1: clampLinearPct(rec.x1, 0),
          y1: clampLinearPct(rec.y1, 0),
          x2: clampLinearPct(rec.x2, 100),
          y2: clampLinearPct(rec.y2, 100),
        }
      : {}),
    ...(type === 'diffuse' ? { meshSize, meshPoints } : {}),
  };
}

export function serializeFillGradient(gradient: FillGradient): string {
  return JSON.stringify({
    type: gradient.type,
    ...(gradient.type === 'linear' || gradient.type === 'angular'
      ? { angle: Number(gradient.angle ?? 0) }
      : {}),
    ...(gradient.type === 'linear' && hasLinearEndpoints(gradient)
      ? {
          x1: clampLinearPct(gradient.x1, 0),
          y1: clampLinearPct(gradient.y1, 0),
          x2: clampLinearPct(gradient.x2, 100),
          y2: clampLinearPct(gradient.y2, 100),
        }
      : {}),
    ...(gradient.type === 'radial' || gradient.type === 'angular'
      ? {
          cx: clampPct(gradient.cx ?? 50, 50),
          cy: clampPct(gradient.cy ?? 50, 50),
        }
      : {}),
    ...(gradient.type === 'radial'
      ? { r: Math.max(1, Number(gradient.r ?? 50) || 50) }
      : {}),
    ...(gradient.type === 'diffuse'
      ? {
          meshSize: normalizeMeshSize(gradient.meshSize ?? 4),
          meshPoints: normalizeMeshPoints(
            gradient.meshPoints,
            normalizeMeshSize(gradient.meshSize ?? 4),
            gradient.meshPoints?.[0]?.color || '#CCCCCC'
          ),
        }
      : {}),
    colorStops: normalizeStops(gradient.colorStops, '#CCCCCC'),
  });
}

/** Bake angular (conic) gradient to a PNG data URL for SVG pattern fill. */
export function bakeAngularGradientDataUrl(
  gradient: FillGradient,
  width: number,
  height: number,
  opacityPct = 100
): { dataUrl: string; width: number; height: number } {
  const w = Math.max(2, Math.round(width) || 2);
  const h = Math.max(2, Math.round(height) || 2);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof ctx.createConicGradient !== 'function') {
    return { dataUrl: '', width: w, height: h };
  }
  const cx = (clampPct(gradient.cx ?? 50, 50) / 100) * w;
  const cy = (clampPct(gradient.cy ?? 50, 50) / 100) * h;
  const start = (((Number(gradient.angle) || 0) - 90) * Math.PI) / 180;
  const g = (ctx as CanvasRenderingContext2D).createConicGradient(start, cx, cy);
  const stops = stopsWithOpacity(gradient.colorStops, opacityPct);
  stops.forEach((s) => g.addColorStop(clamp01(s.offset), s.color));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
}

export function linearCoordsFromAngle(angleDeg: number) {
  const rad = ((Number(angleDeg) || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x1: 0.5 - cos * 0.5,
    y1: 0.5 - sin * 0.5,
    x2: 0.5 + cos * 0.5,
    y2: 0.5 + sin * 0.5,
  };
}

/** Resolve linear endpoints in unit box coords (0–1). Prefers explicit x1..y2. */
export function resolveLinearCoords(gradient: FillGradient): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  if (hasLinearEndpoints(gradient)) {
    return {
      x1: clampLinearPct(gradient.x1, 0) / 100,
      y1: clampLinearPct(gradient.y1, 0) / 100,
      x2: clampLinearPct(gradient.x2, 100) / 100,
      y2: clampLinearPct(gradient.y2, 100) / 100,
    };
  }
  return linearCoordsFromAngle(gradient.angle ?? 90);
}

/** Angle (deg) of a linear vector in pixel space for a given box size. */
export function linearAngleFromEndpoints(
  x1Pct: number,
  y1Pct: number,
  x2Pct: number,
  y2Pct: number,
  width: number,
  height: number
) {
  const dx = ((x2Pct - x1Pct) / 100) * Math.max(1, width);
  const dy = ((y2Pct - y1Pct) / 100) * Math.max(1, height);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function stopsWithOpacity(stops: FillStop[], globalOpacityPct: number) {
  const global = clampPct(globalOpacityPct, 100) / 100;
  return normalizeStops(stops, '#000000').map((s) => {
    const local = clampPct(s.opacity ?? 100, 100) / 100;
    const alpha = Math.round(global * local * 100);
    return {
      offset: s.offset,
      color: hexWithOpacity(s.color, alpha),
    };
  });
}

/** Resolve node paint for SVG rendering. */
export function resolveFill(node: SceneNodeInput, fallback = '#FFFFFF'): SvgPaint {
  const attrs = node?.attrs || {};
  if (!boolEffectAttr(attrs['fill-enabled'], true)) return { kind: 'none' };
  if (!boolEffectAttr(attrs['fill-visible'], true)) return { kind: 'none' };

  const fillType = parseFillType(attrs['fill-type']);
  if (fillType === 'solid') {
    const color = resolveFillColor(node, fallback);
    if (color === 'rgba(0,0,0,0)' || color === 'transparent') return { kind: 'none' };
    return { kind: 'solid', color };
  }

  const solid = attrs['fill-color'];
  if (solid === 'transparent' && fillType !== 'image') return { kind: 'none' };
  const opacityPct = Number(attrs['fill-opacity'] ?? 100);
  const w = Number(node?.width) || 120;
  const h = Number(node?.height) || 120;

  if (fillType === 'image') {
    const src = String(attrs['fill-image-src'] || '');
    if (!src) return { kind: 'none' };
    const adjust = parseFillImageAdjust(attrs['fill-image-adjust']);
    const filter = buildImageAdjustFilterCss(adjust);
    return {
      kind: 'pattern',
      dataUrl: src,
      width: w,
      height: h,
      opacityPct,
      imageFit: parseFillImageFit(attrs['fill-image-fit']),
      imageRotate: parseFillImageRotate(attrs['fill-image-rotate']),
      imageFilter: filter !== 'none' ? filter : undefined,
    };
  }

  const gradient = parseFillGradient(
    attrs['fill-gradient'],
    fillType === 'angular' || fillType === 'linear' || fillType === 'radial' || fillType === 'diffuse'
      ? fillType
      : 'linear',
    String(solid || fallback)
  );
  gradient.type = fillType;

  if (fillType === 'diffuse') {
    const meshSize = normalizeMeshSize(gradient.meshSize ?? 4);
    const points = normalizeMeshPoints(
      gradient.meshPoints,
      meshSize,
      String(solid || fallback)
    );
    const baked = bakeDiffuseMeshDataUrl(points, w, h, opacityPct);
    return { kind: 'pattern', ...baked };
  }

  if (fillType === 'angular') {
    const baked = bakeAngularGradientDataUrl(gradient, w, h, opacityPct);
    if (!baked.dataUrl) {
      return { kind: 'radial', gradient: { ...gradient, type: 'radial' }, opacityPct };
    }
    return { kind: 'pattern', ...baked };
  }

  return {
    kind: fillType === 'radial' ? 'radial' : 'linear',
    gradient,
    opacityPct,
  };
}

export function isTransparentFill(fill: SvgPaint | null | undefined) {
  if (fill == null || fill.kind === 'none') return true;
  if (fill.kind === 'solid') {
    return fill.color === 'rgba(0,0,0,0)' || fill.color === 'transparent' || fill.color === '';
  }
  return false;
}

/** Preserve fill attrs when syncing engine → scene (panel remains source of truth). */
export function fillAttrsFromElement(_el: Element | null | undefined, prevAttrs: Record<string, unknown> = {}) {
  const fillType = parseFillType(prevAttrs['fill-type']);
  const base = {
    'fill-enabled': prevAttrs['fill-enabled'] ?? 'true',
    'fill-visible': prevAttrs['fill-visible'] ?? 'true',
    'fill-opacity': prevAttrs['fill-opacity'] ?? 100,
    'fill-type': fillType,
  };

  if (fillType === 'image') {
    return {
      ...base,
      'fill-color': prevAttrs['fill-color'] || '#FFFFFF',
      ...(prevAttrs['fill-image-src'] != null
        ? { 'fill-image-src': prevAttrs['fill-image-src'] }
        : {}),
      ...(prevAttrs['fill-image-fit'] != null
        ? { 'fill-image-fit': prevAttrs['fill-image-fit'] }
        : {}),
      ...(prevAttrs['fill-image-rotate'] != null
        ? { 'fill-image-rotate': prevAttrs['fill-image-rotate'] }
        : {}),
      ...(prevAttrs['fill-image-adjust'] != null
        ? { 'fill-image-adjust': prevAttrs['fill-image-adjust'] }
        : {}),
    };
  }

  if (fillType !== 'solid') {
    return {
      ...base,
      'fill-color': prevAttrs['fill-color'] || '#FFFFFF',
      ...(prevAttrs['fill-gradient'] != null
        ? { 'fill-gradient': prevAttrs['fill-gradient'] }
        : {
            'fill-gradient': serializeFillGradient(
              defaultGradient(fillType as Exclude<FillType, 'solid' | 'image'>)
            ),
          }),
    };
  }

  return {
    ...base,
    'fill-color':
      prevAttrs['fill-color'] != null && prevAttrs['fill-color'] !== ''
        ? prevAttrs['fill-color']
        : 'transparent',
    ...(prevAttrs['fill-gradient'] != null ? { 'fill-gradient': prevAttrs['fill-gradient'] } : {}),
  };
}

/** Document artboard background paint. */
export function resolveDocumentBackground(document: SceneDocument): SvgPaint {
  const type = parseFillType(document?.backgroundFillType);
  if (type === 'solid') {
    const raw = String(document?.backgroundColor || '#ffffff').trim();
    if (!raw || raw === 'transparent' || raw === 'none') {
      return { kind: 'none' };
    }
    const opacityPct = Number(document?.backgroundOpacity ?? 100);
    if (opacityPct <= 0) return { kind: 'none' };
    return { kind: 'solid', color: hexWithOpacity(normalizeColor(raw), opacityPct) };
  }
  if (type === 'image') {
    const src = String(document?.backgroundImageSrc || '');
    if (!src) return { kind: 'solid', color: normalizeColor(document?.backgroundColor || '#ffffff') };
    return {
      kind: 'pattern',
      dataUrl: src,
      width: Number(document?.width) || 794,
      height: Number(document?.height) || 1123,
    };
  }
  const gradient = parseFillGradient(
    document?.backgroundGradient,
    type,
    String(document?.backgroundColor || '#CCCCCC')
  );
  gradient.type = type;
  const opacityPct = Number(document?.backgroundOpacity ?? 100);
  if (type === 'diffuse') {
    const meshSize = normalizeMeshSize(gradient.meshSize ?? 4);
    const points = normalizeMeshPoints(
      gradient.meshPoints,
      meshSize,
      String(document?.backgroundColor || '#CCCCCC')
    );
    const baked = bakeDiffuseMeshDataUrl(
      points,
      Number(document?.width) || 794,
      Number(document?.height) || 1123,
      opacityPct
    );
    return { kind: 'pattern', ...baked };
  }
  if (type === 'angular') {
    const baked = bakeAngularGradientDataUrl(
      gradient,
      Number(document?.width) || 794,
      Number(document?.height) || 1123,
      opacityPct
    );
    if (!baked.dataUrl) {
      return { kind: 'radial', gradient: { ...gradient, type: 'radial' }, opacityPct };
    }
    return { kind: 'pattern', ...baked };
  }
  return {
    kind: type === 'radial' ? 'radial' : 'linear',
    gradient,
    opacityPct,
  };
}

export function cssPreviewForGradient(gradient: FillGradient, globalOpacityPct = 100): string {
  if (gradient.type === 'diffuse' && gradient.meshPoints?.length) {
    const c0 = gradient.meshPoints[0]?.color || '#ccc';
    const c1 = gradient.meshPoints[Math.floor(gradient.meshPoints.length / 2)]?.color || c0;
    const c2 = gradient.meshPoints[gradient.meshPoints.length - 1]?.color || c1;
    void globalOpacityPct;
    return `radial-gradient(circle at 30% 30%, ${c0}, ${c1} 45%, ${c2})`;
  }
  const stops = stopsWithOpacity(gradient.colorStops, globalOpacityPct)
    .map((s) => `${s.color} ${Math.round(s.offset * 100)}%`)
    .join(', ');
  if (gradient.type === 'linear') {
    const c = resolveLinearCoords(gradient);
    const angle =
      Number.isFinite(Number(gradient.angle)) && !hasLinearEndpoints(gradient)
        ? Number(gradient.angle)
        : linearAngleFromEndpoints(c.x1 * 100, c.y1 * 100, c.x2 * 100, c.y2 * 100, 100, 100);
    if (hasLinearEndpoints(gradient)) {
      // Approximate SVG pad: solid outside the shortened segment.
      const full = linearCoordsFromAngle(angle);
      const t0 = projectUnit(c.x1, c.y1, full.x1, full.y1, full.x2, full.y2);
      const t1 = projectUnit(c.x2, c.y2, full.x1, full.y1, full.x2, full.y2);
      const a = Math.min(t0, t1);
      const b = Math.max(t0, t1);
      const mapped = stopsWithOpacity(gradient.colorStops, globalOpacityPct).map((s) => {
        const t = a + (b - a) * clamp01(s.offset);
        return `${s.color} ${Math.round(t * 100)}%`;
      });
      const head = mapped[0] ?? '#fff 0%';
      const tail = mapped[mapped.length - 1] ?? '#000 100%';
      const headColor = head.replace(/\s+[\d.]+%$/, '');
      const tailColor = tail.replace(/\s+[\d.]+%$/, '');
      return `linear-gradient(${angle}deg, ${headColor} 0%, ${mapped.join(', ')}, ${tailColor} 100%)`;
    }
    return `linear-gradient(${angle}deg, ${stops})`;
  }
  if (gradient.type === 'angular') {
    return `conic-gradient(from ${Number(gradient.angle ?? 0)}deg at ${clampPct(gradient.cx ?? 50, 50)}% ${clampPct(gradient.cy ?? 50, 50)}%, ${stops})`;
  }
  const x = clampPct(gradient.cx ?? 50, 50);
  const y = clampPct(gradient.cy ?? 50, 50);
  return `radial-gradient(circle at ${x}% ${y}%, ${stops})`;
}

function projectUnit(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return 0;
  return clamp01(((px - x1) * dx + (py - y1) * dy) / len2);
}

export { stopsWithOpacity, clampPct };
