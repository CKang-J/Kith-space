/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/scene/document/sceneEffects.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';
export function boolEffectAttr(v: unknown, fallback: boolean) {
  if (v == null) return fallback;
  return v === true || v === 'true';
}

export function normalizeColor(color: unknown) {
  if (!color || typeof color !== 'string') return '#333333';
  const trimmed = color.trim();
  const cssVarMatch = trimmed.match(/rgb\(var\((--[\w-]+)\)\)/i);
  const CSS_VAR_COLORS: Record<string, string> = {
    '--orange-6': '#FF7D00',
    '--red-6': '#F53F3F',
    '--blue-6': '#165DFF',
  };
  if (cssVarMatch && CSS_VAR_COLORS[cssVarMatch[1]]) return CSS_VAR_COLORS[cssVarMatch[1]];
  const rgbMatch = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  }
  return trimmed;
}

export function hexWithOpacity(hex: string, opacityPct: number) {
  const normalized = normalizeColor(hex);
  const pct = Math.min(100, Math.max(0, opacityPct));
  if (pct >= 100) return normalized;
  const raw = normalized.replace('#', '');
  if (raw.length !== 6) return normalized;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${pct / 100})`;
}

export function resolveFillColor(node: SceneNodeInput, fallback = '#FFFFFF') {
  const attrs = node?.attrs || {};
  if (!boolEffectAttr(attrs['fill-enabled'], true)) return 'rgba(0,0,0,0)';
  const fill = attrs['fill-color'] ?? fallback;
  if (fill === 'transparent') return 'rgba(0,0,0,0)';
  const opacity = Number(attrs['fill-opacity'] ?? 100);
  if (!boolEffectAttr(attrs['fill-visible'], true)) return 'rgba(0,0,0,0)';
  return hexWithOpacity(String(fill ?? fallback), opacity);
}

export function resolveStroke(node: SceneNodeInput, fallback = '#333333') {
  const attrs = node?.attrs || {};
  if (!boolEffectAttr(attrs['stroke-enabled'], true) || !boolEffectAttr(attrs['stroke-visible'], true)) {
    return { stroke: 'transparent', strokeWidth: 0 };
  }
  const stroke = normalizeColor(attrs['border-color'] || attrs.stroke || fallback);
  const opacity = Number(attrs['stroke-opacity'] ?? 100);
  const color = hexWithOpacity(stroke, opacity);
  // Document writes `border-width`; some live patches use camelCase.
  const rawW = attrs['border-width'] ?? attrs.borderWidth ?? attrs.strokeWidth;
  const parsed = rawW == null || rawW === '' ? 1 : parseFloat(String(rawW));
  const strokeWidth = Math.max(0, Number.isFinite(parsed) ? parsed : 0);
  return { stroke: color, strokeWidth };
}

export type StrokeAlign = 'center' | 'inside' | 'outside';
export type StrokeLinecap = 'butt' | 'round' | 'square';
export type StrokeLinejoin = 'miter' | 'round' | 'bevel';

export function resolveStrokeAlign(attrs: Record<string, unknown> | null | undefined): StrokeAlign {
  const v = String(attrs?.strokeAlign || attrs?.['stroke-align'] || 'center');
  if (v === 'inside' || v === 'outside' || v === 'center') return v;
  return 'center';
}

function strokePaintMeta(node: SceneNodeInput): { align: StrokeAlign; strokeWidth: number } | null {
  if (!node) return null;
  const key = String(node.key || '');
  const shapeType = String(node.attrs?.shapeType || '');
  // Line/arrow use a dedicated hit height; freehand / pen store padded AABB already.
  if (shapeType === 'line' || shapeType === 'arrow' || shapeType === 'pencil' || shapeType === 'pen')
    return null;
  if (key === 'text' || key === 'frame') return null;
  if (key === 'image' || key === 'video' || key === 'lottie' || key === 'audio') return null;

  // Same color fallback as sceneToSvg — a missing border-color still paints #333.
  const { stroke, strokeWidth } = resolveStroke(node, '#333333');
  if (!(strokeWidth > 0) || !stroke || stroke === 'transparent') return null;
  if (/rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*0\s*\)/i.test(stroke)) return null;

  let align = resolveStrokeAlign(node.attrs);
  // Match applyElementStroke: outside needs opaque fill to cover the inner half.
  // Use the same white default as createShape paint — not 'transparent'.
  if (align === 'outside') {
    const fillType = String(node.attrs?.['fill-type'] || 'solid');
    if (fillType === 'solid' || fillType === '') {
      const fill = resolveFillColor(node, '#FFFFFF');
      const opaque =
        Boolean(fill) &&
        fill !== 'transparent' &&
        fill !== 'rgba(0,0,0,0)' &&
        !/^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/i.test(fill);
      if (!opaque) align = 'center';
    }
    // gradient / image / mesh still cover the inner half
  }
  return { align, strokeWidth };
}

/**
 * How far painted stroke extends **outside** the geometric box (≥ 0).
 * Hit-testing / outer-ink bounds — inside stroke stays within geom.
 */
export function strokeVisualOutset(node: SceneNodeInput): number {
  const meta = strokePaintMeta(node);
  if (!meta) return 0;
  if (meta.align === 'inside') return 0;
  if (meta.align === 'outside') return meta.strokeWidth;
  return meta.strokeWidth / 2;
}

/**
 * How far selection chrome sits outside the geometric box (≥ 0).
 * Control box = **vector path** (geometry AABB). Stroke align is paint-only —
 * do not pad the blue box to outer ink. Move/snap still uses visual outer via
 * `strokeVisualOutset` / `inflateBoxByVisualOutset`.
 */
export function strokeChromeOutset(node: SceneNodeInput): number {
  void node;
  return 0;
}

/**
 * Offset from the vector path to the **middle of the painted stroke band**.
 * Scales with real `border-width` — not a constant.
 * - outside → +sw/2 (band sits entirely outside the path)
 * - center  → 0 (SVG stroke already straddles the path)
 * - inside  → −sw/2
 */
export function strokeIndicatorOutset(node: SceneNodeInput): number {
  const meta = strokePaintMeta(node);
  if (!meta) return 0;
  const sw = meta.strokeWidth;
  if (!(sw > 0)) return 0;
  if (meta.align === 'inside') return -sw / 2;
  if (meta.align === 'outside') return sw / 2;
  return 0;
}

/**
 * Align / snap / spacing boxes — **vector path only**.
 * Guides / snap use visual outer separately; selection chrome stays on path.
 */
export type StrokeBandFace = 'inner' | 'path' | 'outer';

export type StrokeBandBox<T extends { left: number; top: number; width: number; height: number }> =
  T & { face: StrokeBandFace | 'any' };

export function strokeBandGuideBoxes<
  T extends { left: number; top: number; width: number; height: number },
>(geom: T, node: SceneNodeInput): StrokeBandBox<T>[] {
  void node;
  return [{ ...geom, face: 'path' }];
}

function padBox<T extends { left: number; top: number; width: number; height: number }>(
  box: T,
  pad: number
): T {
  if (!pad) return box;
  return {
    ...box,
    left: box.left - pad,
    top: box.top - pad,
    width: Math.max(1, box.width + pad * 2),
    height: Math.max(1, box.height + pad * 2),
  };
}

/** Selection chrome AABB from geometry (path only — chrome outset is 0). */
export function inflateBoxByStrokeOutset<
  T extends { left: number; top: number; width: number; height: number },
>(box: T, node: SceneNodeInput): T {
  return padBox(box, strokeChromeOutset(node));
}

/** Inverse — selection chrome → stored geometry. */
export function deflateBoxByStrokeOutset<
  T extends { left: number; top: number; width: number; height: number },
>(box: T, node: SceneNodeInput): T {
  return padBox(box, -strokeChromeOutset(node));
}

/** Outer-ink AABB from geometry (≥ geometry). For hit-testing thick strokes. */
export function inflateBoxByVisualOutset<
  T extends { left: number; top: number; width: number; height: number },
>(box: T, node: SceneNodeInput): T {
  return padBox(box, strokeVisualOutset(node));
}

/** Half-pixel quantize — same as createShapeNode (odd center strokes). */
function quantizeHalfPx(n: number) {
  return Math.round(n * 2) / 2;
}

/**
 * Outset as if stroke were painted (ignore current stroke-visible/enabled).
 * Used when turning stroke back on to inset geom again.
 */
function strokeVisualOutsetAssumingPainted(node: SceneNodeInput): number {
  if (!node) return 0;
  return strokeVisualOutset({
    ...node,
    attrs: {
      ...(node.attrs || {}),
      'stroke-enabled': 'true',
      'stroke-visible': 'true',
    },
  });
}

/**
 * Closed shapes drawn with center stroke store path geom inset by sw/2 so outer
 * ink sits on the integer grid. Hiding stroke without expanding leaves the fill
 * on half-pixels. Expand/inset AABB to keep the visible edge stable.
 *
 * Skips open strokes / freehand / custom path `d` (AABB alone would not offset the curve).
 */
export function geometryPatchForStrokeVisibilityToggle(
  node: SceneNodeInput,
  nextVisible: boolean
): { x: number; y: number; width: number; height: number } | null {
  if (!node) return null;
  const shapeType = String(node.attrs?.shapeType || '');
  if (
    shapeType === 'line' ||
    shapeType === 'arrow' ||
    shapeType === 'pencil' ||
    shapeType === 'pen' ||
    shapeType === 'path'
  ) {
    return null;
  }
  if (
    node.key === 'text' ||
    node.key === 'frame' ||
    node.key === 'image' ||
    node.key === 'video' ||
    node.key === 'lottie' ||
    node.key === 'audio'
  ) {
    return null;
  }
  // Boolean / pasted outlines keep absolute local `path` — resizing the box alone
  // would not grow the fill to the old outer ink.
  if (typeof node.attrs?.path === 'string' && String(node.attrs.path).trim()) {
    return null;
  }

  const attrs = node.attrs || {};
  const currentlyVisible =
    boolEffectAttr(attrs['stroke-enabled'], true) && boolEffectAttr(attrs['stroke-visible'], true);
  if (currentlyVisible === nextVisible) return null;

  const outset = nextVisible
    ? strokeVisualOutsetAssumingPainted(node)
    : strokeVisualOutset(node);
  if (!(outset > 0)) return null;

  const x = Number(node.x) || 0;
  const y = Number(node.y) || 0;
  const width = Math.max(1, Number(node.width) || 1);
  const height = Math.max(1, Number(node.height) || 1);

  if (nextVisible) {
    // Show stroke → inset path so outer ink matches current fill edge.
    const nextW = Math.max(1, width - outset * 2);
    const nextH = Math.max(1, height - outset * 2);
    if (nextW >= width && nextH >= height) return null;
    return {
      x: quantizeHalfPx(x + outset),
      y: quantizeHalfPx(y + outset),
      width: quantizeHalfPx(nextW),
      height: quantizeHalfPx(nextH),
    };
  }

  // Hide stroke → expand fill to previous outer ink.
  return {
    x: quantizeHalfPx(x - outset),
    y: quantizeHalfPx(y - outset),
    width: quantizeHalfPx(width + outset * 2),
    height: quantizeHalfPx(height + outset * 2),
  };
}

/** Scene-space air between text glyphs and selection chrome (flush / ~0). */
export const TEXT_SELECTION_PAD = 0;

export function inflateBoxByTextSelectionPad<
  T extends { left: number; top: number; width: number; height: number },
>(box: T, node: SceneNodeInput): T {
  if (node?.key !== 'text') return box;
  const pad = TEXT_SELECTION_PAD;
  return {
    ...box,
    left: box.left - pad,
    top: box.top - pad,
    width: Math.max(1, box.width + pad * 2),
    height: Math.max(1, box.height + pad * 2),
  };
}

export function deflateBoxByTextSelectionPad<
  T extends { left: number; top: number; width: number; height: number },
>(box: T, node: SceneNodeInput): T {
  if (node?.key !== 'text') return box;
  const pad = TEXT_SELECTION_PAD;
  return {
    ...box,
    left: box.left + pad,
    top: box.top + pad,
    width: Math.max(1, box.width - pad * 2),
    height: Math.max(1, box.height - pad * 2),
  };
}

/**
 * Selection chrome AABB = path geom (+ text pad). Stroke does not expand the
 * control box — knobs sit on the path; outer-ink snap uses visual outset.
 */
export function inflateSelectionBox<
  T extends { left: number; top: number; width: number; height: number },
>(box: T, node: SceneNodeInput): T {
  return inflateBoxByStrokeOutset(inflateBoxByTextSelectionPad(box, node), node);
}

/** Inverse of inflateSelectionBox for geometry commits. */
export function deflateSelectionBox<
  T extends { left: number; top: number; width: number; height: number },
>(box: T, node: SceneNodeInput): T {
  return deflateBoxByTextSelectionPad(deflateBoxByStrokeOutset(box, node), node);
}

export function resolveStrokeLinecap(attrs: Record<string, unknown> | null | undefined): StrokeLinecap {
  const v = String(attrs?.strokeLinecap || attrs?.['stroke-linecap'] || 'butt');
  if (v === 'butt' || v === 'round' || v === 'square') return v;
  return 'butt';
}

export function resolveStrokeLinejoin(attrs: Record<string, unknown> | null | undefined): StrokeLinejoin {
  const v = String(attrs?.strokeLinejoin || attrs?.['stroke-linejoin'] || 'miter');
  if (v === 'miter' || v === 'round' || v === 'bevel') return v;
  return 'miter';
}

export type ShadowSpec = {
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
} | null;

export function resolveShadow(node: SceneNodeInput): ShadowSpec {
  const attrs = node?.attrs || {};
  if (!boolEffectAttr(attrs['shadow-enabled'], false) || !boolEffectAttr(attrs['shadow-visible'], true)) {
    return null;
  }
  return {
    color: String(attrs['shadow-color'] || 'rgba(0,0,0,0.25)'),
    blur: Math.max(0, Number(attrs['shadow-blur'] ?? 4)),
    offsetX: Number(attrs['shadow-x'] ?? 0),
    offsetY: Number(attrs['shadow-y'] ?? 2),
  };
}
