/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/core/geometry/baseline.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';
/**
 * Shape baseline geometry — single source of truth.
 * Paint (stroke/fill) and indicators all read from `getShapeBaseline`.
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
  ellipseArcPercentFromAttrs,
  ellipseInnerRatioFromAttrs,
  ellipseStartDegFromAttrs,
  shapeVertexPoints,
  sidesFromAttrs,
  starInnerRatioFromAttrs,
} from '@recombyn-native/components/rcb/scene/document/sceneShapes';
import { scalePathData } from '@recombyn-native/components/rcb/scene/document/pathScale';
import { PathBuilder } from './PathBuilder';

/** Fixed arrowhead length in local (pre-rotation) units. */
export const ARROW_HEAD = 14;

export type ShapeBaseline = {
  /** Local-space SVG path `d` (geometric skeleton). */
  d: string;
  /** Closed path may take fill; open paths are stroke-only. */
  closed: boolean;
  kind: 'geo' | 'stroke' | 'path' | 'box';
};

export type BaselineSizeOpts = { width?: number; height?: number };

function resolveShapeType(node: SceneNodeInput): string {
  const key = String(node?.key || '');
  if (key === 'ellipse') return 'circle';
  if (key === 'rect') return 'rect';
  if (key === 'text' || key === 'image') return key;
  if (key === 'path') return 'path';
  return String(node?.attrs?.shapeType || (key === 'shape' ? 'rect' : ''));
}

/** Open arrow: shaft to tip + V through tip (continuous stroke). */
export function arrowBaselinePath(width: number, height: number, head = ARROW_HEAD): string {
  const w = Math.max(1, width);
  const mid = Math.max(1, height) / 2;
  const headLen = Math.min(head, w * 0.45);
  const wing = headLen * 0.55;
  return new PathBuilder()
    .moveTo(0, mid)
    .lineTo(w, mid)
    .moveTo(w - headLen, mid - wing)
    .lineTo(w, mid)
    .lineTo(w - headLen, mid + wing)
    .toD();
}

export function lineBaselinePath(width: number, height: number): string {
  const mid = Math.max(1, height) / 2;
  return new PathBuilder().moveTo(0, mid).lineTo(Math.max(1, width), mid).toD();
}

/**
 * Geometric baseline for any scene node.
 * Pass live width/height while resizing so path tracks the preview.
 */
export function getShapeBaseline(
  node: SceneNodeInput,
  opts?: BaselineSizeOpts
): ShapeBaseline | null {
  if (!node) return null;
  const storedW = Math.max(1, Number(node.width) || 1);
  const storedH = Math.max(1, Number(node.height) || 1);
  const w = Math.max(1, opts?.width ?? storedW);
  const h = Math.max(1, opts?.height ?? storedH);
  const key = String(node.key || '');
  const shapeType = resolveShapeType(node);

  if (
    shapeType === 'text' ||
    shapeType === 'image' ||
    key === 'text' ||
    key === 'image' ||
    key === 'video' ||
    key === 'lottie' ||
    key === 'audio'
  ) {
    // Match sceneToSvg plate / clip path (generators are always sharp).
    const gen =
      (key === 'image' &&
        (node.attrs?.imageGenerator === true ||
          node.attrs?.imageGenerator === 'true' ||
          node.attrs?.imageGenerator === 1 ||
          node.attrs?.imageGenerator === '1')) ||
      (key === 'video' &&
        (node.attrs?.videoGenerator === true ||
          node.attrs?.videoGenerator === 'true' ||
          node.attrs?.videoGenerator === 1 ||
          node.attrs?.videoGenerator === '1')) ||
      (key === 'lottie' &&
        (node.attrs?.lottieGenerator === true ||
          node.attrs?.lottieGenerator === 'true' ||
          node.attrs?.lottieGenerator === 1 ||
          node.attrs?.lottieGenerator === '1')) ||
      (key === 'audio' &&
        (node.attrs?.audioGenerator === true ||
          node.attrs?.audioGenerator === 'true' ||
          node.attrs?.audioGenerator === 1 ||
          node.attrs?.audioGenerator === '1'));
    const r = gen
      ? { tl: 0, tr: 0, br: 0, bl: 0 }
      : key === 'text'
        ? { tl: 0, tr: 0, br: 0, bl: 0 }
        : clampCornerRadii(radiiFromAttrs(node.attrs), w, h);
    return {
      d: roundedRectPath(w, h, r),
      closed: true,
      kind: 'box',
    };
  }

  if (
    shapeType === 'pen' ||
    shapeType === 'pencil' ||
    shapeType === 'path' ||
    key === 'path'
  ) {
    const raw = String(node.attrs?.path || node.attrs?.d || '').trim();
    if (!raw) return null;
    const d =
      Math.abs(w - storedW) > 0.05 || Math.abs(h - storedH) > 0.05
        ? scalePathData(raw, w / storedW, h / storedH)
        : raw;
    const closed =
      node.attrs?.closed === true ||
      node.attrs?.closed === 'true' ||
      /\sZ\s*$/i.test(d.trim());
    return { d, closed: shapeType === 'pen' ? false : closed, kind: 'path' };
  }

  if (shapeType === 'line') {
    return { d: lineBaselinePath(w, h), closed: false, kind: 'stroke' };
  }

  if (shapeType === 'arrow') {
    return { d: arrowBaselinePath(w, h), closed: false, kind: 'stroke' };
  }

  if (shapeType === 'circle') {
    const innerRatio = ellipseInnerRatioFromAttrs(node.attrs);
    const arcPercent = ellipseArcPercentFromAttrs(node.attrs);
    const startDeg = ellipseStartDegFromAttrs(node.attrs);
    return {
      d: PathBuilder.ellipseVariant(w, h, { innerRatio, arcPercent, startDeg }).toD(),
      closed: true,
      kind: 'geo',
    };
  }

  if (shapeType === 'rect' || shapeType === 'roundRect' || shapeType === '') {
    const r = clampCornerRadii(radiiFromAttrs(node.attrs), w, h);
    return { d: roundedRectPath(w, h, r), closed: true, kind: 'geo' };
  }

  if (shapeType === 'triangle' || shapeType === 'star' || shapeType === 'polygon') {
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
    return {
      d: d || `M ${pts.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`,
      closed: true,
      kind: 'geo',
    };
  }

  return null;
}

/** Baseline `d` only. */
export function getShapeBaselineD(
  node: SceneNodeInput,
  opts?: BaselineSizeOpts
): string | null {
  return getShapeBaseline(node, opts)?.d ?? null;
}
