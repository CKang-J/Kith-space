/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/selection/selectionLogic.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { nodeLeftTop } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import type { SceneDocument, SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';
import {
  getDocumentGridSize,
  snapBoxToGrid,
  snapResizeToGrid,
  snapMoveToSmartGuides,
  snapResizeToSmartGuides,
  smartSnapThreshold,
  smartGuideTargetPad,
  collectMoveSnapIndicators,
  collectPairSpacingGuides,
  GUIDE_COINCIDE_EPS,
  SMART_GUIDE_COLOR,
  type SceneBox,
  type SmartGuideLine,
} from './alignGuides';
import {
  resizeFromHandle,
  rotateBoxesAround,
  scaleBoxesToOrientedUnion,
  unionOfBoxes,
  resolveControlChrome,
  getSelectionSharedRotation,
  pointInOrientedBox,
  type ResizeHandle,
} from './resizeGeometry';
import {
  pathStrokeHitsSceneBox,
  rememberNodePath2D,
  resizeStrokeByEndpoint,
  strokeEndpointsFromBox,
} from '@recombyn-native/components/rcb/scene/document/sceneShapes';
import { expandSelectionWithGroups } from '@recombyn-native/components/rcb/scene/document/sceneGroups';
import {
  isAudioGeneratorNode,
  isImageGeneratorNode,
  isLottieGeneratorNode,
  isVideoGeneratorNode,
  isNodeHidden,
  isNodeLocked,
  supportsCornerRadius,
  supportsFill,
  supportsShapeSides,
} from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';
import { listImageVariantUrls } from '@recombyn-native/components/rcb/scene/document/mediaLifecycle';
import { nodeIdsInsideFrames } from '@recombyn-native/components/rcb/scene/document/sceneClipboard';
import {
  TEXT_SELECTION_PAD,
  deflateSelectionBox,
  inflateBoxByVisualOutset,
  inflateSelectionBox,
  strokeChromeOutset,
  strokeVisualOutset,
} from '@recombyn-native/components/rcb/scene/document/sceneEffects';
import { isEditablePathNode } from '@recombyn-native/components/rcb/scene/paint/outlineToPath';
import {
  measureWrappedTextSize,
  parseNodeText,
  parseNodeTextStyle,
} from '@recombyn-native/components/rcb/scene/document/sceneText';
import type { TextResizeMode } from '@recombyn-native/components/rcb/scene/paint/svgToScene';
import { getSharedNodeEls } from '@recombyn-native/components/rcb/shapes/shapeHostRegistry';
import {
  liveShapeGeomBox,
  nodeUsesPathChrome,
  nodeUsesOpenStrokeEndpoints,
  pathLocalEndpoints,
  localPointToWorld,
  boxFromLocalAnchor,
  resolveOutlinePathD,
  type ShapeOutlineItem,
} from './HostPathChrome';
import {
  rcbCameraCssZoom,
  rcbClientDeltaToScene,
  rcbClientToStageLocal,
  rcbResolveViewportEl,
  rcbViewportMetrics,
} from '@recombyn-native/components/rcb/core/math';
import { frameSelId, parseFrameSelId } from './frameSelectionIds';

export const CORNER_HANDLES = new Set<ResizeHandle>(['nw', 'ne', 'sw', 'se']);

export function textResizeModeForHandle(handle: ResizeHandle): TextResizeMode {
  return handle === 'e' || handle === 'w' ? 'wrap' : 'scale';
}

/**
 * Aspect lock while resizing.
 * - Toolbar lock and Shift are OR'd: Shift reinforces proportional scale,
 *   and never unlocks when the chain icon is already on (avoids fight with lock).
 * - Single text corners: proportional by default; Shift allows free resize.
 * - Image/video default locked; other nodes free unless `lockAspect` is set.
 */
export function nodeAspectLockDefault(key: string | undefined): boolean {
  return key === 'image' || key === 'video' || key === 'lottie' || key === 'audio';
}

export type MediaTitleIcon =
  | 'image'
  | 'image-generator'
  | 'video'
  | 'video-generator'
  | 'lottie'
  | 'lottie-generator'
  | 'audio';

export function mediaTitleChrome(opts: {
  key: string | undefined;
  name?: unknown;
  isImageGen: boolean;
  isVideoGen: boolean;
  isLottieGen: boolean;
  isAudioGen: boolean;
  isVideo: boolean;
}): { name: string; icon: MediaTitleIcon; renameAriaLabel: string } {
  const key = String(opts.key || '');
  if (opts.isVideoGen) {
    return {
      name: String(opts.name || 'Video'),
      icon: 'video-generator',
      renameAriaLabel: 'Video name',
    };
  }
  if (opts.isAudioGen || key === 'audio') {
    return {
      name: String(opts.name || (opts.isAudioGen ? 'Audio Generator' : 'Audio')),
      icon: 'audio',
      renameAriaLabel: 'Audio name',
    };
  }
  if (opts.isLottieGen) {
    return {
      name: String(opts.name || 'Lottie Generator'),
      icon: 'lottie-generator',
      renameAriaLabel: 'Lottie name',
    };
  }
  if (key === 'lottie') {
    // Finished Lottie keeps the media play glyph; clapperboard is generator-only.
    return {
      name: String(opts.name || 'Lottie'),
      icon: 'video',
      renameAriaLabel: 'Lottie name',
    };
  }
  if (opts.isVideo || key === 'video') {
    return {
      name: String(opts.name || 'Video'),
      icon: 'video',
      renameAriaLabel: 'Video name',
    };
  }
  if (opts.isImageGen) {
    return {
      name: String(opts.name || 'Image'),
      icon: 'image-generator',
      renameAriaLabel: 'Image name',
    };
  }
  return {
    name: String(opts.name || 'Image'),
    icon: 'image',
    renameAriaLabel: 'Image name',
  };
}

export function readNodeAspectLocked(node: SceneNodeInput): boolean {
  const raw = node?.attrs?.lockAspect;
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true;
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false;
  return nodeAspectLockDefault(node?.key);
}

/** Persist lock OR Shift ??Shift adds constraint, does not toggle it off. */
export function combineAspectLock(locked: boolean, shiftKey: boolean) {
  return locked || shiftKey;
}

export function resolveLockAspect(
  document: SceneDocument,
  origins: Array<{ nodeId: string }>,
  handle: ResizeHandle | undefined,
  shiftKey: boolean
) {
  if (!handle) return shiftKey;
  if (origins.length === 1) {
    const node = document?.deltaSetLike?.[origins[0].nodeId];
    const key = node?.key;
    // Text corners: default scale; Shift temporarily unlocks for free reshape.
    if (key === 'text' && CORNER_HANDLES.has(handle)) return !shiftKey;
    return combineAspectLock(readNodeAspectLocked(node), shiftKey);
  }
  // Multi / group: lock when selection includes images/videos (unless explicitly unlocked).
  const nodes = origins
    .map(({ nodeId }) => document?.deltaSetLike?.[nodeId])
    .filter(Boolean);
  const hasExplicitUnlock = nodes.some((n) => {
    const raw = n?.attrs?.lockAspect;
    return raw === false || raw === 'false' || raw === 0 || raw === '0';
  });
  const allLocked =
    !hasExplicitUnlock &&
    nodes.some(
      (n) => n.key === 'image' || n.key === 'video' || n.key === 'lottie' || n.key === 'audio'
    )
      ? true
      : nodes.length > 0 && nodes.every((n) => readNodeAspectLocked(n));
  return combineAspectLock(allLocked, shiftKey);
}

/** Remasure text height for L/R wrap so chrome hugs wrapped lines while dragging. */
export function applyTextWrapHeight(
  document: SceneDocument,
  nodeId: string,
  box: SceneBox
): SceneBox {
  const node = document?.deltaSetLike?.[nodeId];
  if (!node || node.key !== 'text') return box;
  const style = parseNodeTextStyle(node.attrs || {});
  const plain = parseNodeText(node.attrs || {}) || ' ';
  // `box` is chrome bounds (includes TEXT_SELECTION_PAD); measure wrap on content width.
  const contentW = Math.max(24, box.width - TEXT_SELECTION_PAD * 2);
  const measured = measureWrappedTextSize(plain, style, contentW);
  return {
    ...box,
    height: Math.max(1, Math.round(measured.height) + TEXT_SELECTION_PAD * 2),
  };
}

export function normalizeBox(x0: number, y0: number, x1: number, y1: number) {
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  return {
    left,
    top,
    width: Math.max(1, Math.abs(x1 - x0)),
    height: Math.max(1, Math.abs(y1 - y0)),
  };
}

export function boxesIntersect(a: SceneBox, b: SceneBox) {
  return !(
    a.left + a.width < b.left ||
    b.left + b.width < a.left ||
    a.top + a.height < b.top ||
    b.top + b.height < a.top
  );
}

export function unionSceneBoxes(a: SceneBox, b: SceneBox): SceneBox {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  const right = Math.max(a.left + a.width, b.left + b.width);
  const bottom = Math.max(a.top + a.height, b.top + b.height);
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

export function expandSceneBox(box: SceneBox, pad: number): SceneBox {
  if (!(pad > 0)) return box;
  return {
    left: box.left - pad,
    top: box.top - pad,
    width: Math.max(1, box.width + pad * 2),
    height: Math.max(1, box.height + pad * 2),
  };
}

/**
 * Screen-constant marquee slack (px) → scene units.
 * Small brush / tiny nodes otherwise miss when the rect only grazes ink.
 */
export const MARQUEE_HIT_PAD_SCREEN_PX = 3;
/** Floor hit AABB so sub-pixel / hairline nodes stay brushable. */
export const MARQUEE_MIN_HIT_SCREEN_PX = 6;

export function marqueeHitPadScene(zoom: number): number {
  return MARQUEE_HIT_PAD_SCREEN_PX / Math.max(0.05, zoom || 1);
}

export function ensureMinScreenHitBox(box: SceneBox, zoom: number): SceneBox {
  const z = Math.max(0.05, zoom || 1);
  const min = MARQUEE_MIN_HIT_SCREEN_PX / z;
  const w = Math.max(box.width, min);
  const h = Math.max(box.height, min);
  if (w === box.width && h === box.height) return box;
  return {
    left: box.left + box.width / 2 - w / 2,
    top: box.top + box.height / 2 - h / 2,
    width: w,
    height: h,
  };
}

/** Frame AABB ??marquee ??same idea as selecting a rectangle. Locked frames are skipped. */
export function framesHittingMarquee(doc: SceneDocument, marquee: SceneBox): Array<{ id: string; area: number }> {
  const frames = Array.isArray(doc?.frames) ? doc.frames : [];
  const out: Array<{ id: string; area: number }> = [];
  for (const f of frames) {
    if (!f?.id || f.locked) continue;
    const fb: SceneBox = {
      left: Number(f.x) || 0,
      top: Number(f.y) || 0,
      width: Math.max(1, Number(f.width) || 1),
      height: Math.max(1, Number(f.height) || 1),
    };
    if (!boxesIntersect(marquee, fb)) continue;
    const ix0 = Math.max(marquee.left, fb.left);
    const iy0 = Math.max(marquee.top, fb.top);
    const ix1 = Math.min(marquee.left + marquee.width, fb.left + fb.width);
    const iy1 = Math.min(marquee.top + marquee.height, fb.top + fb.height);
    out.push({ id: String(f.id), area: Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0) });
  }
  out.sort((a, b) => b.area - a.area);
  return out;
}

/** Synthetic selection id so frames share the same union chrome / transform path as nodes. */
export function resolveInspectPrimaryId(
  selectedNodeIds: string[],
  selectedFrameIds: string[]
): string | null {
  if (selectedNodeIds.length === 1 && selectedFrameIds.length === 0) {
    return selectedNodeIds[0] ?? null;
  }
  if (selectedFrameIds.length === 1 && selectedNodeIds.length === 0) {
    return frameSelId(selectedFrameIds[0]);
  }
  return null;
}

export function isHostInjectedSelection(
  singleNode: boolean,
  singleId: string | null,
  shapeOutlines: ShapeOutlineItem[],
  opts?: { inspectDev?: boolean; node?: any; selectedFrameIds?: string[]; selectedNodeIds?: string[] }
): boolean {
  // Multi path union AABB / single frame AABB is host-mirrored (or scene self-fit).
  if (shapeOutlines.some((o) => o.unionChrome)) return true;
  if (
    opts?.selectedFrameIds?.length === 1 &&
    (!opts.selectedNodeIds || opts.selectedNodeIds.length === 0) &&
    shapeOutlines.some((o) => parseFrameSelId(o.id))
  ) {
    return true;
  }
  if (!singleNode || !singleId) return false;
  // Host already paints the path silhouette (with or without handles / aux).
  if (shapeOutlines.some((o) => o.id === singleId)) return true;
  // Inspect: never fall back to world AABB SelectionChrome for path ink.
  if (opts?.inspectDev && nodeUsesPathChrome(opts.node)) return true;
  return false;
}

/** Near-full-bleed artboard plate ??must not block marquee (looks empty but hits as a shape). */
export function frameForFullBleedPlate(doc: SceneDocument, nodeId: string): string | null {
  const node = doc?.deltaSetLike?.[nodeId];
  if (!node || node.key !== 'shape') return null;
  const shapeType = String(node.attrs?.shapeType || 'rect');
  if (shapeType !== 'rect') return null;
  const frames = Array.isArray(doc?.frames) ? doc.frames : [];
  if (!frames.length) return null;
  const { left, top } = nodeLeftTop(doc, node);
  const w = Math.max(1, Number(node.width) || 1);
  const h = Math.max(1, Number(node.height) || 1);
  const area = w * h;
  for (const f of frames) {
    if (!f?.id) continue;
    const fx = Number(f.x) || 0;
    const fy = Number(f.y) || 0;
    const fw = Math.max(1, Number(f.width) || 1);
    const fh = Math.max(1, Number(f.height) || 1);
    const frameArea = fw * fh;
    const ow = Math.max(0, Math.min(left + w, fx + fw) - Math.max(left, fx));
    const oh = Math.max(0, Math.min(top + h, fy + fh) - Math.max(top, fy));
    const overlap = ow * oh;
    if (overlap >= frameArea * 0.9 && area >= frameArea * 0.85) {
      return String(f.id);
    }
  }
  return null;
}

/** Visual AABB in scene space via mounted SVG (matches what the user sees). */
export function sceneBoxFromMountedNode(
  nodeId: string,
  toScene: (clientX: number, clientY: number) => { x: number; y: number }
): SceneBox | null {
  if (typeof document === 'undefined') return null;
  const shared = getSharedNodeEls()?.get(nodeId) as SVGGraphicsElement | undefined;
  let el: SVGGraphicsElement | null = shared || null;
  if (!el) {
    const safe =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(nodeId)
        : nodeId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    el = document.querySelector(
      `[data-scene-node-id="${safe}"]`
    ) as SVGGraphicsElement | null;
  }
  if (!el) return null;
  let r: DOMRect;
  try {
    r = el.getBoundingClientRect();
  } catch {
    return null;
  }
  if (!(r.width >= 0.5 || r.height >= 0.5)) return null;
  const a = toScene(r.left, r.top);
  const b = toScene(r.right, r.bottom);
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.max(1, Math.abs(b.x - a.x)),
    height: Math.max(1, Math.abs(b.y - a.y)),
  };
}

