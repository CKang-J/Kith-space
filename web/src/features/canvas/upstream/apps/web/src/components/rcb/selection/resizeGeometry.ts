/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/selection/resizeGeometry.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';
export type SceneBox = { left: number; top: number; width: number; height: number };
export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const DEFAULT_MIN = 8;

/** Keep the opposite edge/corner fixed when clamping to min size (prevents bounce). */
function clampBoxAnchored(
  handle: ResizeHandle,
  left: number,
  top: number,
  width: number,
  height: number,
  min = DEFAULT_MIN
): SceneBox {
  const right = left + width;
  const bottom = top + height;
  let nl = left;
  let nt = top;
  let nw = width;
  let nh = height;

  if (nw < min) {
    if (handle === 'w' || handle === 'nw' || handle === 'sw') nl = right - min;
    nw = min;
  }
  if (nh < min) {
    if (handle === 'n' || handle === 'nw' || handle === 'ne') nt = bottom - min;
    nh = min;
  }

  return { left: nl, top: nt, width: nw, height: nh };
}

export function applyAspectToHandle(
  handle: ResizeHandle,
  left: number,
  top: number,
  width: number,
  height: number,
  ratio: number
): SceneBox {
  const r = Math.max(1e-4, ratio);
  const right = left + width;
  const bottom = top + height;

  switch (handle) {
    case 'e': {
      const nw = width;
      const nh = Math.max(DEFAULT_MIN, nw / r);
      return { left, top, width: nw, height: nh };
    }
    case 'w': {
      const nw = width;
      const nh = Math.max(DEFAULT_MIN, nw / r);
      return { left: right - nw, top, width: nw, height: nh };
    }
    case 's': {
      const nh = height;
      const nw = Math.max(DEFAULT_MIN, nh * r);
      return { left, top, width: nw, height: nh };
    }
    case 'n': {
      const nh = height;
      const nw = Math.max(DEFAULT_MIN, nh * r);
      return { left, top: bottom - nh, width: nw, height: nh };
    }
    case 'se': {
      const s = Math.max(width / r, height);
      const nw = Math.max(DEFAULT_MIN, s * r);
      const nh = Math.max(DEFAULT_MIN, s);
      return { left, top, width: nw, height: nh };
    }
    case 'sw': {
      const s = Math.max(width / r, height);
      const nw = Math.max(DEFAULT_MIN, s * r);
      const nh = Math.max(DEFAULT_MIN, s);
      return { left: right - nw, top, width: nw, height: nh };
    }
    case 'ne': {
      const s = Math.max(width / r, height);
      const nw = Math.max(DEFAULT_MIN, s * r);
      const nh = Math.max(DEFAULT_MIN, s);
      return { left, top: bottom - nh, width: nw, height: nh };
    }
    case 'nw': {
      const s = Math.max(width / r, height);
      const nw = Math.max(DEFAULT_MIN, s * r);
      const nh = Math.max(DEFAULT_MIN, s);
      return { left: right - nw, top: bottom - nh, width: nw, height: nh };
    }
    default:
      return { left, top, width, height };
  }
}

export function resizeFromHandle(
  union: SceneBox,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  angleDeg: number,
  opts?: { lockAspect?: boolean; aspectRatio?: number; min?: number }
): SceneBox {
  const min = opts?.min ?? DEFAULT_MIN;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const ldx = dx * cos + dy * sin;
  const ldy = -dx * sin + dy * cos;

  let { left, top, width, height } = union;

  switch (handle) {
    case 'e':
      width += ldx;
      break;
    case 'w':
      left += ldx;
      width -= ldx;
      break;
    case 's':
      height += ldy;
      break;
    case 'n':
      top += ldy;
      height -= ldy;
      break;
    case 'se':
      width += ldx;
      height += ldy;
      break;
    case 'sw':
      left += ldx;
      width -= ldx;
      height += ldy;
      break;
    case 'ne':
      top += ldy;
      width += ldx;
      height -= ldy;
      break;
    case 'nw':
      left += ldx;
      top += ldy;
      width -= ldx;
      height -= ldy;
      break;
    default:
      return union;
  }

  let box = clampBoxAnchored(handle, left, top, width, height, min);

  if (opts?.lockAspect) {
    const ratio =
      opts.aspectRatio && Number.isFinite(opts.aspectRatio) && opts.aspectRatio > 0
        ? opts.aspectRatio
        : union.width / Math.max(1, union.height);
    box = applyAspectToHandle(handle, box.left, box.top, box.width, box.height, ratio);
    box = clampBoxAnchored(handle, box.left, box.top, box.width, box.height, min);
  }

  return box;
}

export function sizeFromAspectPreset(
  box: SceneBox,
  ratioW: number,
  ratioH: number,
  min = DEFAULT_MIN
): { width: number; height: number } {
  const r = Math.max(1e-4, ratioW / ratioH);
  const width = Math.max(min, Math.round(box.width));
  const height = Math.max(min, Math.round(width / r));
  return { width, height };
}

