/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/scene/document/sceneStrokeStyle.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Stroke line styles (dash patterns) shared by panel UI + sceneToSvg.
 */

export type StrokeStyle =
  | 'solid'
  | 'dashed'
  | 'dotted'
  | 'long-dash'
  | 'short-dash'
  | 'dash-dot'
  | 'dash-dot-dot'
  | 'dense-dot';

export const STROKE_STYLES: StrokeStyle[] = [
  'solid',
  'dashed',
  'dotted',
  'long-dash',
  'short-dash',
  'dash-dot',
  'dash-dot-dot',
  'dense-dot',
];

/** Canvas / SVG stroke-dasharray (user units). */
const DASH_CANVAS: Record<StrokeStyle, string | undefined> = {
  solid: undefined,
  dashed: '8 4',
  dotted: '2 3',
  'long-dash': '16 6',
  'short-dash': '4 3',
  'dash-dot': '10 4 2 4',
  'dash-dot-dot': '10 3 2 3 2 3',
  'dense-dot': '1 2',
};

/** Compact preview dasharray for 20×8 icon. */
const DASH_PREVIEW: Record<StrokeStyle, string | undefined> = {
  solid: undefined,
  dashed: '5 3',
  dotted: '1.5 2.5',
  'long-dash': '9 3',
  'short-dash': '3 2.5',
  'dash-dot': '6 2.5 1.5 2.5',
  'dash-dot-dot': '5.5 2 1.2 2 1.2 2',
  'dense-dot': '1 1.6',
};

export function isStrokeStyle(value: unknown): value is StrokeStyle {
  return typeof value === 'string' && (STROKE_STYLES as string[]).includes(value);
}

export function parseStrokeStyle(value: unknown): StrokeStyle {
  return isStrokeStyle(value) ? value : 'solid';
}

export function strokeDashForStyle(style: unknown): string | undefined {
  return DASH_CANVAS[parseStrokeStyle(style)];
}

export function strokeDashPreview(style: StrokeStyle): string | undefined {
  return DASH_PREVIEW[style];
}