/** Point-in-AABB (inclusive). */
export function pointInBox(x: number, y: number, box: SceneBox, pad = 0) {
  return (
    x >= box.left - pad &&
    x <= box.left + box.width + pad &&
    y >= box.top - pad &&
    y <= box.top + box.height + pad
  );
}

/**
 * Marquee hit — match click semantics per type:
 * - rect / geo / text / image: AABB (same as click)
 * - pen / pencil / path: stroke/path sampling (click uses ink, not empty AABB gaps)
 * - line / arrow: shaft endpoints / mid
 *
 * Uses union(data, DOM) + screen-constant pad so small nodes / tight brushes
 * don't miss when ink is slightly outside the stored geom box.
 */
export function nodeHitsMarquee(
  doc: SceneDocument,
  nodeId: string,
  marquee: SceneBox,
  getNodeBox: (id: string) => SceneBox | null,
  toScene: (clientX: number, clientY: number) => { x: number; y: number },
  zoom = 1
): boolean {
  const node = doc?.deltaSetLike?.[nodeId];
  if (!node || isNodeHidden(node)) return false;
  const dataBox = getNodeBox(nodeId);
  const domBox = sceneBoxFromMountedNode(nodeId, toScene);
  let box = dataBox && domBox ? unionSceneBoxes(dataBox, domBox) : domBox || dataBox;
  if (!box) return false;
  box = ensureMinScreenHitBox(box, zoom);
  const hitMarquee = expandSceneBox(marquee, marqueeHitPadScene(zoom));
  const strokePad = 3 + marqueeHitPadScene(zoom);

  const shapeType = String(node.attrs?.shapeType || '');
  if (shapeType === 'line' || shapeType === 'arrow') {
    const ep = strokeEndpointsFromBox(box, Number(node.attrs?.angle) || 0);
    if (
      pointInBox(ep.x0, ep.y0, hitMarquee, strokePad) ||
      pointInBox(ep.x1, ep.y1, hitMarquee, strokePad)
    ) {
      return true;
    }
    const mx = (ep.x0 + ep.x1) / 2;
    const my = (ep.y0 + ep.y1) / 2;
    return pointInBox(mx, my, hitMarquee, strokePad) || boxesIntersect(hitMarquee, box);
  }

  if (shapeType === 'pen' || shapeType === 'pencil' || shapeType === 'path') {
    const d = String(node.attrs?.path || node.attrs?.d || '');
    // Filled closed path: AABB is fine (same spirit as click fill hit).
    if (shapeType !== 'pen' && supportsFill(node) && boxesIntersect(hitMarquee, box)) {
      return true;
    }
    if (d) {
      return pathStrokeHitsSceneBox(d, box, Number(node.attrs?.angle) || 0, hitMarquee, strokePad);
    }
    return boxesIntersect(hitMarquee, box);
  }

  // rect / ellipse / text / image / other geo — AABB like click.
  return boxesIntersect(hitMarquee, box);
}

