/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/core/layout.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { RcbVec } from './types';

export type RcbBoxLike = {
  left?: number;
  top?: number;
  x?: number;
  y?: number;
  width: number;
  height: number;
};

export type RcbAlign =
  | 'center'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'top-center'
  | 'bottom-center'
  | 'left-center'
  | 'right-center';

function boxOrigin(box: RcbBoxLike) {
  return {
    left: Number(box.left ?? box.x) || 0,
    top: Number(box.top ?? box.y) || 0,
    width: Math.max(0, Number(box.width) || 0),
    height: Math.max(0, Number(box.height) || 0),
  };
}

/**
 * Place a `size` element inside `box` (scene or stage pixels — same math).
 * Returns top-left of the placed element.
 *
 * @example
 * ```ts
 * import { rcbAlignInBox } from '@recombyn-native/components/rcb'
 * const { x, y } = rcbAlignInBox(imageBox, { width: 32, height: 32 }, 'center')
 * ```
 */
export function rcbAlignInBox(
  box: RcbBoxLike,
  size: { width: number; height: number },
  align: RcbAlign = 'center',
  pad = 0
): RcbVec {
  const b = boxOrigin(box);
  const w = Math.max(0, Number(size.width) || 0);
  const h = Math.max(0, Number(size.height) || 0);
  const p = Math.max(0, Number(pad) || 0);
  const innerL = b.left + p;
  const innerT = b.top + p;
  const innerR = b.left + b.width - p;
  const innerB = b.top + b.height - p;
  const innerW = Math.max(0, innerR - innerL);
  const innerH = Math.max(0, innerB - innerT);

  let x = innerL;
  let y = innerT;
  switch (align) {
    case 'center':
      x = innerL + (innerW - w) / 2;
      y = innerT + (innerH - h) / 2;
      break;
    case 'top-left':
      x = innerL;
      y = innerT;
      break;
    case 'top-right':
      x = innerR - w;
      y = innerT;
      break;
    case 'bottom-left':
      x = innerL;
      y = innerB - h;
      break;
    case 'bottom-right':
      x = innerR - w;
      y = innerB - h;
      break;
    case 'top-center':
      x = innerL + (innerW - w) / 2;
      y = innerT;
      break;
    case 'bottom-center':
      x = innerL + (innerW - w) / 2;
      y = innerB - h;
      break;
    case 'left-center':
      x = innerL;
      y = innerT + (innerH - h) / 2;
      break;
    case 'right-center':
      x = innerR - w;
      y = innerT + (innerH - h) / 2;
      break;
    default:
      break;
  }
  return { x, y };
}

/** Shorthand: center `size` inside `box`. */
export function rcbCenterInBox(
  box: RcbBoxLike,
  size: { width: number; height: number },
  pad = 0
): RcbVec {
  return rcbAlignInBox(box, size, 'center', pad);
}

/**
 * On-canvas size for an uploaded / pasted image / generator plate.
 *
 * Scene units are zoom-independent, so a fixed pixel cap lands huge when the user
 * is zoomed out and postage-stamp small when zoomed in. Measure against the visible
 * viewport instead: keep the natural size while it already reads well, otherwise
 * scale so the image covers between `minRatio` and `maxRatio` of the screen.
 *
 * `viewport` is the on-screen stage size in CSS px; `zoom` the current camera zoom.
 *
 * When natural is larger than the viewport band, we **shrink** (scale < 1).
 * When natural is smaller, we may upscale up to `maxRatio` but never above
 * `contain(maxRatio)`.
 */
export function rcbFitImageIntoViewport(
  natural: { width: number; height: number },
  viewport: { width: number; height: number },
  zoom: number,
  { minRatio = 0.25, maxRatio = 0.6 }: { minRatio?: number; maxRatio?: number } = {}
): { width: number; height: number } {
  const nw = Math.max(1, Number(natural.width) || 1);
  const nh = Math.max(1, Number(natural.height) || 1);
  const z = Math.max(0.05, Number(zoom) || 1);
  // Visible scene rect (CSS px / zoom).
  const vw = Math.max(1, (Number(viewport.width) || 1) / z);
  const vh = Math.max(1, (Number(viewport.height) || 1) / z);
  const contain = (ratio: number) => Math.min((vw * ratio) / nw, (vh * ratio) / nh);
  const maxScale = contain(maxRatio);
  const minScale = contain(minRatio);
  // Prefer natural (scale 1) when it already sits in [min, max] band.
  let scale = 1;
  if (maxScale < 1) {
    // Natural too big for the viewport band — shrink to maxRatio.
    scale = maxScale;
  } else if (minScale > 1) {
    // Natural too small — grow toward minRatio (capped by maxScale).
    scale = Math.min(minScale, maxScale);
  }
  return {
    width: Math.max(1, Math.round(nw * scale)),
    height: Math.max(1, Math.round(nh * scale)),
  };
}