export function matchAspectPresetKey(
  width: number,
  height: number,
  presets: Array<{ id: string; w: number; h: number }>
): string {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  for (const p of presets) {
    if (p.id === 'original' || p.w <= 0 || p.h <= 0) continue;
    // Cross-multiply with a small pixel slack — old ±0.02 ratio falsely
    // labeled 449×457 as 1:1.
    const slack = Math.max(2, 0.005 * Math.max(w, h));
    if (Math.abs(w * p.h - h * p.w) <= slack) return p.id;
  }
  return 'original';
}

/** Scale child boxes so the group maps from `from` → `to` (same top-left origin mapping). */
export function scaleBoxesToUnion(
  origins: SceneBox[],
  from: SceneBox,
  to: SceneBox
): SceneBox[] {
  const sx = to.width / Math.max(1e-4, from.width);
  const sy = to.height / Math.max(1e-4, from.height);
  return origins.map((o) => ({
    left: to.left + (o.left - from.left) * sx,
    top: to.top + (o.top - from.top) * sy,
    width: Math.max(1, o.width * sx),
    height: Math.max(1, o.height * sy),
  }));
}

/**
 * Scale child boxes with `from`→`to` in the local frame of a rotated control box.
 * When angle≈0, identical to {@link scaleBoxesToUnion}.
 */
export function scaleBoxesToOrientedUnion(
  origins: SceneBox[],
  from: SceneBox,
  to: SceneBox,
  angleDeg: number
): SceneBox[] {
  if (Math.abs(angleDeg) < 0.01) return scaleBoxesToUnion(origins, from, to);

  const sx = to.width / Math.max(1e-4, from.width);
  const sy = to.height / Math.max(1e-4, from.height);
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const ic = Math.cos(-rad);
  const isn = Math.sin(-rad);
  const fromCx = from.left + from.width / 2;
  const fromCy = from.top + from.height / 2;
  const toCx = to.left + to.width / 2;
  const toCy = to.top + to.height / 2;

  return origins.map((o) => {
    const ocx = o.left + o.width / 2;
    const ocy = o.top + o.height / 2;
    const dx = ocx - fromCx;
    const dy = ocy - fromCy;
    const lx = dx * ic - dy * isn;
    const ly = dx * isn + dy * ic;
    const nlx = lx * sx;
    const nly = ly * sy;
    const nw = Math.max(1, o.width * sx);
    const nh = Math.max(1, o.height * sy);
    const nx = toCx + nlx * cos - nly * sin;
    const ny = toCy + nlx * sin + nly * cos;
    return {
      left: nx - nw / 2,
      top: ny - nh / 2,
      width: nw,
      height: nh,
    };
  });
}