/**
 * Line/arrow nodes use a tall hit AABB (`STROKE_HIT` ≈ 24). Docking the
 * floating toolbar to that slab's top puts it half a hit-height above the shaft
 * — huge on screen at high zoom. Prefer the shaft's axis-aligned outer bounds
 * (endpoint AABB) so the pill clears both knobs instead of sitting on mid-shaft
 * and covering the higher endpoint on diagonal strokes.
 */
export function toolbarBoxForSelection(
  box: SceneBox | null | undefined,
  opts: { lineChrome: boolean; node?: any }
): SceneBox | null {
  if (!box) return null;
  if (!opts.lineChrome) return box;
  const angle = Number(opts.node?.attrs?.angle) || 0;
  const ep = strokeEndpointsFromBox(box, angle);
  const minX = Math.min(ep.x0, ep.x1);
  const maxX = Math.max(ep.x0, ep.x1);
  const minY = Math.min(ep.y0, ep.y1);
  const maxY = Math.max(ep.y0, ep.y1);
  return {
    left: minX,
    top: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

export function patchesAsOrigins(
  patches: Array<{ nodeId: string; left: number; top: number; width: number; height: number }>
) {
  return patches.map((pt) => ({
    nodeId: pt.nodeId,
    box: { left: pt.left, top: pt.top, width: pt.width, height: pt.height },
  }));
}

export function multiMembersKey(origins: Array<{ nodeId: string; box: SceneBox }>): string {
  return origins
    .map((o) => {
      const b = o.box;
      return `${o.nodeId}:${b.left.toFixed(1)}:${b.top.toFixed(1)}:${b.width.toFixed(1)}:${b.height.toFixed(1)}`;
    })
    .join('|');
}

export type GeometryPatch = {
  nodeId: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Soft-click vs drag — **monitor travel**, not scene/world units.
 *
 * Equivalent check: screen-space Dist²(origin, current) > threshold
 * (same as pageDist² * zoom² > threshold when page and screen share zoom).
 *
 * 画布缩放到 1% 或 800% 时，门槛必须相同。禁止用场景距离（缩小时
 * 1 屏幕 px ≈ 很多场景单位，一点击就会“几千像素”误进框选）。
 */
export const DRAG_SCREEN_PX = 10;
export const DRAG_DISTANCE_SQUARED = DRAG_SCREEN_PX * DRAG_SCREEN_PX;
/**
 * Empty canvas → blue brush. Both gates use CSS client / screen px (not scene):
 * pointer travel since down, and marquee longer side × zoom (avoids hairline slips).
 */
export const BRUSH_SCREEN_PX = 56;
export const TOUCH_BRUSH_SCREEN_PX = 64;

export function brushScreenPx(pointerType: string): number {
  return pointerType === 'touch' ? TOUCH_BRUSH_SCREEN_PX : BRUSH_SCREEN_PX;
}

export type DragState = {
  /** pointing_canvas: empty press; marquee only after brush gate. */
  mode: 'move' | 'resize' | 'rotate' | 'marquee' | 'pointing_canvas' | 'blank';
  startX: number;
  startY: number;
  sceneX0: number;
  sceneY0: number;
  origins: Array<{ nodeId: string; box: SceneBox; angle0?: number }>;
  union: SceneBox;
  handle?: ResizeHandle;
  angle0?: number;
  aspectRatio?: number;
  center?: { x: number; y: number };
  pointerAngle0?: number;
  /**
   * Open pen/pencil/path: drag endpoint by uniform scale+rotate about the
   * opposite path end (local coords at gesture start).
   */
  pathEpLocal0?: [number, number];
  pathEpLocal1?: [number, number];
  /**
   * Composer canvas-pick gesture: attach already ran on pointerdown.
   * Skip pointerup onSelect so one-shot clearPick does not steal node selection.
   */
  skipSelectOnUp?: boolean;
  /** Visual/layout scale at pointerdown (from rcbViewportMetrics). */
  scaleX?: number;
  scaleY?: number;
  /**
   * Continuously updated from pointerdown/move.
   * End events (up/cancel) must not supply geometry — their clientX/Y can be 0,0.
   */
  currentClientX: number;
  currentClientY: number;
  currentShift?: boolean;
};

/** Shared seed for blank / pointing_canvas / move / resize / rotate drags. */
export function makeDragSeed(
  mode: DragState['mode'],
  e: { clientX: number; clientY: number },
  p: { x: number; y: number },
  extras?: Partial<DragState>,
  viewport?: HTMLElement | null
): DragState {
  const m = viewport ? rcbViewportMetrics(viewport) : null;
  return {
    mode,
    startX: e.clientX,
    startY: e.clientY,
    sceneX0: p.x,
    sceneY0: p.y,
    scaleX: m?.scaleX ?? 1,
    scaleY: m?.scaleY ?? 1,
    currentClientX: e.clientX,
    currentClientY: e.clientY,
    origins: [],
    union: { left: p.x, top: p.y, width: 1, height: 1 },
    ...extras,
  };
}

/** Scene point / delta from pointerdown — stable if stage rect jitters mid-gesture. */
export function sceneFromClientGesture(
  drag: Pick<DragState, 'sceneX0' | 'sceneY0' | 'startX' | 'startY' | 'scaleX' | 'scaleY'>,
  zoom: number,
  clientX: number,
  clientY: number
) {
  const d = rcbClientDeltaToScene(
    zoom,
    clientX - drag.startX,
    clientY - drag.startY,
    drag.scaleX ?? 1,
    drag.scaleY ?? 1
  );
  return { x: drag.sceneX0 + d.x, y: drag.sceneY0 + d.y, dx: d.x, dy: d.y };
}

/** Raw CSS client travel² since pointerdown (no layout-scale ÷, no scene/zoom). */
export function screenDragDistSq(
  drag: Pick<DragState, 'startX' | 'startY'>,
  clientX: number,
  clientY: number
): number {
  const dx = clientX - drag.startX;
  const dy = clientY - drag.startY;
  return dx * dx + dy * dy;
}

/** Dual brush gate: pointer travel + on-screen marquee size. */
export function evaluateBrushGate(
  drag: Pick<DragState, 'startX' | 'startY' | 'sceneX0' | 'sceneY0' | 'scaleX' | 'scaleY'>,
  zoom: number,
  clientX: number,
  clientY: number,
  pointerType: string
): { passed: boolean; box: SceneBox } {
  const brushPx = brushScreenPx(pointerType);
  const gesture = sceneFromClientGesture(drag, zoom, clientX, clientY);
  const box = normalizeBox(drag.sceneX0, drag.sceneY0, gesture.x, gesture.y);
  const z = Math.max(0.05, zoom || 1);
  const screenLong = Math.max(box.width, box.height) * z;
  const passed =
    screenDragDistSq(drag, clientX, clientY) >= brushPx * brushPx && screenLong >= brushPx;
  return { passed, box };
}

export function softSelectFrameAt(
  toScene: (clientX: number, clientY: number) => { x: number; y: number },
  hitTestFrame: ((x: number, y: number) => string | null) | undefined,
  onSelectFrame: ((frameId: string | null) => void) | undefined,
  clientX: number,
  clientY: number
) {
  const abs = toScene(clientX, clientY);
  const frameId = hitTestFrame?.(abs.x, abs.y);
  if (frameId) onSelectFrame?.(frameId);
}

export function isSelectionOriginsLocked(
  document: SceneDocument,
  origins: Array<{ nodeId: string }> | null | undefined
): boolean {
  if (!origins?.length) return false;
  const frames = Array.isArray(document?.frames) ? document.frames : [];
  return origins.some((o) => {
    const fid = parseFrameSelId(o.nodeId);
    if (fid) return Boolean(frames.find((x: any) => x?.id === fid)?.locked);
    return isNodeLocked(document?.deltaSetLike?.[o.nodeId]);
  });
}

export function isRecentNodeDoubleTap(
  prev: { id: string; t: number; x: number; y: number } | null,
  hitId: string,
  e: { clientX: number; clientY: number },
  ms = 400,
  distPx = 10
): boolean {
  if (!prev || prev.id !== hitId) return false;
  return Date.now() - prev.t < ms && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < distPx;
}

export function buildMoveOriginsForHit(opts: {
  document: SceneDocument;
  hitId: string;
  selectedIds: string[];
  expandedHit: string[];
  liveOriginsNow: Array<{ nodeId: string; box: SceneBox }> | null | undefined;
  /** Current control box — keep oriented multi chrome instead of local AABB union. */
  liveUnionNow?: SceneBox | null;
  liveAngleNow?: number;
  getNodeBox: (id: string) => SceneBox | null | undefined;
  fallbackPoint: { x: number; y: number };
}): { origins: Array<{ nodeId: string; box: SceneBox }>; union: SceneBox } {
  const {
    document,
    hitId,
    selectedIds,
    expandedHit,
    liveOriginsNow,
    liveUnionNow,
    liveAngleNow,
    getNodeBox,
    fallbackPoint,
  } = opts;
  const moveNodeIds = expandSelectionWithGroups(
    document,
    selectedIds.includes(hitId) ? selectedIds.filter((id) => !parseFrameSelId(id)) : expandedHit
  );
  const frameOrigins =
    selectedIds.includes(hitId) && liveOriginsNow
      ? liveOriginsNow.filter((o) => parseFrameSelId(o.nodeId))
      : [];
  const origins = [
    ...moveNodeIds
      .map((id) => {
        const box = liveOriginsNow?.find((o) => o.nodeId === id)?.box || getNodeBox(id);
        return box ? { nodeId: id, box: { ...box } } : null;
      })
      .filter(Boolean),
    ...frameOrigins.map((o) => ({ nodeId: o.nodeId, box: { ...o.box } })),
  ] as Array<{ nodeId: string; box: SceneBox }>;
  if (!origins.length) {
    return {
      origins,
      union: {
        left: fallbackPoint.x,
        top: fallbackPoint.y,
        width: 1,
        height: 1,
      },
    };
  }
  return {
    origins,
    union: resolveControlChrome(document, origins, liveUnionNow, liveAngleNow).box,
  };
}

export function filterMarqueeContentHits(document: SceneDocument, rawHits: string[], frameHitSet: Set<string>) {
  return rawHits.filter((id) => {
    const plateFrame = frameForFullBleedPlate(document, id);
    if (!plateFrame) return true;
    if (frameHitSet.has(plateFrame)) return true;
    return rawHits.some((other) => other !== id && !frameForFullBleedPlate(document, other));
  });
}

export function commitMarqueeSelection(opts: {
  contentHits: string[];
  frameHits: string[];
  rawHits: string[];
  shiftKey: boolean;
  onSelectMixed?: (
    nodeIds: string[],
    frameIds: string[],
    opts?: { additive?: boolean }
  ) => void;
  onSelectFrames?: (ids: string[]) => void;
  onSelectFrame?: (id: string | null) => void;
  onSelect: (ids: string[], opts?: { additive?: boolean }) => void;
}) {
  const {
    contentHits,
    frameHits,
    rawHits,
    shiftKey,
    onSelectMixed,
    onSelectFrames,
    onSelectFrame,
    onSelect,
  } = opts;
  if (!contentHits.length && !frameHits.length) {
    onSelect(rawHits, { additive: shiftKey });
    return;
  }
  if (onSelectMixed) {
    onSelectMixed(contentHits, frameHits, { additive: shiftKey });
    return;
  }
  if (frameHits.length && !contentHits.length) {
    if (onSelectFrames) onSelectFrames(frameHits);
    else if (onSelectFrame) onSelectFrame(frameHits[0]);
    return;
  }
  onSelect(contentHits.length ? contentHits : rawHits, { additive: shiftKey });
}

export type MoveSnapContext = {
  union: SceneBox;
  /** Chrome boxes at drag start — deflated to path for smart snap. */
  origins: Array<{ nodeId: string; box: SceneBox }>;
  document: SceneDocument;
  dx: number;
  dy: number;
  disableSnap: boolean;
  gridSize: number;
  targets: SceneBox[];
  threshold: number;
};

/**
 * Guide / move-snap box = **painted outer ink** (path + visual outset).
 * Draw stores path at ±sw/2 so ink sits on the integer grid; snapping the
 * path itself to the grid yanked ink off-cell. Control box stays on path
 * (`strokeChromeOutset` === 0) — not the same box as move-snap.
 */
export function visualGuideBoxForNode(
  id: string,
  document: SceneDocument,
  chrome: SceneBox | null | undefined
): SceneBox | null {
  if (!chrome) return null;
  if (parseFrameSelId(id)) return { ...chrome };
  const live = liveShapeGeomBox(id);
  const path = live || deflateSelectionBox({ ...chrome }, document?.deltaSetLike?.[id]);
  return inflateBoxByVisualOutset(path, document?.deltaSetLike?.[id]);
}

export function visualBoxFromChromeOrigin(
  document: SceneDocument,
  o: { nodeId: string; box: SceneBox }
): SceneBox {
  if (parseFrameSelId(o.nodeId)) return { ...o.box };
  const path = deflateSelectionBox({ ...o.box }, document?.deltaSetLike?.[o.nodeId]);
  return inflateBoxByVisualOutset(path, document?.deltaSetLike?.[o.nodeId]);
}

export function computeMovedUnion(ctx: MoveSnapContext): {
  nextUnion: SceneBox;
  sdx: number;
  sdy: number;
  guides: SmartGuideLine[];
} {
  // Snap **painted outer ink** in 1px steps, then apply the same delta to path.
  // Never fall back to path/chrome as "visual" — that reintroduces half-cell drift.
  const visualBoxes = ctx.origins.map((o) => visualBoxFromChromeOrigin(ctx.document, o));
  const visualUnion = unionOfBoxes(visualBoxes);
  if (!visualUnion) {
    return {
      nextUnion: {
        ...ctx.union,
        left: ctx.union.left + ctx.dx,
        top: ctx.union.top + ctx.dy,
      },
      sdx: ctx.dx,
      sdy: ctx.dy,
      guides: [],
    };
  }
  let nextVisual = {
    ...visualUnion,
    left: visualUnion.left + ctx.dx,
    top: visualUnion.top + ctx.dy,
  };
  let guides: SmartGuideLine[] = [];
  if (!ctx.disableSnap) {
    // Object magnets ≠ grid. Smart first; lattice only on axes smart did not pin
    // (otherwise odd-size center-align is yanked off by snapBoxToGrid).
    let smartX = false;
    let smartY = false;
    if (ctx.threshold > 0 && ctx.targets.length) {
      const smart = snapMoveToSmartGuides({
        box: nextVisual,
        targets: ctx.targets,
        threshold: ctx.threshold,
      });
      nextVisual = smart.box;
      guides = smart.guides;
      smartX = smart.snappedX;
      smartY = smart.snappedY;
    }
    if (ctx.gridSize > 0) {
      const pinned = snapBoxToGrid(nextVisual, ctx.gridSize);
      nextVisual = {
        ...nextVisual,
        left: smartX ? nextVisual.left : pinned.left,
        top: smartY ? nextVisual.top : pinned.top,
      };
      // After lattice pin, re-collect align-only indicators (no free gaps).
      guides = collectMoveSnapIndicators(nextVisual, ctx.targets, GUIDE_COINCIDE_EPS);
    }
  }
  const sdx = nextVisual.left - visualUnion.left;
  const sdy = nextVisual.top - visualUnion.top;
  if (typeof window !== 'undefined' && (window as any).__RCB_MOVE_GRID_DEBUG__ === true) {
    // eslint-disable-next-line no-console
    console.log('[rcb:move-grid]', {
      dx: ctx.dx,
      dy: ctx.dy,
      gridSize: ctx.gridSize,
      visual0: visualUnion,
      visual1: nextVisual,
      path0: ctx.union,
      sdx,
      sdy,
      onGrid:
        Math.abs(nextVisual.left - Math.round(nextVisual.left / ctx.gridSize) * ctx.gridSize) <
          1e-9 &&
        Math.abs(nextVisual.top - Math.round(nextVisual.top / ctx.gridSize) * ctx.gridSize) < 1e-9,
    });
  }
  return {
    nextUnion: {
      ...ctx.union,
      left: ctx.union.left + sdx,
      top: ctx.union.top + sdy,
    },
    sdx,
    sdy,
    guides,
  };
}

export type ResizeSnapContext = {
  document: SceneDocument;
  drag: DragState;
  dx: number;
  dy: number;
  shiftKey: boolean;
  disableSnap: boolean;
  gridSize: number;
  targets: SceneBox[];
  threshold: number;
};

export function computeResizedUnion(ctx: ResizeSnapContext): {
  next: SceneBox;
  textMode: TextResizeMode | undefined;
  lockAspect: boolean;
  guides: SmartGuideLine[];
} {
  const handle = ctx.drag.handle!;
  const lockAspect = resolveLockAspect(ctx.document, ctx.drag.origins, handle, ctx.shiftKey);
  let next = resizeFromHandle(ctx.drag.union, handle, ctx.dx, ctx.dy, ctx.drag.angle0 || 0, {
    lockAspect,
    aspectRatio: ctx.drag.aspectRatio,
  });
  let guides: SmartGuideLine[] = [];
  const singleId = ctx.drag.origins.length === 1 ? ctx.drag.origins[0].nodeId : null;
  const singleNode = singleId ? ctx.document?.deltaSetLike?.[singleId] : null;
  const snapAsPath = Boolean(singleId && !parseFrameSelId(singleId));
  if (!ctx.disableSnap) {
    // Resize painted outer ink: smart align (capped) then grid — same as move.
    // Guides always reflect the settled box (gaps + coincides), never cleared
    // by a "would have snapped" display probe.
    if (snapAsPath && singleNode) {
      const path0 = deflateSelectionBox({ ...next }, singleNode);
      const visual0 = inflateBoxByVisualOutset(path0, singleNode);
      let visualNext = visual0;
      if (ctx.threshold > 0 && ctx.targets.length) {
        visualNext = snapResizeToSmartGuides({
          box: visualNext,
          handle,
          targets: ctx.targets,
          threshold: ctx.threshold,
          min: Math.max(8, Math.ceil(strokeVisualOutset(singleNode) * 2) + 1),
        }).box;
      }
      if (ctx.gridSize > 0) {
        visualNext = snapResizeToGrid(visualNext, handle, ctx.gridSize, 8, {
          lockAspect,
          aspectRatio: ctx.drag.aspectRatio,
        });
      }
      const outset = Math.max(0, strokeVisualOutset(singleNode));
      const pathNext = {
        left: visualNext.left + outset,
        top: visualNext.top + outset,
        width: Math.max(1, visualNext.width - outset * 2),
        height: Math.max(1, visualNext.height - outset * 2),
      };
      guides = collectMoveSnapIndicators(visualNext, ctx.targets, GUIDE_COINCIDE_EPS);
      next = inflateSelectionBox(pathNext, singleNode);
    } else {
      if (ctx.threshold > 0 && ctx.targets.length) {
        next = snapResizeToSmartGuides({
          box: next,
          handle,
          targets: ctx.targets,
          threshold: ctx.threshold,
          min: 8,
        }).box;
      }
      if (ctx.gridSize > 0) {
        next = snapResizeToGrid(next, handle, ctx.gridSize, 8, {
          lockAspect,
          aspectRatio: ctx.drag.aspectRatio,
        });
      }
      guides = collectMoveSnapIndicators(next, ctx.targets, GUIDE_COINCIDE_EPS);
    }
  }
  next = {
    ...next,
    width: Math.max(1, next.width),
    height: Math.max(1, next.height),
  };
  if (ctx.drag.origins.length === 1) {
    next = applyTextWrapHeight(ctx.document, ctx.drag.origins[0].nodeId, next);
  }
  const textMode =
    ctx.drag.origins.length === 1 &&
    String(ctx.document?.deltaSetLike?.[ctx.drag.origins[0].nodeId]?.key || '') === 'text'
      ? textResizeModeForHandle(handle)
      : undefined;
  return { next, textMode, lockAspect, guides };
}

/** Sibling **visual-outer** AABBs for smart guides (exclude selection + hidden/locked). */
export function collectSmartGuideTargets(
  document: SceneDocument,
  listNodeIds: () => readonly string[],
  getNodeBox: (id: string) => SceneBox | null,
  excludeIds: Set<string>,
  opts?: {
    nearBox?: SceneBox | null;
    pad?: number;
    queryNodeIdsInRect?: (box: SceneBox) => string[];
  }
): SceneBox[] {
  let ids = listNodeIds();
  const near = opts?.nearBox;
  const query = opts?.queryNodeIdsInRect;
  const pad = Math.max(0, opts?.pad ?? 0);
  if (near && query && near.width > 0 && near.height > 0) {
    const nearby = query({
      left: near.left - pad,
      top: near.top - pad,
      width: near.width + pad * 2,
      height: near.height + pad * 2,
    });
    if (nearby.length) {
      ids = nearby;
    } else if (ids.length >= 48) {
      // Large warm scenes: empty spatial hit means no neighbors — never O(N) scan.
      ids = [];
    }
  }
  const out: SceneBox[] = [];
  for (const id of ids) {
    if (excludeIds.has(id)) continue;
    const node = document?.deltaSetLike?.[id];
    if (!node || isNodeHidden(node) || isNodeLocked(node)) continue;
    const box = visualGuideBoxForNode(id, document, getNodeBox(id));
    if (box && box.width > 0 && box.height > 0) out.push(box);
  }
  // Artboards share the same AABB magnets — they just live on `document.frames`
  // instead of deltaSetLike / listNodeIds.
  const frames = Array.isArray(document?.frames) ? document.frames : [];
  for (const f of frames) {
    if (!f?.id || f.locked) continue;
    const fid = String(f.id);
    if (excludeIds.has(fid) || excludeIds.has(frameSelId(fid))) continue;
    const left = Number(f.x) || 0;
    const top = Number(f.y) || 0;
    const width = Math.max(1, Number(f.width) || 1);
    const height = Math.max(1, Number(f.height) || 1);
    if (near && near.width > 0 && near.height > 0) {
      const nl = near.left - pad;
      const nt = near.top - pad;
      const nr = near.left + near.width + pad;
      const nb = near.top + near.height + pad;
      if (left + width < nl || left > nr || top + height < nt || top > nb) continue;
    }
    out.push({ left, top, width, height });
  }
  return out;
}

export function smartGuideTargetsForDrag(opts: {
  document: SceneDocument;
  listNodeIds: () => readonly string[];
  getNodeBox: (id: string) => SceneBox | null;
  excludeIds: Set<string>;
  nearBox: SceneBox;
  threshold: number;
  queryNodeIdsInRect?: (box: SceneBox) => string[];
}): SceneBox[] {
  return collectSmartGuideTargets(
    opts.document,
    opts.listNodeIds,
    opts.getNodeBox,
    opts.excludeIds,
    {
      nearBox: opts.nearBox,
      pad: smartGuideTargetPad(opts.threshold),
      queryNodeIdsInRect: opts.queryNodeIdsInRect,
    }
  );
}

export function computeRotateDelta(
  drag: DragState,
  p: { x: number; y: number },
  shiftKey: boolean
): { next: number; delta: number } {
  const now = (Math.atan2(p.y - drag.center!.y, p.x - drag.center!.x) * 180) / Math.PI;
  let next = (drag.angle0 || 0) + (now - drag.pointerAngle0!);
  if (shiftKey) next = Math.round(next / 15) * 15;
  return { next, delta: next - (drag.angle0 || 0) };
}

export function strokeEndpointBox(
  drag: DragState,
  document: SceneDocument,
  sceneX: number,
  sceneY: number
): { next: SceneBox; angle: number; strokeId: string } | null {
  const strokeId = drag.origins.length === 1 ? drag.origins[0].nodeId : '';
  if (!strokeId || !drag.handle) return null;
  if (drag.handle !== 'e' && drag.handle !== 'w') return null;
  const shapeType = readNodeShapeType(document, strokeId);

  // Open pen/pencil/path: scale+rotate about the opposite path endpoint so the
  // grabbed tip follows the pointer (AABB edge resize would miss the tip).
  if (
    drag.pathEpLocal0 &&
    drag.pathEpLocal1 &&
    (shapeType === 'pen' || shapeType === 'pencil' || shapeType === 'path')
  ) {
    const placed = resizeOpenPathByEndpoint(
      drag.union,
      drag.angle0 || 0,
      drag.pathEpLocal0,
      drag.pathEpLocal1,
      drag.handle,
      sceneX,
      sceneY
    );
    if (!placed) return null;
    return { strokeId, angle: placed.angle, next: placed.box };
  }

  if (!isStrokeShapeType(shapeType)) return null;
  const placed = resizeStrokeByEndpoint(drag.union, drag.angle0 || 0, drag.handle, sceneX, sceneY);
  return {
    strokeId,
    angle: placed.angle,
    next: { left: placed.x, top: placed.y, width: placed.width, height: placed.height },
  };
}

/**
 * Uniform scale + rotate about the fixed path end so the free end tracks the pointer.
 * Path local coords scale with the box (same as live geometry preview).
 */
export function resizeOpenPathByEndpoint(
  box: SceneBox,
  angleDeg: number,
  ep0: [number, number],
  ep1: [number, number],
  handle: 'e' | 'w',
  pointerX: number,
  pointerY: number
): { box: SceneBox; angle: number } | null {
  const freeLocal = handle === 'w' ? ep0 : ep1;
  const fixedLocal = handle === 'w' ? ep1 : ep0;
  const fixedW = localPointToWorld(fixedLocal[0], fixedLocal[1], box, angleDeg);
  const free0W = localPointToWorld(freeLocal[0], freeLocal[1], box, angleDeg);
  const len0 = Math.hypot(free0W.x - fixedW.x, free0W.y - fixedW.y);
  if (!(len0 > 1e-4)) return null;
  const len1 = Math.hypot(pointerX - fixedW.x, pointerY - fixedW.y);
  const scale = Math.max(0.05, len1 / len0);
  const a0 = Math.atan2(free0W.y - fixedW.y, free0W.x - fixedW.x);
  const a1 = Math.atan2(pointerY - fixedW.y, pointerX - fixedW.x);
  const newAngle = angleDeg + ((a1 - a0) * 180) / Math.PI;
  const newW = Math.max(1, box.width * scale);
  const newH = Math.max(1, box.height * scale);
  // Path scales from local origin with the box — fixed/free locals scale too.
  const fixedLocal2: [number, number] = [fixedLocal[0] * scale, fixedLocal[1] * scale];
  const next = boxFromLocalAnchor(
    fixedLocal2[0],
    fixedLocal2[1],
    fixedW.x,
    fixedW.y,
    newW,
    newH,
    newAngle
  );
  return { box: next, angle: Number(newAngle.toFixed(2)) };
}

export function readNodeAngle(document: SceneDocument, nodeId: string) {
  const node = document?.deltaSetLike?.[nodeId];
  const n = Number(node?.attrs?.angle);
  return Number.isFinite(n) ? n : 0;
}

export function readNodeShapeType(document: SceneDocument, nodeId: string) {
  return String(document?.deltaSetLike?.[nodeId]?.attrs?.shapeType || '');
}

export function isStrokeShapeType(t: string) {
  return t === 'line' || t === 'arrow';
}

/** Live angle while rotating / free-angle stroke resize; otherwise stored attrs. */
export function resolveChromeAngle(opts: {
  enabled: boolean;
  singleNode: boolean;
  /** Multi-select: shared member angle (0 when angles differ). */
  multiSelected: boolean;
  selectedNodeId: string | undefined;
  document: SceneDocument;
  transforming: boolean;
  dragMode: string | undefined;
  hasPathEndpoints: boolean;
  liveAngle: number;
}): number {
  if (!opts.enabled) return 0;
  if (opts.multiSelected) return opts.liveAngle;
  if (!opts.singleNode || !opts.selectedNodeId) return 0;
  const fromDoc = readNodeAngle(opts.document, opts.selectedNodeId);
  if (!opts.transforming) return fromDoc;
  if (opts.dragMode === 'rotate') return opts.liveAngle;
  if (
    opts.dragMode === 'resize' &&
    isStrokeShapeType(readNodeShapeType(opts.document, opts.selectedNodeId))
  ) {
    return opts.liveAngle;
  }
  if (opts.dragMode === 'resize' && opts.hasPathEndpoints) {
    return opts.liveAngle;
  }
  // Move / box-resize: always use stored angle — avoids click flash when liveAngle lags at 0.
  return fromDoc;
}

/** Share / Dev inspect spacing pair: live hover first, then sticky prior selection. */
export function resolveMeasurePairNodeId(opts: {
  inspectDev: boolean;
  transforming: boolean;
  hoverNodeId: string | null;
  inspectPairNodeId: string | null;
  inspectPrimaryId: string | null;
  selectedNodeIds: string[];
}): string | null {
  // Design edit: no preview-style select↔hover measure / orange pair chrome.
  if (!opts.inspectDev || opts.transforming || !opts.inspectPrimaryId) return null;
  if (
    opts.hoverNodeId &&
    opts.hoverNodeId !== opts.inspectPrimaryId &&
    !opts.selectedNodeIds.includes(opts.hoverNodeId)
  ) {
    return opts.hoverNodeId;
  }
  if (
    opts.inspectPairNodeId &&
    opts.inspectPairNodeId !== opts.inspectPrimaryId &&
    !opts.selectedNodeIds.includes(opts.inspectPairNodeId)
  ) {
    return opts.inspectPairNodeId;
  }
  return null;
}

/** Resolve node or `__frame__:` synthetic id to a scene AABB. */
export function resolveMeasureBox(
  selId: string | null | undefined,
  document: SceneDocument,
  getNodeBox: (id: string) => SceneBox | null
): SceneBox | null {
  if (!selId) return null;
  const frameId = parseFrameSelId(selId);
  if (frameId) {
    const frames = Array.isArray(document?.frames) ? document.frames : [];
    const frame = frames.find((f: any) => f && String(f.id) === String(frameId));
    if (!frame) return null;
    const left = Number(frame.x) || 0;
    const top = Number(frame.y) || 0;
    const width = Math.max(1, Number(frame.width) || 1);
    const height = Math.max(1, Number(frame.height) || 1);
    return { left, top, width, height };
  }
  return getNodeBox(selId);
}

export function deflateChromeBox(chrome: SceneBox | null | undefined, node: SceneNodeInput): SceneBox | null {
  return chrome ? deflateSelectionBox(chrome, node) : null;
}

export function resolveTransformHostGuideBox(
  sid: string,
  sn: any,
  getNodeBox: (id: string) => SceneBox | null,
  liveOrigins: Array<{ nodeId: string; box: SceneBox }> | null | undefined
): SceneBox | null {
  const hostGeom = liveShapeGeomBox(sid);
  if (hostGeom) return hostGeom;
  const liveChrome = liveOrigins?.find((o) => o.nodeId === sid)?.box;
  const fromLive = deflateChromeBox(liveChrome, sn);
  if (fromLive) return fromLive;
  return deflateChromeBox(getNodeBox(sid), sn);
}

/** Host path silhouette / handles / transform spacing aux for vector nodes. */
export function buildShapeOutlines(opts: {
  enabled: boolean;
  suppressChrome: boolean;
  readOnly: boolean;
  document: SceneDocument;
  selectedNodeIds: string[];
  selectedFrameIds: string[];
  hoverNodeId: string | null;
  inspectDev: boolean;
  transforming: boolean;
  inspectPrimaryId: string | null;
  inspectPairNodeId: string | null;
  singleId: string | null;
  chromeAngle: number;
  selectedIsImageGen: boolean;
  selectedIsVideoGen: boolean;
  selectedIsLottieGen?: boolean;
  liveOrigins: Array<{ nodeId: string; box: SceneBox }> | null | undefined;
  /** Oriented multi-select control box (session); falls back to member AABB union. */
  multiUnionBox?: SceneBox | null;
  multiUnionAngle?: number;
  getNodeBox: (id: string) => SceneBox | null;
}): ShapeOutlineItem[] {
  if (!opts.enabled || opts.suppressChrome) return [];

  const ids: string[] = [];
  const handleIds = new Set<string>();
  /** Geom box override while dragging (host live origin). */
  const hostGuideBoxById = new Map<string, SceneBox>();
  /** Single: host silhouettes + handles. Multi path: silhouettes + host-mirrored union box. */
  const hostHandlesOk =
    !opts.readOnly &&
    opts.selectedNodeIds.length === 1 &&
    opts.selectedFrameIds.length === 0;

  const pushId = (id: string | null | undefined) => {
    if (!id || parseFrameSelId(id) || ids.includes(id)) return;
    ids.push(id);
  };

  const measurePairId = resolveMeasurePairNodeId({
    inspectDev: opts.inspectDev,
    transforming: opts.transforming,
    hoverNodeId: opts.hoverNodeId,
    inspectPairNodeId: opts.inspectPairNodeId,
    inspectPrimaryId: opts.inspectPrimaryId,
    selectedNodeIds: opts.selectedNodeIds,
  });

  // Inspect measure-pair silhouette (orange + spacing).
  if (!opts.transforming && measurePairId) {
    pushId(measurePairId);
  } else if (
    // Edit: light blue hover outline only — no spacing pair chrome.
    !opts.inspectDev &&
    !opts.transforming &&
    opts.hoverNodeId &&
    !opts.selectedNodeIds.includes(opts.hoverNodeId)
  ) {
    pushId(opts.hoverNodeId);
  }

  // Inspect select: path silhouette only (spacing drawn via SmartGuidesOverlay).
  if (
    opts.inspectDev &&
    !opts.transforming &&
    opts.inspectPrimaryId &&
    !parseFrameSelId(opts.inspectPrimaryId) &&
    nodeUsesPathChrome(opts.document?.deltaSetLike?.[opts.inspectPrimaryId])
  ) {
    pushId(opts.inspectPrimaryId);
  }

  // Edit idle: selected path chrome + handles (single).
  if (!opts.inspectDev && !opts.transforming) {
    for (const sid of opts.selectedNodeIds) {
      const sn = opts.document?.deltaSetLike?.[sid];
      if (!nodeUsesPathChrome(sn)) continue;
      pushId(sid);
      // Single: host handles. Multi path: host-mirrored union chrome (below).
      // Generators keep the blue box but no resize knobs (same as SelectionChrome).
      if (hostHandlesOk) handleIds.add(sid);
    }
  }

  // Transform: keep mover path chrome mounted (geometry live-updates with drag).
  if (
    !opts.inspectDev &&
    opts.transforming &&
    opts.selectedNodeIds.length === 1 &&
    opts.selectedFrameIds.length === 0
  ) {
    const sid = opts.selectedNodeIds[0];
    const sn = sid ? opts.document?.deltaSetLike?.[sid] : null;
    if (sid && nodeUsesPathChrome(sn)) {
      pushId(sid);
      const anchorBox = resolveTransformHostGuideBox(sid, sn, opts.getNodeBox, opts.liveOrigins);
      if (anchorBox) hostGuideBoxById.set(sid, anchorBox);
    }
  }

  const out: ShapeOutlineItem[] = [];
  for (const id of ids) {
    const node = opts.document?.deltaSetLike?.[id];
    if (!nodeUsesPathChrome(node)) continue;
    const liveChrome =
      opts.transforming && opts.liveOrigins
        ? opts.liveOrigins.find((o) => o.nodeId === id)?.box
        : null;
    const chromeBox = liveChrome || opts.getNodeBox(id);
    if (!chromeBox) continue;
    const geomBox =
      hostGuideBoxById.get(id) ||
      (liveChrome
        ? deflateSelectionBox(liveChrome, node)
        : liveShapeGeomBox(id) || deflateSelectionBox(chromeBox, node));
    const gw = Math.max(1, geomBox.width);
    const gh = Math.max(1, geomBox.height);
    const pathD = resolveOutlinePathD(node, gw, gh);
    if (!pathD) continue;
    rememberNodePath2D(id, pathD);
    const angle = id === opts.singleId ? opts.chromeAngle : readNodeAngle(opts.document, id);
    const lineMode = nodeUsesOpenStrokeEndpoints(node);
    const shapeType = String(node.attrs?.shapeType || '');
    const shaftEndpoints = shapeType === 'line' || shapeType === 'arrow';
    const withHandles = handleIds.has(id);
    const nodeKey = String(node.key || '');
    const isGen =
      isImageGeneratorNode(node) ||
      isVideoGeneratorNode(node) ||
      isLottieGeneratorNode(node) ||
      isAudioGeneratorNode(node);
    const edgeHandles: 'all' | 'horizontal' | 'none' = isGen
      ? 'none'
      : nodeKey === 'video'
        ? 'horizontal'
        : 'all';
    const isMeasurePair =
      Boolean(measurePairId) && id === measurePairId && !opts.selectedNodeIds.includes(id);
    out.push({
      id,
      pathD,
      box: geomBox,
      angle,
      color: isMeasurePair ? SMART_GUIDE_COLOR : '#3388ff',
      withHandles,
      // Selected with handles: control box only (no blue path silhouette).
      // Hover / inspect / generator (box via handles+edge none) still show path when no knobs path.
      // Generators: withHandles + edge none → blue AABB box on host (no knobs).
      showPath: !withHandles && !opts.transforming,
      lineMode,
      shaftEndpoints,
      edgeHandles,
      chromeOutset: Math.max(0, strokeChromeOutset(node)),
      showRotate:
        withHandles &&
        !lineMode &&
        !isGen &&
        !opts.selectedIsImageGen &&
        !opts.selectedIsVideoGen &&
        !opts.selectedIsLottieGen &&
        edgeHandles === 'all',
    });
  }

  // Single artboard frame: AABB chrome mirroring the SVG frame host
  // (same method as generators / rects — plate + title are world-layer SVG).
  if (
    !opts.inspectDev &&
    !opts.transforming &&
    opts.selectedFrameIds.length === 1 &&
    opts.selectedNodeIds.length === 0
  ) {
    const fid = opts.selectedFrameIds[0];
    const frames = Array.isArray(opts.document?.frames) ? opts.document.frames : [];
    const frame = frames.find((f: any) => f && String(f.id) === String(fid));
    if (frame) {
      const left = Number(frame.x) || 0;
      const top = Number(frame.y) || 0;
      const width = Math.max(1, Number(frame.width) || 1);
      const height = Math.max(1, Number(frame.height) || 1);
      out.push({
        id: frameSelId(fid),
        mirrorHostId: String(fid),
        pathD: '',
        box: { left, top, width, height },
        angle: 0,
        color: '#3388ff',
        withHandles: !opts.readOnly,
        showPath: false,
        unionChrome: true,
        cornerHandlesOnly: false,
        showRotate: false,
        edgeHandles: 'all',
      });
    }
  }

  // Multi path-only: oriented union box + corner handles via host-mirrored chrome
  // (same method as single — world SelectionChrome drifts at high zoom).
  const multiPathOnly =
    !opts.inspectDev &&
    !opts.readOnly &&
    opts.selectedFrameIds.length === 0 &&
    opts.selectedNodeIds.length > 1 &&
    opts.selectedNodeIds.every((id) => nodeUsesPathChrome(opts.document?.deltaSetLike?.[id]));
  if (multiPathOnly) {
    let union = opts.multiUnionBox || null;
    if (!union) {
      const memberBoxes: SceneBox[] = [];
      for (const id of opts.selectedNodeIds) {
        const node = opts.document?.deltaSetLike?.[id];
        const live = liveShapeGeomBox(id);
        const fallback = opts.getNodeBox(id);
        const geom =
          live || (fallback ? deflateSelectionBox(fallback, node) : null);
        if (geom) memberBoxes.push(inflateSelectionBox(geom, node));
      }
      union = unionOfBoxes(memberBoxes);
    }
    if (union) {
      out.push({
        id: '__rcb_sel_union__',
        mirrorHostId: opts.selectedNodeIds[0],
        pathD: '',
        box: union,
        angle: Number(opts.multiUnionAngle) || 0,
        color: '#3388ff',
        // Keep the control box mounted while rotating (handles-key draws the stroke).
        withHandles: true,
        showPath: false,
        unionChrome: true,
        cornerHandlesOnly: true,
        // Same multi-rotate as world chrome (orbit about union center).
        showRotate: !opts.transforming,
      });
    }
  }

  return out;
}

/** Scene pad beyond chrome to outer stroke ink (center → sw/2 outside the box). */
export function resolveToolbarEdgePadScene(node: SceneNodeInput): number {
  if (!node) return 0;
  const visual = strokeVisualOutset(node);
  const chrome = Math.max(0, strokeChromeOutset(node));
  return Math.max(0, visual - chrome);
}

/**
 * Idle selection bounds update in the same paint as Redux; liveUnion lags one
 * effect tick and used to flash empty chrome when switching frames in preview.
 */
export function resolveChromeUnion(opts: {
  transforming: boolean;
  liveUnion: SceneBox | null;
  selectionUnion: SceneBox | null;
  selectedNodeIds: string[];
  selectedFrameIds: string[];
  document: SceneDocument;
  /** Multi session group angle — keep oriented liveUnion, do not swap in AABB. */
  multiGroupAngle?: number;
}): SceneBox | null {
  // Oriented multi control box (or any in-flight transform) uses liveUnion as-is.
  if (opts.transforming) return opts.liveUnion;
  if (
    opts.selectedNodeIds.length > 1 &&
    Math.abs(Number(opts.multiGroupAngle) || 0) > 0.01
  ) {
    return opts.liveUnion || opts.selectionUnion;
  }
  const base = opts.selectionUnion;
  if (!base) return opts.liveUnion;
  // Prefer live host → path chrome (single + multi) so the box tracks remounts.
  if (opts.selectedFrameIds.length === 0 && opts.selectedNodeIds.length >= 1) {
    const lives: SceneBox[] = [];
    for (const id of opts.selectedNodeIds) {
      const live = liveShapeGeomBox(id);
      if (!live) break;
      lives.push(inflateSelectionBox(live, opts.document?.deltaSetLike?.[id]));
    }
    if (lives.length === opts.selectedNodeIds.length) {
      const liveUnion =
        opts.selectedNodeIds.length === 1 ? lives[0] : unionOfBoxes(lives);
      if (
        liveUnion &&
        Math.abs(liveUnion.left - base.left) < 2 &&
        Math.abs(liveUnion.top - base.top) < 2 &&
        Math.abs(liveUnion.width - base.width) < 2 &&
        Math.abs(liveUnion.height - base.height) < 2
      ) {
        return liveUnion;
      }
    }
  }
  return base;
}

/** Hovered (unselected) image with a multi-gen stack → show variants chrome. */
export function resolveHoverImageVariantsId(opts: {
  inspectDev: boolean;
  transforming: boolean;
  suppressToolbars: boolean;
  hoverNodeId: string | null;
  selectedNodeIds: string[];
  document: SceneDocument;
}): string | null {
  if (opts.inspectDev || opts.transforming || opts.suppressToolbars) return null;
  if (
    !opts.hoverNodeId ||
    opts.selectedNodeIds.includes(opts.hoverNodeId) ||
    parseFrameSelId(opts.hoverNodeId)
  ) {
    return null;
  }
  const node = opts.document?.deltaSetLike?.[opts.hoverNodeId];
  if (node?.key !== 'image') return null;
  if (isImageGeneratorNode(node) || isVideoGeneratorNode(node) || isLottieGeneratorNode(node)) {
    return null;
  }
  if (String(node?.attrs?.processStatus || '') === 'running') return null;
  if (listImageVariantUrls(node).length <= 1) return null;
  return opts.hoverNodeId;
}

/** SelectionChrome edge knobs: generators none; video/text L/R only; else all. */
export function resolveSelectionEdgeHandles(opts: {
  selectedIsImageGen: boolean;
  selectedIsVideoGen: boolean;
  selectedIsLottieGen: boolean;
  selectedIsVideo: boolean;
  lineChrome: boolean;
  nodeKey: string | undefined;
}): 'all' | 'horizontal' | 'none' {
  if (opts.selectedIsImageGen || opts.selectedIsVideoGen || opts.selectedIsLottieGen) return 'none';
  // Video scrubber on bottom — keep L/R only so S handle does not steal events.
  if (opts.selectedIsVideo) return 'horizontal';
  if (!opts.lineChrome && opts.nodeKey === 'text') return 'horizontal';
  return 'all';
}

/**
 * Selection: marquee / move / 8-way resize / rotate.
 */
