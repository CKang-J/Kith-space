/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/scene/document/sceneHitBridge.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { SceneDocument, SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';
/**
 * Scene pick / hit-test domain — shared by SvgCanvas and bridge consumers
 * (e.g. FrameMoveFeature via setSceneHitTestBridge).
 *
 * Spatial candidate order stays in SceneSpatialRuntime; this module owns
 * per-node ink tests (Path2D / SVG DOM / AABB fallbacks).
 */

import { getShapeBaselineD } from '@recombyn-native/components/rcb/core/geometry';
import {
  deflateSelectionBox,
  inflateBoxByVisualOutset,
  resolveStroke,
  resolveStrokeAlign,
} from '@recombyn-native/components/rcb/scene/document/sceneEffects';
import { isNodeHidden, supportsFill } from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';
import {
  HEAVY_PATH_D_CHARS,
  distPointToPathD,
  distPointToSegment,
  hitTestPath2DLocal,
  hitTestSvgNodeAtClient,
  pathDContainsPoint,
  rememberNodePath2D,
  sceneHitSlop,
  strokeEndpointsFromBox,
} from '@recombyn-native/components/rcb/scene/document/sceneShapes';

export type SceneHitFn = (
  x: number,
  y: number,
  screen?: { clientX: number; clientY: number }
) => string | null;

export type SceneHitBox = { left: number; top: number; width: number; height: number };

export type HitTestSceneAtPointOpts = {
  document: SceneDocument;
  /** Top→bottom candidate ids (from SceneSpatialRuntime.hitCandidateIds). */
  order: readonly string[];
  x: number;
  y: number;
  zoom: number;
  screen?: { clientX: number; clientY: number };
  getNodeBox: (nodeId: string) => SceneHitBox | null;
  /** Live SVG hosts for DOM isPointInFill/Stroke (optional). */
  nodeEls?: Map<string, Element> | null;
};

let hitFn: SceneHitFn | null = null;

export function setSceneHitTestBridge(fn: SceneHitFn | null) {
  hitFn = fn;
}

export function bridgeSceneHitTest(
  x: number,
  y: number,
  screen?: { clientX: number; clientY: number }
): string | null {
  return hitFn?.(x, y, screen) ?? null;
}

function toNodeLocal(
  x: number,
  y: number,
  originLeft: number,
  originTop: number,
  width: number,
  height: number,
  angle: number
): { lx: number; ly: number } {
  let lx = x - originLeft;
  let ly = y - originTop;
  if (Math.abs(angle) > 0.5) {
    const cx = width / 2;
    const cy = height / 2;
    const rad = (-angle * Math.PI) / 180;
    const dx = lx - cx;
    const dy = ly - cy;
    lx = dx * Math.cos(rad) - dy * Math.sin(rad) + cx;
    ly = dx * Math.sin(rad) + dy * Math.cos(rad) + cy;
  }
  return { lx, ly };
}

function hitsRotatedAabb(
  x: number,
  y: number,
  box: SceneHitBox,
  angle: number,
  pad: number
): boolean {
  if (Math.abs(angle) > 0.5) {
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const rad = (-angle * Math.PI) / 180;
    const dx = x - cx;
    const dy = y - cy;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    return Math.abs(lx) <= box.width / 2 + pad && Math.abs(ly) <= box.height / 2 + pad;
  }
  return (
    x >= box.left - pad &&
    x <= box.left + box.width + pad &&
    y >= box.top - pad &&
    y <= box.top + box.height + pad
  );
}

function isGeoShapeNode(node: SceneNodeInput, shapeType: string): boolean {
  const key = String(node.key || '');
  return (
    key === 'shape' ||
    key === 'rect' ||
    key === 'ellipse' ||
    shapeType === 'rect' ||
    shapeType === 'roundRect' ||
    shapeType === 'circle' ||
    shapeType === 'triangle' ||
    shapeType === 'star' ||
    shapeType === 'polygon'
  );
}

function hitTestLineOrArrow(opts: {
  id: string;
  node: SceneNodeInput;
  box: SceneHitBox;
  x: number;
  y: number;
  pad: number;
}): boolean {
  const { id, node, box, x, y, pad } = opts;
  const angle = Number(node.attrs?.angle) || 0;
  const geom = deflateSelectionBox(box, node);
  const d = getShapeBaselineD(node, {
    width: Math.max(1, geom.width),
    height: Math.max(1, geom.height),
  });
  if (d) {
    const { lx, ly } = toNodeLocal(x, y, geom.left, geom.top, geom.width, geom.height, angle);
    const { strokeWidth: sw } = resolveStroke(node, '#333333');
    const hitW = Math.max(sw > 0 ? sw : 2, 0) + pad * 2;
    rememberNodePath2D(id, d);
    if (
      hitTestPath2DLocal(d, lx, ly, {
        strokeWidth: hitW,
        lineCap: 'round',
        lineJoin: 'round',
      })
    ) {
      return true;
    }
  }
  const ep = strokeEndpointsFromBox(box, angle);
  return distPointToSegment(x, y, ep.x0, ep.y0, ep.x1, ep.y1) <= pad;
}

function hitTestPathLike(opts: {
  id: string;
  node: SceneNodeInput;
  shapeType: string;
  box: SceneHitBox;
  x: number;
  y: number;
  zoom: number;
  screen?: { clientX: number; clientY: number };
  svgEl?: Element | null;
}): boolean {
  const { id, node, shapeType, box, x, y, zoom, screen, svgEl } = opts;
  const sw = Math.max(
    1,
    Number(node.attrs?.borderWidth ?? node.attrs?.['border-width'] ?? 2) || 2
  );
  const pathPad = sw / 2 + sceneHitSlop(zoom, 10);
  const fillHit = shapeType !== 'pen' && supportsFill(node);
  const inLooseBox =
    x >= box.left - pathPad &&
    x <= box.left + box.width + pathPad &&
    y >= box.top - pathPad &&
    y <= box.top + box.height + pathPad;
  if (!inLooseBox) return false;

  const d = String(node.attrs?.path || node.attrs?.d || '');
  const heavyPath = d.length >= HEAVY_PATH_D_CHARS;
  const angle = Number(node.attrs?.angle) || 0;
  const { lx, ly } = toNodeLocal(x, y, box.left, box.top, box.width, box.height, angle);

  if (!heavyPath && d) {
    rememberNodePath2D(id, d);
    const hitW = sw + pathPad * 2;
    if (
      hitTestPath2DLocal(d, lx, ly, {
        fill: fillHit,
        strokeWidth: hitW,
        fillRule:
          String(node.attrs?.['fill-rule'] || 'nonzero') === 'evenodd' ? 'evenodd' : 'nonzero',
        lineCap: 'round',
        lineJoin: 'round',
      })
    ) {
      return true;
    }
  }

  if (svgEl && screen) {
    const mode = shapeType === 'pencil' || fillHit ? 'auto' : 'stroke';
    const hitW = sw + pathPad * 2;
    if (
      hitTestSvgNodeAtClient(svgEl, screen.clientX, screen.clientY, {
        mode,
        strokeHitWidth: hitW,
      })
    ) {
      return true;
    }
    if (heavyPath) return false;
  }

  if (heavyPath) {
    return Boolean(fillHit && lx >= 0 && ly >= 0 && lx <= box.width && ly <= box.height);
  }
  if (fillHit) {
    const rule = String(node.attrs?.['fill-rule'] || 'nonzero');
    if (pathDContainsPoint(lx, ly, d, rule)) return true;
  }
  return distPointToPathD(lx, ly, d) <= pathPad;
}

function hitTestGeoShape(opts: {
  id: string;
  node: SceneNodeInput;
  box: SceneHitBox;
  x: number;
  y: number;
  pad: number;
}): boolean {
  const { id, node, box, x, y, pad } = opts;
  const geom = deflateSelectionBox(box, node);
  const gw = Math.max(1, geom.width);
  const gh = Math.max(1, geom.height);
  const d = getShapeBaselineD(node, { width: gw, height: gh });
  const angle = Number(node.attrs?.angle) || 0;
  if (d) {
    const { lx, ly } = toNodeLocal(x, y, geom.left, geom.top, gw, gh, angle);
    const { stroke, strokeWidth: sw } = resolveStroke(node, '#333333');
    const align = resolveStrokeAlign(node.attrs);
    const strokeHit =
      stroke && stroke !== 'transparent' && sw > 0
        ? (align === 'outside' ? sw * 2 : sw) + pad * 2
        : 0;
    rememberNodePath2D(id, d);
    if (
      hitTestPath2DLocal(d, lx, ly, {
        fill: supportsFill(node),
        strokeWidth: strokeHit,
        lineCap: 'butt',
        lineJoin: 'miter',
      })
    ) {
      return true;
    }
  }
  const hitBox = inflateBoxByVisualOutset(geom, node);
  return hitsRotatedAabb(x, y, hitBox, angle, pad);
}

function hitTestVisualAabb(opts: {
  node: SceneNodeInput;
  box: SceneHitBox;
  x: number;
  y: number;
  pad: number;
}): boolean {
  const { node, box, x, y, pad } = opts;
  const geom = deflateSelectionBox(box, node);
  const hitBox = inflateBoxByVisualOutset(geom, node);
  const angle = Number(node.attrs?.angle) || 0;
  return hitsRotatedAabb(x, y, hitBox, angle, pad);
}

/** True when scene point hits this node’s ink / visual AABB. */
export function hitTestSceneNodeAt(opts: {
  id: string;
  node: SceneNodeInput;
  box: SceneHitBox;
  x: number;
  y: number;
  zoom: number;
  pad: number;
  screen?: { clientX: number; clientY: number };
  svgEl?: Element | null;
}): boolean {
  const { id, node, box, x, y, zoom, pad, screen, svgEl } = opts;
  const shapeType = String(node.attrs?.shapeType || '');
  if (shapeType === 'line' || shapeType === 'arrow') {
    return hitTestLineOrArrow({ id, node, box, x, y, pad });
  }
  if (shapeType === 'pen' || shapeType === 'pencil' || shapeType === 'path') {
    return hitTestPathLike({ id, node, shapeType, box, x, y, zoom, screen, svgEl });
  }
  if (isGeoShapeNode(node, shapeType)) {
    return hitTestGeoShape({ id, node, box, x, y, pad });
  }
  return hitTestVisualAabb({ node, box, x, y, pad });
}

/**
 * Walk top→bottom candidates; return first hit id.
 * Caller supplies spatially filtered `order` for large scenes.
 */
export function hitTestSceneAtPoint(opts: HitTestSceneAtPointOpts): string | null {
  const { document: doc, order, x, y, zoom, screen, getNodeBox, nodeEls } = opts;
  const pad = sceneHitSlop(Math.max(0.05, zoom || 1));
  for (const id of order) {
    const node = doc?.deltaSetLike?.[id];
    if (!node || isNodeHidden(node)) continue;
    const box = getNodeBox(id);
    if (!box) continue;
    if (
      hitTestSceneNodeAt({
        id,
        node,
        box,
        x,
        y,
        zoom,
        pad,
        screen,
        svgEl: nodeEls?.get(id) ?? null,
      })
    ) {
      return id;
    }
  }
  return null;
}