/**
 * Center a node-sized rect on a point (e.g. drop image centered on pointer).
 */
export function rcbCenterOnPoint(
  point: RcbVec,
  size: { width: number; height: number }
): { left: number; top: number; width: number; height: number } {
  const w = Math.max(1, Number(size.width) || 1);
  const h = Math.max(1, Number(size.height) || 1);
  return {
    left: point.x - w / 2,
    top: point.y - h / 2,
    width: w,
    height: h,
  };
}

/** Empty generator plates use an inset border — outer edge === path (no center-stroke outset). */
export const GENERATOR_EMPTY_STROKE_OUTSET = 0;

function snapCoord(value: number, gridSize: number): number {
  if (!(gridSize > 0) || !Number.isFinite(value)) return value;
  return Math.round(value / gridSize) * gridSize;
}

/** Snap all four edges (same contract as selection `snapBoxEdgesToGrid`). */
function snapEdgesToGrid(
  box: { left: number; top: number; width: number; height: number },
  gridSize: number,
  minCells = 1
): { left: number; top: number; width: number; height: number } {
  if (!(gridSize > 0)) return box;
  let left = snapCoord(box.left, gridSize);
  let top = snapCoord(box.top, gridSize);
  let right = snapCoord(box.left + box.width, gridSize);
  let bottom = snapCoord(box.top + box.height, gridSize);
  const min = Math.max(1, minCells) * gridSize;
  if (right - left < min) right = left + min;
  if (bottom - top < min) bottom = top + min;
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Fit → center → snap painted outer to the pixel grid → optional outset inset
 * for path geom. Image/video generators use inset borders (outset 0) so path
 * edges are the ink edges — never leave a half-cell float outside the grid.
 */
export function rcbLayoutGeneratorPlate(opts: {
  natural: { width: number; height: number };
  viewport: { width: number; height: number };
  zoom: number;
  center: RcbVec;
  gridSize?: number;
  /** Outside path extent of center stroke (generators = 0.5). */
  visualOutset?: number;
  fit?: { minRatio?: number; maxRatio?: number };
}): { left: number; top: number; width: number; height: number; visual: { left: number; top: number; width: number; height: number } } {
  const gridSize = opts.gridSize != null && opts.gridSize > 0 ? opts.gridSize : 1;
  const outset = Math.max(0, Number(opts.visualOutset) || 0);
  const sized = rcbFitImageIntoViewport(opts.natural, opts.viewport, opts.zoom, opts.fit);
  const placed = rcbCenterOnPoint(opts.center, sized);
  const rawVisual = {
    left: placed.left - outset,
    top: placed.top - outset,
    width: placed.width + outset * 2,
    height: placed.height + outset * 2,
  };
  const minCells = Math.max(1, Math.ceil((outset * 2) / gridSize) + 1);
  const visual = snapEdgesToGrid(rawVisual, gridSize, minCells);
  const geom = {
    left: visual.left + outset,
    top: visual.top + outset,
    width: Math.max(gridSize, visual.width - outset * 2),
    height: Math.max(gridSize, visual.height - outset * 2),
  };
  return { ...geom, visual };
}

/** Empty-state glyph size in scene units — always fits inside the plate. */
export function generatorEmptyIconSize(boxW: number, boxH: number): number {
  const side = Math.min(Math.max(0, boxW), Math.max(0, boxH));
  // Never floor to a fixed scene px (old Math.max(72, …) overflowed at 3000% zoom).
  return side * 0.28;
}

/**
 * Default font size when placing text with the T tool.
 * Targets ~`screenPx` CSS pixels on screen so high zoom does not spawn
 * document-14px glyphs that fill half the viewport.
 */
export function rcbDefaultPlaceFontSize(zoom: number, screenPx = 14): number {
  const z = Math.max(0.05, Number(zoom) || 1);
  const target = Math.max(1, Number(screenPx) || 14);
  const raw = target / z;
  // Half-pixel steps (same lattice as odd center strokes); never below 1 scene px.
  return Math.max(1, Math.round(raw * 2) / 2);
}