/** Axis-aligned bounds of a box after rotating about its center. */
export function rotatedAabbBox(box: SceneBox, angleDeg: number): SceneBox {
  if (Math.abs(angleDeg) < 0.01) {
    return { left: box.left, top: box.top, width: box.width, height: box.height };
  }
  const w = Math.max(1, box.width);
  const h = Math.max(1, box.height);
  const cx = box.left + w / 2;
  const cy = box.top + h / 2;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of [
    [box.left, box.top],
    [box.left + w, box.top],
    [box.left + w, box.top + h],
    [box.left, box.top + h],
  ] as const) {
    const dx = px - cx;
    const dy = py - cy;
    const rx = cx + dx * cos - dy * sin;
    const ry = cy + dx * sin + dy * cos;
    minX = Math.min(minX, rx);
    minY = Math.min(minY, ry);
    maxX = Math.max(maxX, rx);
    maxY = Math.max(maxY, ry);
  }
  return {
    left: minX,
    top: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/** Rotate box centers around a point; sizes unchanged. Returns new boxes. */
export function rotateBoxesAround(
  origins: SceneBox[],
  center: { x: number; y: number },
  deltaDeg: number
): SceneBox[] {
  const rad = (deltaDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return origins.map((o) => {
    const ocx = o.left + o.width / 2;
    const ocy = o.top + o.height / 2;
    const dx = ocx - center.x;
    const dy = ocy - center.y;
    const nx = center.x + dx * cos - dy * sin;
    const ny = center.y + dx * sin + dy * cos;
    return {
      left: nx - o.width / 2,
      top: ny - o.height / 2,
      width: o.width,
      height: o.height,
    };
  });
}

export function unionOfBoxes(boxes: SceneBox[]): SceneBox | null {
  if (!boxes.length) return null;
  let minL = boxes[0].left;
  let minT = boxes[0].top;
  let maxR = boxes[0].left + boxes[0].width;
  let maxB = boxes[0].top + boxes[0].height;
  for (let i = 1; i < boxes.length; i++) {
    const b = boxes[i];
    minL = Math.min(minL, b.left);
    minT = Math.min(minT, b.top);
    maxR = Math.max(maxR, b.left + b.width);
    maxB = Math.max(maxB, b.top + b.height);
  }
  return { left: minL, top: minT, width: Math.max(1, maxR - minL), height: Math.max(1, maxB - minT) };
}

/** Control-box member: scene AABB + optional live angle override. */
export type ChromeOrigin = { nodeId: string; box: SceneBox; angle?: number };

function isFrameChromeId(id: string) {
  return typeof id === 'string' && id.startsWith('frame:');
}

function rotAroundOrigin(x: number, y: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

export function memberChromeAngle(document: SceneDocument, o: ChromeOrigin): number {
  if (o.angle != null && Number.isFinite(o.angle)) return Number(o.angle);
  if (isFrameChromeId(o.nodeId)) return 0;
  const n = Number(document?.deltaSetLike?.[o.nodeId]?.attrs?.angle);
  return Number.isFinite(n) ? n : 0;
}

/** Common member angle, or 0 when the selection is mixed. */
export function getSelectionSharedRotation(document: SceneDocument, nodeIds: string[]): number {
  let found = false;
  let rotation = 0;
  for (const id of nodeIds) {
    if (isFrameChromeId(id)) continue;
    const a = memberChromeAngle(document, { nodeId: id, box: { left: 0, top: 0, width: 1, height: 1 } });
    if (!found) {
      found = true;
      rotation = a;
    } else if (Math.abs(a - rotation) > 0.05) {
      return 0;
    }
  }
  return found ? rotation : 0;
}

/** Oriented control box when angles match; else page AABB of painted bounds. */
export function getSelectionRotatedUnion(
  document: SceneDocument,
  origins: ChromeOrigin[],
  sharedRotationDeg: number
): SceneBox | null {
  if (!origins.length) return null;
  if (Math.abs(sharedRotationDeg) < 0.01) {
    return unionOfBoxes(
      origins.map((o) =>
        isFrameChromeId(o.nodeId) ? o.box : rotatedAabbBox(o.box, memberChromeAngle(document, o))
      )
    );
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const rad = (-sharedRotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  for (const o of origins) {
    const ang = memberChromeAngle(document, o);
    const { left, top, width, height } = o.box;
    const cx = left + width / 2;
    const cy = top + height / 2;
    const ar = (ang * Math.PI) / 180;
    const ac = Math.cos(ar);
    const as = Math.sin(ar);
    for (const [lx, ly] of [
      [left, top],
      [left + width, top],
      [left + width, top + height],
      [left, top + height],
    ] as const) {
      const dx = lx - cx;
      const dy = ly - cy;
      const px = Math.abs(ang) < 0.01 ? lx : cx + dx * ac - dy * as;
      const py = Math.abs(ang) < 0.01 ? ly : cy + dx * as + dy * ac;
      const ux = px * cos - py * sin;
      const uy = px * sin + py * cos;
      minX = Math.min(minX, ux);
      minY = Math.min(minY, uy);
      maxX = Math.max(maxX, ux);
      maxY = Math.max(maxY, uy);
    }
  }
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const centerPage = rotAroundOrigin(minX + w / 2, minY + h / 2, sharedRotationDeg);
  return {
    left: centerPage.x - w / 2,
    top: centerPage.y - h / 2,
    width: w,
    height: h,
  };
}

/** Prefer live tilted chrome; else derive from shared member angles. */
export function resolveControlChrome(
  document: SceneDocument,
  origins: ChromeOrigin[],
  liveUnion?: SceneBox | null,
  liveAngle?: number
): { box: SceneBox; angle: number } {
  const fallback = unionOfBoxes(origins.map((o) => o.box)) || {
    left: 0,
    top: 0,
    width: 1,
    height: 1,
  };
  if (!origins.length) return { box: fallback, angle: 0 };
  if (origins.length === 1) {
    const id = origins[0].nodeId;
    return {
      box: { ...(liveUnion || origins[0].box) },
      angle:
        liveAngle ||
        (isFrameChromeId(id) ? 0 : memberChromeAngle(document, origins[0])),
    };
  }
  if (liveUnion && Math.abs(Number(liveAngle) || 0) > 0.01) {
    return { box: { ...liveUnion }, angle: Number(liveAngle) };
  }
  const angle =
    Number(liveAngle) ||
    getSelectionSharedRotation(
      document,
      origins.map((o) => o.nodeId)
    );
  return {
    box: getSelectionRotatedUnion(document, origins, angle) || fallback,
    angle,
  };
}

/** Point inside an oriented control box (local AABB + angle about center). */
export function pointInOrientedBox(
  p: { x: number; y: number },
  box: SceneBox,
  angleDeg: number
): boolean {
  if (Math.abs(angleDeg) < 0.01) {
    return (
      p.x >= box.left &&
      p.x <= box.left + box.width &&
      p.y >= box.top &&
      p.y <= box.top + box.height
    );
  }
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const rad = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - cx;
  const dy = p.y - cy;
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return Math.abs(lx) <= box.width / 2 && Math.abs(ly) <= box.height / 2;
}
