/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/scene/paint/sceneToSvg.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { SceneDocument, SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';
/**
 * Scene → native SVG DOM (no SVG.js).
 */
import {
  append,
  clearChildren,
  createSvgRoot,
  ensureDefs,
  getBBox,
  setAttrs,
  setFill,
  setStroke,
  setStyles,
  svgEl,
  urlRef,
  XLINK_NS,
} from './svgDom';
import {
  parseNodeText,
  parseNodeTextStyle,
  textVerticalOriginY,
  toFabricFontFamily,
  textVisualLines,
  wrapPlainTextLines,
} from '../document/sceneText';
import {
  boolEffectAttr,
  hexWithOpacity,
  resolveStroke,
  resolveStrokeAlign,
  resolveStrokeLinecap,
  resolveStrokeLinejoin,
} from '../document/sceneEffects';
import type { StrokeAlign, StrokeLinecap, StrokeLinejoin } from '../document/sceneEffects';
import { isTransparentFill, resolveDocumentBackground, resolveFill } from '../document/sceneFill';
import {
  isAudioGeneratorNode,
  isAudioNode,
  isExportableSceneNode,
  isImageGeneratorNode,
  isImageProcessRunning,
  isLottieGeneratorNode,
  isLottieNode,
  isNodeHidden,
  isVideoGeneratorNode
} from '../document/nodeCapabilities';
import {
  resolveThemeSurfaceFill
} from '../document/nodeFactories';
import { generatorEmptyIconSize } from '../../core/layout';
import {
  clampCornerRadii,
  filletPathD,
  radiiFromAttrs,
  vertexRadiiFromAttrs,
  roundedPolygonPath,
  roundedRectPath,
  type CornerRadii,
} from '../document/sceneRadii';
import { isCustomPathShape } from '../document/pathScale';
import { shapeVertexPoints, sidesFromAttrs, clampShapeSides, DEFAULT_SHAPE_SIDES, starInnerRatioFromAttrs, ellipseInnerRatioFromAttrs, ellipseArcPercentFromAttrs, ellipseStartDegFromAttrs, clampEllipseInnerRatio, clampEllipseArcPercent, clampEllipseStartDeg } from '../document/sceneShapes';
import { getShapeBaseline, getShapeBaselineD } from '@recombyn-native/components/rcb/core/geometry';
import { applyNodeShadow, applySvgFill } from './svgPaint';
import {
  brushSize,
  findPencilBrush,
  paintStampDabs,
  parsePathPressures,
  parseSimplePathPoints,
  pencilInkPathFromPoints,
  buildStampDabs,
  STAMP_MAX_DABS,
  type StampDab,
} from '@recombyn-native/components/rcb/tools/pencilBrushes';
import { applyFrameContentClip, detachSceneNodeEl } from '@recombyn-native/components/rcb/frames/frameContentClip';
import { getTintedStampSrc, STAMP_TINT_READY_EVENT } from '@recombyn-native/components/rcb/tools/stampTint';
import { strokeDashForStyle } from '../document/sceneStrokeStyle';
import type { RcbCamera } from '@recombyn-native/components/rcb/core/types';
import {
  rcbCameraCssZoom,
  rcbCameraScreenOffset,
  rcbDprIsFractional,
  rcbSnapSceneSurfaceOrigin,
} from '@recombyn-native/components/rcb/core/math';
import { readDevicePixelRatio } from '@recombyn-native/components/rcb/core/dpr';

const TRANSPARENT_PIXEL_SRC =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Live camera + DPR + stage size for the shared world viewport (set from RcbCanvas). */
let paintCamera: RcbCamera | null = null;
let paintDpr = 1;
let paintStage = { w: 0, h: 0 };

export function setInfiniteSvgPaintCamera(
  camera: RcbCamera,
  dpr?: number,
  stage?: { width: number; height: number }
) {
  paintCamera = camera;
  if (typeof dpr === 'number' && dpr > 0) paintDpr = dpr;
  if (stage && stage.width > 0 && stage.height > 0) {
    paintStage = { w: stage.width, h: stage.height };
  }
}

/** Last camera pushed from RcbCanvas (for fly-to-chat / off-tree callers). */
export function getInfiniteSvgPaintCamera(): RcbCamera | null {
  return paintCamera;
}

/** Current editor CSS zoom (for outline sparsify etc.). Falls back to 1. */
export function getInfiniteSvgPaintZoom(): number {
  if (!paintCamera) return 1;
  return Math.max(0.15, rcbCameraCssZoom(paintCamera));
}

function resolvePaintCamera(camera?: RcbCamera | null): RcbCamera | null {
  return camera ?? paintCamera;
}

function resolvePaintDpr(dpr?: number): number {
  if (typeof dpr === 'number' && dpr > 0) return dpr;
  if (paintDpr > 0) return paintDpr;
  return readDevicePixelRatio();
}

/**
 * Editor-only hairline under CSS camera `scale(zoom)`.
 * Fixed scene widths (e.g. 1.5) become huge screen rings at 800%+ and look
 * like the control box is larger than the image / generator plate.
 */
export function editorChromeStrokeSceneWidth(cssPx = 1): number {
  const cam = resolvePaintCamera();
  const z = cam ? rcbCameraCssZoom(cam) : 1;
  return Math.max(1e-4, cssPx / Math.max(0.05, z));
}

/**
 * One shared scene viewport for pixel grid + every shape host.
 * Same CSS `left/top/width/height` === `viewBox` → one raster lattice under
 * browser zoom (fractional DPR). Content stays in absolute scene coords.
 */
export function worldCameraViewport(
  camera?: RcbCamera | null,
  dpr?: number,
  stageW?: number,
  stageH?: number
): { left: number; top: number; width: number; height: number } | null {
  const cam = resolvePaintCamera(camera);
  const w = typeof stageW === 'number' && stageW > 0 ? stageW : paintStage.w;
  const h = typeof stageH === 'number' && stageH > 0 ? stageH : paintStage.h;
  if (!cam || !(w > 0) || !(h > 0)) return null;
  const d = resolvePaintDpr(dpr);
  const z = rcbCameraCssZoom(cam);
  const { x: camX, y: camY } = rcbCameraScreenOffset(cam, d);
  return {
    left: -camX / z,
    top: -camY / z,
    width: w / z,
    height: h / z,
  };
}

let clipSeq = 0;
function nextClipId(prefix: string) {
  clipSeq += 1;
  return `${prefix}-${clipSeq}`;
}

/** Normalized crop rect from node attrs, or null when full-bleed / invalid. */
function readNodeCropNorm(node: SceneNodeInput): { x: number; y: number; w: number; h: number } | null {
  const fx = Number(node?.attrs?.cropX);
  const fy = Number(node?.attrs?.cropY);
  const fw = Number(node?.attrs?.cropW);
  const fh = Number(node?.attrs?.cropH);
  if (
    Number.isFinite(fx) &&
    Number.isFinite(fy) &&
    Number.isFinite(fw) &&
    Number.isFinite(fh) &&
    fw > 0 &&
    fh > 0 &&
    (fx !== 0 || fy !== 0 || fw !== 1 || fh !== 1)
  ) {
    return { x: fx, y: fy, w: fw, h: fh };
  }
  return null;
}

function num(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function sceneOrigin(document: SceneDocument | null | undefined) {
  return { ox: num(document?.x, 0), oy: num(document?.y, 0) };
}

export function nodeLeftTop(document: SceneDocument | null | undefined, node: SceneNodeInput) {
  const { ox, oy } = sceneOrigin(document);
  return { left: num(node.x, 0) - ox, top: num(node.y, 0) - oy };
}

function objectMeta(node: SceneNodeInput) {
  return {
    angle: num(node.attrs?.angle, 0),
    opacity: Math.min(1, Math.max(0, num(node.attrs?.opacity, 1))),
    blendMode: String(node.attrs?.blendMode || 'pass-through'),
    flipX: boolEffectAttr(node.attrs?.flipX, false),
    flipY: boolEffectAttr(node.attrs?.flipY, false),
  };
}

type ShapeStrokeOpts = {
  color: string;
  width: number;
  dasharray?: string;
  align: StrokeAlign;
  linecap: StrokeLinecap;
  linejoin: StrokeLinejoin;
};

function strokeOptsFromNode(node: SceneNodeInput, color: string, width: number): ShapeStrokeOpts {
  const dash = strokeDashForStyle(node?.attrs?.strokeStyle);
  return {
    color,
    width,
    ...(dash ? { dasharray: dash } : {}),
    align: resolveStrokeAlign(node?.attrs),
    linecap: resolveStrokeLinecap(node?.attrs),
    linejoin: resolveStrokeLinejoin(node?.attrs),
  };
}

function setSvgImageHref(img: SVGImageElement, href: string) {
  img.setAttributeNS(XLINK_NS, 'href', href);
  img.setAttribute('href', href);
}

const stampTipImageCache = new Map<string, HTMLImageElement>();

function tipImageReady(src: string): HTMLImageElement | null {
  if (!src || typeof Image === 'undefined') return null;
  let img = stampTipImageCache.get(src);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.src = src;
    stampTipImageCache.set(src, img);
  }
  if (img.complete && (img.naturalWidth || img.width)) return img;
  // Upgrade multi-dab fallback → single bake once the tip finishes decoding.
  if (!(img as HTMLImageElement & { __stampLoadNotify?: boolean }).__stampLoadNotify) {
    (img as HTMLImageElement & { __stampLoadNotify?: boolean }).__stampLoadNotify = true;
    img.addEventListener(
      'load',
      () => {
        if (typeof window === 'undefined') return;
        window.dispatchEvent(new CustomEvent(STAMP_TINT_READY_EVENT));
      },
      { once: true }
    );
  }
  return null;
}

/**
 * Bake tip stamps into one PNG for the stroke host (keeps tip texture, 1 DOM image).
 * Supersamples to current screen density (DPR × zoom) so zoom-in stays sharp longer.
 * Prefers OffscreenCanvas worker; falls back to main-thread canvas.
 */
async function rasterizeStampStrokeImage(
  samples: StampDab[],
  tipSrc: string,
  strokeOpacity: number
): Promise<{ href: string; x: number; y: number; width: number; height: number } | null> {
  if (typeof document === 'undefined' || !samples.length || !tipSrc) return null;
  const tip = tipImageReady(tipSrc);
  if (!tip) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const d of samples) {
    const r = d.size / 2;
    minX = Math.min(minX, d.x - r);
    minY = Math.min(minY, d.y - r);
    maxX = Math.max(maxX, d.x + r);
    maxY = Math.max(maxY, d.y + r);
  }
  if (!Number.isFinite(minX)) return null;

  const pad = 2;
  const width = Math.max(1, Math.ceil(maxX - minX + pad * 2));
  const height = Math.max(1, Math.ceil(maxY - minY + pad * 2));
  const zoom = paintCamera ? Math.max(0.25, rcbCameraCssZoom(paintCamera)) : 1;
  const dpr = Math.max(1, paintDpr || 1);
  // Screen px per scene unit, plus headroom for one zoom step before rebake.
  const want = Math.min(8, Math.max(2.5, dpr * zoom * 1.35));
  const maxSide = 8192;
  const scale = Math.min(want, maxSide / Math.max(width, height));
  const originX = -minX + pad;
  const originY = -minY + pad;

  try {
    const tipBitmap = await createImageBitmap(tip);
    // Dynamic import avoids sceneToSvg ↔ exportImage cycle (export uses loadSceneOntoSvg).
    const { bakeStampStrokeInWorker } = await import('./exportImage');
    const href = await bakeStampStrokeInWorker({
      tip: tipBitmap,
      dabs: samples.map((d) => ({
        x: d.x,
        y: d.y,
        size: d.size,
        opacity: d.opacity,
      })),
      strokeOpacity,
      sceneWidth: width,
      sceneHeight: height,
      scale,
      originX,
      originY,
    });
    return { href, x: minX - pad, y: minY - pad, width, height };
  } catch {
    /* fall through to main-thread bake */
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width * scale));
  canvas.height = Math.max(1, Math.ceil(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(scale, 0, 0, scale, originX * scale, originY * scale);
  paintStampDabs(ctx, samples, tip, strokeOpacity);
  try {
    return {
      href: canvas.toDataURL('image/png'),
      x: minX - pad,
      y: minY - pad,
      width,
      height,
    };
  } catch {
    return null;
  }
}

/** Zoom LOD bucket for tip-stroke rebake (1, 2, 4, 8…). */
export function stampStrokeBakeZoomBucket(zoom?: number): number {
  const z = Math.max(
    0.25,
    typeof zoom === 'number' && zoom > 0
      ? zoom
      : paintCamera
        ? rcbCameraCssZoom(paintCamera)
        : 1
  );
  return Math.pow(2, Math.max(0, Math.round(Math.log2(z))));
}

/**
 * Stroke paints along the element's vector baseline.
 * Align is paint-only on the path; selection chrome stays on path geom
 * (`strokeChromeOutset` === 0). Draw uses a separate visual→geom inset when
 * committing path size.
 *
 * Outside: a 2× underlay stroke behind an opaque fill (fill covers the inner half).
 * Inside: 2× stroke clipped to the fill region.
 * Center: normal SVG stroke centered on the path.
 */
function applyElementStroke(
  root: SVGSVGElement,
  el: SVGElement,
  opts: ShapeStrokeOpts,
  flags?: { hasOpaqueFill?: boolean }
) {
  if (!(opts.width > 0) || !opts.color || opts.color === 'transparent') {
    setStroke(el, 'none');
    removeStrokeUnderlay(el);
    return;
  }
  let align = opts.align || 'center';
  if (align === 'outside' && flags?.hasOpaqueFill === false) {
    align = 'center';
  }

  el.removeAttribute('paint-order');
  el.style.removeProperty('paint-order');
  el.removeAttribute('clip-path');
  el.style.removeProperty('clip-path');
  el.removeAttribute('mask');
  el.style.removeProperty('mask');
  removeStrokeUnderlay(el);

  if (align === 'outside') {
    // Dual-path underlay is reliable; paint-order alone often looks like "center"
    // when fills/filters reorder painting.
    if (flags?.hasOpaqueFill !== false && applyOutsideStrokeUnderlay(el, opts)) {
      return;
    }
    const strokeSpec = {
      color: opts.color,
      width: opts.width * 2,
      linecap: opts.linecap || 'butt',
      linejoin: opts.linejoin || 'miter',
      ...(opts.dasharray ? { dasharray: opts.dasharray } : {}),
    };
    setAttrs(el, { 'paint-order': 'stroke fill' });
    el.style.setProperty('paint-order', 'stroke fill');
    setStroke(el, strokeSpec);
    return;
  }

  if (align === 'inside') {
    applyInsideStrokeClip(root, el);
    setAttrs(el, { 'paint-order': 'fill stroke' });
    el.style.setProperty('paint-order', 'fill stroke');
    setStroke(el, {
      color: opts.color,
      width: opts.width * 2,
      linecap: opts.linecap || 'butt',
      linejoin: opts.linejoin || 'miter',
      ...(opts.dasharray ? { dasharray: opts.dasharray } : {}),
    });
    return;
  }

  setStroke(el, {
    color: opts.color,
    width: opts.width,
    linecap: opts.linecap || 'butt',
    linejoin: opts.linejoin || 'miter',
    ...(opts.dasharray ? { dasharray: opts.dasharray } : {}),
  });
}

function removeStrokeUnderlay(el: SVGElement) {
  const prev = el.previousElementSibling;
  if (prev instanceof SVGElement && prev.getAttribute('data-stroke-under') === '1') {
    prev.remove();
  }
}

/**
 * Insert a fill-none path under `el` with 2× stroke; clear stroke on `el`.
 * Opaque fill on `el` covers the inward half → true outside stroke.
 */
function applyOutsideStrokeUnderlay(el: SVGElement, opts: ShapeStrokeOpts): boolean {
  const d = el.getAttribute('d');
  const parent = el.parentElement;
  if (!d || !parent) return false;

  const under = svgEl('path', {
    d,
    'data-stroke-under': '1',
    'data-radius-body': el.getAttribute('data-radius-body') === '1' ? '1' : null,
    'pointer-events': 'none',
  });
  setFill(under, 'none');
  setStroke(under, {
    color: opts.color,
    width: opts.width * 2,
    linecap: opts.linecap || 'butt',
    linejoin: opts.linejoin || 'miter',
    ...(opts.dasharray ? { dasharray: opts.dasharray } : {}),
  });
  parent.insertBefore(under, el);
  setStroke(el, 'none');
  return true;
}

/** Clip a stroked element to its own fill so only the inward half of a 2× stroke shows. */
function applyInsideStrokeClip(root: SVGSVGElement, el: SVGElement) {
  const id = nextClipId('stroke-inside');
  const defs = ensureDefs(root);
  const clip = svgEl('clipPath', { id });
  const d = el.getAttribute('d');

  if (d) {
    setAttrs(clip, { clipPathUnits: 'userSpaceOnUse' });
    clip.appendChild(svgEl('path', { d, fill: '#fff', stroke: 'none' }));
  } else {
    setAttrs(clip, { clipPathUnits: 'objectBoundingBox' });
    clip.appendChild(svgEl('rect', { x: 0, y: 0, width: 1, height: 1, fill: '#fff' }));
  }

  defs.appendChild(clip);
  const ref = urlRef(id);
  setAttrs(el, { 'clip-path': ref });
  el.style.setProperty('clip-path', ref);
}

type SceneGeom = {
  left: number;
  top: number;
  width: number;
  height: number;
  abs: boolean;
};

/** Runtime fields painted onto SVG hosts (not in the DOM schema). */
export type SceneSvgHost = SVGElement & {
  __sceneLeft?: number;
  __sceneTop?: number;
  sceneWidth?: number;
  sceneHeight?: number;
  __sceneAbsPos?: boolean;
  sceneNodeId?: string;
  sceneNodeKey?: string;
  sceneShapeType?: string;
  __sceneAngle?: number;
  __sceneFlipX?: boolean;
  __sceneFlipY?: boolean;
  __sceneSides?: number;
  __sceneCornerRadii?: CornerRadii;
  __sceneEllipseInner?: number;
  __sceneEllipseArc?: number;
  __sceneEllipseStart?: number;
  __sceneBasePath?: string;
  __sceneFontSize?: number;
  __sceneLineHeight?: number;
  __sceneLineCount?: number;
  __scenePlainText?: string;
  __sceneDragBaseW?: number;
  __sceneDragBaseH?: number;
  __sceneDragBaseFontSize?: number;
  __sceneDragBaseLetterSpacing?: number;
  __sceneDidResize?: boolean;
};

function asHost(el: SVGElement): SceneSvgHost {
  return el as SceneSvgHost;
}

const geomByDom = new WeakMap<SVGElement, SceneGeom>();

function writeGeom(el: SVGElement, geom: SceneGeom) {
  const anyEl = asHost(el);
  anyEl.__sceneLeft = geom.left;
  anyEl.__sceneTop = geom.top;
  anyEl.sceneWidth = geom.width;
  anyEl.sceneHeight = geom.height;
  anyEl.__sceneAbsPos = geom.abs;
  geomByDom.set(el, { ...geom });
}

function readGeom(el: SVGElement): SceneGeom | null {
  const anyEl = asHost(el);
  const fromMap = geomByDom.get(el);
  if (fromMap) return { ...fromMap };
  const left = Number(anyEl.__sceneLeft);
  const top = Number(anyEl.__sceneTop);
  const width = Number(anyEl.sceneWidth);
  const height = Number(anyEl.sceneHeight);
  if (![left, top, width, height].every(Number.isFinite)) return null;
  return { left, top, width, height, abs: !!anyEl.__sceneAbsPos };
}

function tagNode(
  el: SVGElement,
  nodeId: string,
  key: string,
  shapeType?: string,
  left = 0,
  top = 0,
  width = 0,
  height = 0
) {
  setAttrs(el, {
    'data-scene-node-id': nodeId,
    'data-scene-node-key': key,
    'shape-rendering': 'geometricPrecision',
    ...(shapeType ? { 'data-scene-shape-type': shapeType } : {}),
  });
  const anyEl = asHost(el);
  anyEl.sceneNodeId = nodeId;
  anyEl.sceneNodeKey = key;
  if (shapeType) anyEl.sceneShapeType = shapeType;
  writeGeom(el, { left, top, width, height, abs: false });
  return el;
}

function applyMeta(
  el: SVGElement,
  left: number,
  top: number,
  meta: ReturnType<typeof objectMeta>,
  width = 0,
  height = 0
) {
  const anyEl = asHost(el);
  anyEl.__sceneAngle = meta.angle;
  anyEl.__sceneFlipX = meta.flipX;
  anyEl.__sceneFlipY = meta.flipY;
  reapplySceneTransform(el, left, top, width, height);
  setAttrs(el, { opacity: meta.opacity });
  try {
    const mode = String(meta.blendMode || 'pass-through').toLowerCase();
    if (!mode || mode === 'pass-through' || mode === 'passthrough') {
      el.style.removeProperty('mix-blend-mode');
    } else {
      el.style.mixBlendMode = mode;
    }
  } catch {
    /* ignore */
  }
  return el;
}

function reapplySceneTransform(el: SVGElement, left: number, top: number, width: number, height: number) {
  const anyEl = asHost(el);
  const angle = Number(anyEl.__sceneAngle) || 0;
  const flipX = !!anyEl.__sceneFlipX;
  const flipY = !!anyEl.__sceneFlipY;
  const geom = readGeom(el);
  const abs = geom ? geom.abs : !!anyEl.__sceneAbsPos;
  const parts: string[] = [];

  if (!abs) parts.push(`translate(${left} ${top})`);

  const rx = abs ? left + width / 2 : width / 2;
  const ry = abs ? top + height / 2 : height / 2;
  if (angle) parts.push(`rotate(${angle} ${rx} ${ry})`);
  if (flipX || flipY) {
    const sx = flipX ? -1 : 1;
    const sy = flipY ? -1 : 1;
    parts.push(`translate(${rx} ${ry}) scale(${sx} ${sy}) translate(${-rx} ${-ry})`);
  }

  if (parts.length) setAttrs(el, { transform: parts.join(' ') });
  else el.removeAttribute('transform');
  syncStrokeUnderlayTransform(el);
}

/** Outside-stroke underlay is the previous sibling — mirror transforms from the filled body. */
function syncStrokeUnderlayTransform(el: SVGElement) {
  const prev = el.previousElementSibling;
  if (!(prev instanceof SVGElement) || prev.getAttribute('data-stroke-under') !== '1') return;
  const t = el.getAttribute('transform');
  if (t) prev.setAttribute('transform', t);
  else prev.removeAttribute('transform');
}

function markAbsPos(el: SVGElement) {
  const geom = readGeom(el);
  if (geom) writeGeom(el, { ...geom, abs: true });
  else asHost(el).__sceneAbsPos = true;
  return el;
}

function writeSceneSides(el: SVGElement, sides: number) {
  const n = clampShapeSides(sides);
  asHost(el).__sceneSides = n;
  setAttrs(el, { 'data-scene-sides': String(n) });
}

function readSceneSides(el: SVGElement | null | undefined): number {
  const fromMem = Number(el ? asHost(el).__sceneSides : undefined);
  if (Number.isFinite(fromMem) && fromMem >= 3) return clampShapeSides(fromMem);
  const fromAttr = Number(el?.getAttribute?.('data-scene-sides'));
  if (Number.isFinite(fromAttr) && fromAttr >= 3) return clampShapeSides(fromAttr);
  return DEFAULT_SHAPE_SIDES;
}

/** Keep live corner radii on the host so geometry preview does not flash sharp. */
function rememberSceneCornerRadii(el: SVGElement | null | undefined, r: CornerRadii) {
  if (!el) return;
  asHost(el).__sceneCornerRadii = {
    tl: Number(r.tl) || 0,
    tr: Number(r.tr) || 0,
    br: Number(r.br) || 0,
    bl: Number(r.bl) || 0,
  };
}

function readSceneCornerRadii(el: SVGElement): CornerRadii {
  const mem = asHost(el).__sceneCornerRadii;
  if (
    mem &&
    [mem.tl, mem.tr, mem.br, mem.bl].every((n: unknown) => Number.isFinite(Number(n)))
  ) {
    return {
      tl: Number(mem.tl) || 0,
      tr: Number(mem.tr) || 0,
      br: Number(mem.br) || 0,
      bl: Number(mem.bl) || 0,
    };
  }
  return { tl: 0, tr: 0, br: 0, bl: 0 };
}

function rememberSceneEllipseParams(
  el: SVGElement | null | undefined,
  innerRatio: number,
  arcPercent: number,
  startDeg: number
) {
  if (!el) return;
  const bag = asHost(el);
  bag.__sceneEllipseInner = clampEllipseInnerRatio(innerRatio);
  bag.__sceneEllipseArc = clampEllipseArcPercent(arcPercent);
  bag.__sceneEllipseStart = clampEllipseStartDeg(startDeg);
  setAttrs(el, {
    'data-ellipse-inner': String(bag.__sceneEllipseInner),
    'data-ellipse-arc': String(bag.__sceneEllipseArc),
    'data-ellipse-start': String(bag.__sceneEllipseStart),
  });
}

function readSceneEllipseParams(el: SVGElement | null | undefined): {
  innerRatio: number;
  arcPercent: number;
  startDeg: number;
} {
  const bag = el ? asHost(el) : null;
  const memInner = Number(bag?.__sceneEllipseInner);
  const memArc = Number(bag?.__sceneEllipseArc);
  const memStart = Number(bag?.__sceneEllipseStart);
  const attrInner = Number(el?.getAttribute?.('data-ellipse-inner'));
  const attrArc = Number(el?.getAttribute?.('data-ellipse-arc'));
  const attrStart = Number(el?.getAttribute?.('data-ellipse-start'));
  return {
    innerRatio: clampEllipseInnerRatio(
      Number.isFinite(memInner) ? memInner : attrInner,
      0
    ),
    arcPercent: clampEllipseArcPercent(
      Number.isFinite(memArc) ? memArc : attrArc,
      100
    ),
    startDeg: clampEllipseStartDeg(
      Number.isFinite(memStart) ? memStart : attrStart,
      90
    ),
  };
}

function roundedShapePath(
  shapeType: string,
  width: number,
  height: number,
  r: CornerRadii,
  sides: number = DEFAULT_SHAPE_SIDES,
  attrs?: Record<string, unknown> | null
) {
  const pts = shapeVertexPoints(
    shapeType,
    width,
    height,
    sides,
    starInnerRatioFromAttrs(attrs)
  );
  if (!pts.length) return '';
  const vertexRadii = vertexRadiiFromAttrs(
    attrs ?? {
      radiusTL: r.tl,
      radiusTR: r.tr,
      radiusBR: r.br,
      radiusBL: r.bl,
      radiusLinked: 'true',
    },
    pts.length,
    shapeType
  );
  return roundedPolygonPath(pts, vertexRadii);
}

type DrawCtx = { root: SVGSVGElement; parent: SVGElement };

function coverRotatedFillFringe(
  el: SVGElement,
  paint: ReturnType<typeof resolveFill>,
  stroke: string,
  strokeWidth: number,
  angleDeg: number
) {
  if (strokeWidth > 0 && stroke && stroke !== 'transparent') return;
  if (paint.kind !== 'solid' || !paint.color) return;
  if (Math.abs(angleDeg) <= 0.2) return;
  setStroke(el, { color: paint.color, width: 0.75, linejoin: 'miter' });
}

function appendChild<T extends SVGElement>(parent: SVGElement, child: T): T {
  append(parent, child);
  return child;
}

/** Portal target for HTML lottie / video / audio inside the shared SVG stack. */
export const HTML_MEDIA_MOUNT_ATTR = 'data-rcb-html-media-mount';

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/**
 * Mount HTML media into the node’s SVG layer so paint order follows `data-z`
 * (same stack as images / generators). Overlays portal into this div.
 */
function appendHtmlMediaMount(
  g: SVGGElement,
  opts: { nodeId: string; width: number; height: number; kind: 'lottie' | 'video' | 'audio' }
): void {
  const w = Math.max(1, opts.width);
  const h = Math.max(1, opts.height);
  const fo = appendChild(
    g,
    svgEl('foreignObject', {
      x: 0,
      y: 0,
      width: w,
      height: h,
      'data-rcb-html-media-fo': opts.kind,
      // Parent SVG is pointer-events:none; keep FO none so canvas hits pass
      // through. Controls set pointer-events:auto on themselves (same as before).
      'pointer-events': 'none',
    })
  );
  const div = document.createElementNS(XHTML_NS, 'div');
  div.setAttribute(HTML_MEDIA_MOUNT_ATTR, opts.nodeId);
  div.setAttribute('data-rcb-html-media-kind', opts.kind);
  div.style.cssText =
    'width:100%;height:100%;overflow:hidden;pointer-events:none;position:relative;';
  fo.appendChild(div);
}

/** Resolve the HTML media portal mount for a painted scene node. */
export function findHtmlMediaMount(nodeId: string): HTMLElement | null {
  const id = String(nodeId || '');
  if (!id) return null;
  const sel = `[${HTML_MEDIA_MOUNT_ATTR}="${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
  try {
    const hit = document.querySelector(sel);
    return hit instanceof HTMLElement ? hit : null;
  } catch {
    return null;
  }
}

function createRectLike(
  ctx: DrawCtx,
  document: SceneDocument,
  node: SceneNodeInput,
  nodeId: string,
  sceneNodeKey: string,
  shapeType?: string
) {
  const { root, parent } = ctx;
  const paint = resolveFill(node, 'transparent');
  const { stroke, strokeWidth: sw } = resolveStroke(node, '#333333');
  const { left, top } = nodeLeftTop(document, node);
  const width = Math.max(node.width || 0, 1);
  const height = Math.max(node.height || 0, 1);
  const r = radiiFromAttrs(node.attrs);
  const meta = objectMeta(node);
  const showL = boolEffectAttr(node.attrs?.L, true);
  const showR = boolEffectAttr(node.attrs?.R, true);
  const showT = boolEffectAttr(node.attrs?.T, true);
  const showB = boolEffectAttr(node.attrs?.B, true);
  const allSides = showL && showR && showT && showB;
  const noSides = !showL && !showR && !showT && !showB;
  const fillTransparent = isTransparentFill(paint);

  const strokeFull = strokeOptsFromNode(node, stroke, sw || 1);
  const strokeOpen: ShapeStrokeOpts = { ...strokeFull, align: 'center' };

  if (showB && !showT && !showL && !showR && fillTransparent) {
    const line = appendChild(
      parent,
      svgEl('line', { x1: left, y1: top + height, x2: left + width, y2: top + height })
    );
    applyElementStroke(root, line, strokeOpen);
    setFill(line, 'none');
    tagNode(line, nodeId, sceneNodeKey, shapeType, left, top, width, height);
    markAbsPos(line);
    applyMeta(line, left, top, meta, width, height);
    applyNodeShadow(root, line, node);
    return line;
  }

  const g = appendChild(parent, svgEl('g'));
  const body = appendChild(g, svgEl('path', { d: roundedRectPath(width, height, r) }));
  setAttrs(body, { 'data-radius-body': '1', 'data-baseline': '1' });
  applySvgFill(root, body, paint, `n-${nodeId}`);
  const hasRadius = Math.max(r.tl, r.tr, r.br, r.bl) > 0.5;
  if ((allSides || hasRadius) && !noSides) {
    applyElementStroke(root, body, strokeFull, { hasOpaqueFill: !fillTransparent });
  } else {
    setStroke(body, 'none');
  }

  if (!allSides && !noSides && !hasRadius) {
    if (showT) {
      const ln = appendChild(g, svgEl('line', { x1: 0, y1: 0, x2: width, y2: 0 }));
      setFill(ln, 'none');
      applyElementStroke(root, ln, strokeOpen);
    }
    if (showB) {
      const ln = appendChild(g, svgEl('line', { x1: 0, y1: height, x2: width, y2: height }));
      setFill(ln, 'none');
      applyElementStroke(root, ln, strokeOpen);
    }
    if (showL) {
      const ln = appendChild(g, svgEl('line', { x1: 0, y1: 0, x2: 0, y2: height }));
      setFill(ln, 'none');
      applyElementStroke(root, ln, strokeOpen);
    }
    if (showR) {
      const ln = appendChild(g, svgEl('line', { x1: width, y1: 0, x2: width, y2: height }));
      setFill(ln, 'none');
      applyElementStroke(root, ln, strokeOpen);
    }
  }

  tagNode(g, nodeId, sceneNodeKey, shapeType, left, top, width, height);
  rememberSceneCornerRadii(g, r);
  if (allSides || noSides) {
    coverRotatedFillFringe(body, paint, stroke, sw, Number(meta.angle) || 0);
  }
  applyMeta(g, left, top, meta, width, height);
  applyNodeShadow(root, g, node);
  return g;
}

async function createShape(ctx: DrawCtx, document: SceneDocument, node: SceneNodeInput, nodeId: string) {
  const { root, parent } = ctx;
  const shapeType = node.attrs?.shapeType || 'rect';
  const paint = resolveFill(node, '#FFFFFF');
  const { stroke, strokeWidth: resolvedSw } = resolveStroke(node, '#333333');
  let swFallback = 1;
  if (shapeType === 'pencil') swFallback = 1.5;
  else if (shapeType === 'pen' || shapeType === 'line' || shapeType === 'arrow') swFallback = 2;
  const strokeWidth = Number.isFinite(resolvedSw) ? resolvedSw : swFallback;
  const { left, top } = nodeLeftTop(document, node);
  const width = Math.max(node.width || 100, 1);
  const height = Math.max(node.height || 100, 1);
  const meta = objectMeta(node);
  const strokeFull = strokeOptsFromNode(node, stroke, strokeWidth);
  const hasCapAttr = node.attrs?.strokeLinecap != null || node.attrs?.['stroke-linecap'] != null;
  const hasJoinAttr = node.attrs?.strokeLinejoin != null || node.attrs?.['stroke-linejoin'] != null;
  let linecap = strokeFull.linecap;
  let linejoin = strokeFull.linejoin;
  if (!hasCapAttr && shapeType === 'pencil') linecap = 'round';
  if (!hasJoinAttr && shapeType === 'pencil') linejoin = 'round';
  const strokeOpen: ShapeStrokeOpts = {
    ...strokeFull,
    align: 'center',
    linecap,
    linejoin,
  };

  if (shapeType === 'line') {
    const mid = height / 2;
    const line = appendChild(parent, svgEl('line', { x1: 0, y1: mid, x2: width, y2: mid }));
    setFill(line, 'none');
    setAttrs(line, { 'data-baseline': '1' });
    applyElementStroke(root, line, strokeOpen);
    tagNode(line, nodeId, 'shape', shapeType, left, top, width, height);
    applyMeta(line, left, top, meta, width, height);
    applyNodeShadow(root, line, node);
    return line;
  }

  if (shapeType === 'arrow') {
    const d = getShapeBaselineD({
      key: 'shape',
      width,
      height,
      attrs: { shapeType: 'arrow' },
    })!;
    const path = appendChild(parent, svgEl('path', { d }));
    setFill(path, 'none');
    setAttrs(path, { 'data-baseline': '1' });
    applyElementStroke(root, path, strokeOpen);
    tagNode(path, nodeId, 'shape', shapeType, left, top, width, height);
    applyMeta(path, left, top, meta, width, height);
    applyNodeShadow(root, path, node);
    return path;
  }

  if (shapeType === 'circle') {
    const innerRatio = ellipseInnerRatioFromAttrs(node.attrs);
    const arcPercent = ellipseArcPercentFromAttrs(node.attrs);
    const startDeg = ellipseStartDegFromAttrs(node.attrs);
    const baseline = getShapeBaseline({
      key: 'shape',
      width,
      height,
      attrs: {
        ...(node.attrs || {}),
        shapeType: 'circle',
        ellipseInnerRatio: innerRatio,
        ellipseArcPercent: arcPercent,
        ellipseStartDeg: startDeg,
      },
    });
    const g = appendChild(parent, svgEl('g'));
    const path = appendChild(g, svgEl('path', { d: baseline?.d || '' }));
    setAttrs(path, { 'data-baseline': '1' });
    if (innerRatio > 1e-4) setAttrs(path, { 'fill-rule': 'evenodd' });
    applySvgFill(root, path, paint, `n-${nodeId}`);
    if (strokeWidth > 0 && stroke && stroke !== 'transparent') {
      applyElementStroke(root, path, strokeFull, { hasOpaqueFill: !isTransparentFill(paint) });
    } else {
      setStroke(path, 'none');
      coverRotatedFillFringe(path, paint, stroke, strokeWidth, Number(meta.angle) || 0);
    }
    tagNode(g, nodeId, 'shape', shapeType, left, top, width, height);
    rememberSceneEllipseParams(g, innerRatio, arcPercent, startDeg);
    applyMeta(g, left, top, meta, width, height);
    applyNodeShadow(root, g, node);
    return g;
  }

  if (shapeType === 'triangle' || shapeType === 'star' || shapeType === 'polygon') {
    const baseline = getShapeBaseline({
      key: 'shape',
      width,
      height,
      attrs: { ...(node.attrs || {}), shapeType },
    });
    const g = appendChild(parent, svgEl('g'));
    const path = appendChild(g, svgEl('path', { d: baseline?.d || '' }));
    setAttrs(path, { 'data-baseline': '1' });
    applySvgFill(root, path, paint, `n-${nodeId}`);
    applyElementStroke(root, path, strokeFull, { hasOpaqueFill: !isTransparentFill(paint) });
    tagNode(g, nodeId, 'shape', shapeType, left, top, width, height);
    if (shapeType === 'star' || shapeType === 'polygon') writeSceneSides(g, sidesFromAttrs(node.attrs));
    rememberSceneCornerRadii(g, radiiFromAttrs(node.attrs));
    applyMeta(g, left, top, meta, width, height);
    applyNodeShadow(root, g, node);
    return g;
  }

  if (shapeType === 'path' || shapeType === 'pen' || shapeType === 'pencil') {
    const d = node.attrs?.path || `M 0 0 L ${width} ${height}`;
    const closed = boolEffectAttr(node.attrs?.closed, false) || /\sZ\s*$/i.test(String(d).trim());
    const brushId = String(node.attrs?.brushStyle || 'solid');

    if (shapeType === 'pencil') {
      const pts = parseSimplePathPoints(String(d));
      const ink = stroke && stroke !== 'transparent' ? stroke : '#333333';
      const stampSrcAttr =
        node.attrs?.brushStampSrc != null ? String(node.attrs.brushStampSrc) : '';
      const brush = findPencilBrush(brushId);
      // New tip strokes use the same SVG ribbon as vector ink (instant, no dab jitter).
      // Legacy nodes that stored brushStampSrc still bake tip texture PNGs.
      const useStamp = Boolean(stampSrcAttr) && pts.length >= 2;

      if (useStamp) {
        const src = stampSrcAttr;
        const hardnessRaw = Number(node.attrs?.brushHardness);
        const hardness = Number.isFinite(hardnessRaw)
          ? Math.max(0, Math.min(100, hardnessRaw))
          : 80;
        const pressures = parsePathPressures(node.attrs?.pathPressure, pts.length);
        const ptsWithP =
          pressures && pressures.length === pts.length
            ? pts.map((p, i) => ({ ...p, pressure: pressures[i] }))
            : pts;
        const pressureOn = boolEffectAttr(node.attrs?.pressureEnabled, true);
        const samples = buildStampDabs(ptsWithP, brush, strokeWidth, {
          hardness,
          pressureEnabled: pressureOn,
          maxDabs: STAMP_MAX_DABS,
          // Match live tip preview (endpoint taper rematerializes the whole stroke).
          skipTaper: true,
        });
        const tinted = src ? getTintedStampSrc(src, ink, hardness) : '';
        const g = appendChild(parent, svgEl('g'));
        const strokeOp =
          typeof node.attrs?.opacity === 'number'
            ? Math.max(0, Math.min(1, Number(node.attrs.opacity)))
            : 1;
        const baked = tinted
          ? await rasterizeStampStrokeImage(samples, tinted, strokeOp)
          : null;
        if (baked) {
          const img = appendChild(
            g,
            svgEl('image', {
              width: baked.width,
              height: baked.height,
              x: baked.x,
              y: baked.y,
              preserveAspectRatio: 'none',
            })
          );
          setSvgImageHref(img, baked.href);
        } else if (tinted) {
          // Tip still decoding — temporary dense SVG tips until tint/load ready.
          for (const p of samples) {
            const img = appendChild(
              g,
              svgEl('image', {
                width: p.size,
                height: p.size,
                x: p.x - p.size / 2,
                y: p.y - p.size / 2,
                opacity: String(Math.max(0.08, Math.min(1, p.opacity * strokeOp))),
                preserveAspectRatio: 'none',
              })
            );
            setSvgImageHref(img, tinted);
          }
        }
        const hitSize = brushSize(brush, strokeWidth);
        const hit = appendChild(g, svgEl('path', { d: String(d) }));
        setFill(hit, 'none');
        setStroke(hit, { color: 'transparent', width: Math.max(hitSize, strokeWidth) });
        setAttrs(hit, { 'pointer-events': 'stroke', 'data-baseline': '1' });
        tagNode(g, nodeId, 'shape', shapeType, left, top, width, height);
        applyMeta(g, left, top, meta, width, height);
        applyNodeShadow(root, g, node);
        return g;
      }

      // Variable-width freehand silhouette (pressure + brush thinning / taper).
      // Outline is built around `pts` in place — do not translate relative to the path.
      // Keep an invisible centerline baseline for selection chrome hit-testing.
      const pressures = parsePathPressures(node.attrs?.pathPressure, pts.length);
      const hardnessRaw = Number(node.attrs?.brushHardness);
      const freehandHardness = Number.isFinite(hardnessRaw)
        ? Math.max(0, Math.min(100, hardnessRaw))
        : 80;
      const outlineD = pencilInkPathFromPoints(pts, strokeWidth, brushId, {
        linecap: strokeOpen.linecap,
        dasharray: strokeFull.dasharray,
        pressures,
        pressureEnabled: boolEffectAttr(node.attrs?.pressureEnabled, true),
        hardness: freehandHardness,
        // Centerline is already the capture path — RDP here kinked commits vs live.
        simplify: false,
      });
      const g = appendChild(parent, svgEl('g'));
      if (outlineD) {
        const inkPath = appendChild(g, svgEl('path', { d: outlineD }));
        setFill(inkPath, ink);
        setStroke(inkPath, 'none');
        setAttrs(inkPath, { 'pointer-events': 'none' });
      }
      const hit = appendChild(g, svgEl('path', { d: String(d) }));
      setFill(hit, 'none');
      setStroke(hit, {
        color: 'transparent',
        width: Math.max(brushSize(brush, strokeWidth), strokeWidth),
      });
      setAttrs(hit, { 'pointer-events': 'stroke', 'data-baseline': '1' });
      tagNode(g, nodeId, 'shape', shapeType, left, top, width, height);
      applyMeta(g, left, top, meta, width, height);
      applyNodeShadow(root, g, node);
      return g;
    }

    const fillPaint =
      shapeType === 'pen'
        ? resolveFill(node, 'transparent')
        : resolveFill(node, closed ? '#FFFFFF' : 'transparent');
    const baseD = String(d);
    // Pen centerlines stay raw. Closed boolean/outline paths keep a sharp base
    // and fillet via radiusVertices (same R dots as rect, seated on corners).
    const skipFillet = shapeType === 'pen' || !closed;
    const cornerR = skipFillet
      ? { tl: 0, tr: 0, br: 0, bl: 0 }
      : radiiFromAttrs(node.attrs);
    const drawD = skipFillet ? baseD : filletPathD(baseD, cornerR, node.attrs);
    const path = appendChild(parent, svgEl('path', { d: drawD }));
    setAttrs(path, { 'data-baseline': '1' });
    if (closed && shapeType !== 'pen') {
      setAttrs(path, { 'data-scene-base-path': baseD });
      asHost(path).__sceneBasePath = baseD;
    }
    applySvgFill(root, path, fillPaint, `n-${nodeId}`);
    const fillRule = String(node.attrs?.['fill-rule'] || '');
    if (fillRule === 'evenodd' || fillRule === 'nonzero') {
      setAttrs(path, { 'fill-rule': fillRule });
    }
    applyElementStroke(root, path, closed ? strokeFull : strokeOpen, {
      hasOpaqueFill: closed && shapeType !== 'pen' && !isTransparentFill(fillPaint),
    });
    if (shapeType === 'pen') {
      setAttrs(path, { 'pointer-events': 'stroke' });
    }
    tagNode(path, nodeId, 'shape', shapeType, left, top, width, height);
    rememberSceneCornerRadii(path, cornerR);
    applyMeta(path, left, top, meta, width, height);
    applyNodeShadow(root, path, node);
    return path;
  }

  return createRectLike(ctx, document, node, nodeId, 'shape', 'rect');
}

function buildMultilineText(
  parent: SVGElement,
  lines: string[],
  opts: {
    localX: number;
    originY: number;
    fontFamily: string;
    fontSize: number;
    fontWeight: string;
    fontStyle: string;
    anchor: string;
    fill: string;
    letterSpacing?: number;
    decoration?: string;
    lineHeight: number;
  }
): SVGTextElement {
  const el = appendChild(
    parent,
    svgEl('text', {
      x: opts.localX,
      y: opts.originY,
      'font-family': opts.fontFamily,
      'font-size': opts.fontSize,
      'font-weight': opts.fontWeight,
      'font-style': opts.fontStyle,
      'text-anchor': opts.anchor,
      fill: opts.fill,
      'dominant-baseline': 'text-before-edge',
      'alignment-baseline': 'before-edge',
    })
  );
  if (opts.letterSpacing) {
    setAttrs(el, { 'letter-spacing': `${opts.letterSpacing}px` });
  }
  if (opts.decoration && opts.decoration !== 'none') {
    setAttrs(el, {
      'text-decoration': opts.decoration,
      'text-decoration-line': opts.decoration,
    });
  }
  const dy = `${Math.max(0.8, opts.lineHeight)}em`;
  lines.forEach((line, i) => {
    const tspan = svgEl('tspan', {
      x: opts.localX,
      ...(i === 0 ? { y: opts.originY } : { dy }),
    });
    tspan.textContent = line || ' ';
    el.appendChild(tspan);
  });
  return el;
}

export async function nodeToSvgElement(
  root: SVGSVGElement,
  parent: SVGElement,
  document: SceneDocument,
  node: SceneNodeInput,
  nodeId: string
): Promise<SVGElement | null> {
  if (!node) return null;
  const ctx: DrawCtx = { root, parent };

  if (node.key === 'text') {
    const text = parseNodeText(node.attrs);
    const style = parseNodeTextStyle(node.attrs);
    const { left, top } = nodeLeftTop(document, node);
    const meta = objectMeta(node);
    const boxW = Math.max(num(node.width, 0), 0);
    const boxH = Math.max(num(node.height, style.fontSize * (style.lineHeight || 1.4)), 1);
    const align =
      style.textAlign === 'center' ? 'middle' : style.textAlign === 'right' ? 'end' : 'start';

    const autoSize = String(node.attrs?.autoSize ?? 'true') !== 'false';
    const visualLines = textVisualLines(text || ' ', style, {
      width: boxW,
      autoSize,
    });

    const lineHeight = Math.max(0.8, Number(style.lineHeight) || 1.4);
    const fontSize = Math.max(1, Number(style.fontSize) || 14);
    const lineCount = Math.max(1, visualLines.length);
    // Fixed box (button/chip/input label): vertically center ink in the selection height.
    // Left/right align still centers vertically so placeholders aren't top-heavy.
    const originY = !autoSize
      ? textVerticalOriginY(boxH, fontSize, lineHeight, lineCount)
      : 0;
    let localX = 0;
    const measuredW = boxW > 1 ? boxW : 1;
    if (align === 'middle') localX = measuredW / 2;
    else if (align === 'end') localX = measuredW;

    const el = buildMultilineText(parent, visualLines.length ? visualLines : [' '], {
      localX,
      originY,
      fontFamily: toFabricFontFamily(style.fontFamily),
      fontSize,
      fontWeight: String(style.fontWeight),
      fontStyle: style.fontStyle,
      anchor: align,
      fill: hexWithOpacity(style.fill || '#333333', style.fillOpacity ?? 100),
      letterSpacing: style.letterSpacing || undefined,
      decoration: String(style.textDecoration || 'none').trim(),
      lineHeight,
    });

    const bbox = getBBox(el);
    const finalW = boxW > 1 ? boxW : Math.max(1, bbox.width);
    const finalH = boxH > 1 ? boxH : Math.max(1, bbox.height);
    if (boxW <= 1) {
      localX = align === 'middle' ? finalW / 2 : align === 'end' ? finalW : 0;
      setAttrs(el, { x: localX });
      el.querySelectorAll('tspan').forEach((t, i) => {
        t.setAttribute('x', String(localX));
        if (i === 0) {
          t.removeAttribute('dy');
          t.setAttribute('y', String(originY));
        }
      });
    }

    tagNode(el, nodeId, 'text', undefined, left, top, finalW, finalH);
    const anyEl = asHost(el);
    anyEl.__sceneFontSize = fontSize;
    anyEl.__sceneLineHeight = lineHeight;
    anyEl.__sceneLineCount = Math.max(1, visualLines.length);
    anyEl.__scenePlainText = text;
    applyMeta(el, left, top, meta, finalW, finalH);
    applyNodeShadow(root, el, node);
    return el;
  }

  if (node.key === 'shape') return await createShape(ctx, document, node, nodeId);
  if (node.key === 'rect') return createRectLike(ctx, document, node, nodeId, 'rect');

  if (node.key === 'svg') {
    const markup = String(node.attrs?.svg || node.attrs?.content || '').trim();
    const { left, top } = nodeLeftTop(document, node);
    const boxW = Math.max(1, Number(node.width) || 24);
    const boxH = Math.max(1, Number(node.height) || 24);
    const meta = objectMeta(node);
    const fillOverride = String(node.attrs?.['fill-color'] || node.attrs?.fill || '').trim();
    const g = appendChild(parent, svgEl('g'));
    // Box hit target — SVG content may be sparse.
    const hit = appendChild(
      g,
      svgEl('rect', { x: 0, y: 0, width: boxW, height: boxH, fill: 'transparent' })
    );
    setAttrs(hit, { 'pointer-events': 'all', 'data-svg-hit': '1' });

    if (markup) {
      try {
        const wrapped = /^<svg[\s>]/i.test(markup)
          ? markup
          : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${markup}</svg>`;
        const parsed = new DOMParser().parseFromString(wrapped, 'image/svg+xml');
        if (!parsed.querySelector('parsererror')) {
          const srcSvg = parsed.querySelector('svg');
          if (srcSvg) {
            const vbParts = String(srcSvg.getAttribute('viewBox') || '')
              .trim()
              .split(/[\s,]+/)
              .map(Number);
            let vbX = 0;
            let vbY = 0;
            let vbW = 24;
            let vbH = 24;
            if (vbParts.length === 4 && vbParts.every((n) => Number.isFinite(n)) && vbParts[2] > 0 && vbParts[3] > 0) {
              vbX = vbParts[0];
              vbY = vbParts[1];
              vbW = vbParts[2];
              vbH = vbParts[3];
            } else {
              const wAttr = Number(srcSvg.getAttribute('width'));
              const hAttr = Number(srcSvg.getAttribute('height'));
              if (wAttr > 0 && hAttr > 0) {
                vbW = wAttr;
                vbH = hAttr;
              }
            }
            const sx = boxW / Math.max(1e-6, vbW);
            const sy = boxH / Math.max(1e-6, vbH);
            // Uniform scale + letterbox — non-uniform stretch fattened icons into "blobs".
            const s = Math.min(sx, sy);
            const ox = (boxW - vbW * s) / 2;
            const oy = (boxH - vbH * s) / 2;
            const inner = appendChild(g, svgEl('g'));
            setAttrs(inner, {
              transform: `translate(${ox},${oy}) scale(${s}) translate(${-vbX},${-vbY})`,
              'data-svg-content': '1',
              'pointer-events': 'none',
            });
            const od = g.ownerDocument;
            for (const child of Array.from(srcSvg.childNodes)) {
              if (child.nodeType !== 1) continue;
              const tag = (child as Element).tagName.toLowerCase().replace(/^.*:/, '');
              if (tag === 'script' || tag === 'foreignobject' || tag === 'style') continue;
              inner.appendChild(od.importNode(child, true));
            }
            if (fillOverride && fillOverride !== 'none' && fillOverride !== 'transparent') {
              inner.querySelectorAll('path, circle, ellipse, rect, polygon, polyline').forEach((el) => {
                const cur = String(el.getAttribute('fill') || '').trim();
                if (!cur || cur === 'currentColor' || cur === 'black' || cur === '#000' || cur === '#000000') {
                  el.setAttribute('fill', fillOverride);
                }
                const stroke = String(el.getAttribute('stroke') || '').trim();
                if (stroke === 'currentColor') el.setAttribute('stroke', fillOverride);
              });
            }
          }
        }
      } catch {
        /* keep empty hit box */
      }
    }

    tagNode(g, nodeId, 'svg', undefined, left, top, boxW, boxH);
    applyMeta(g, left, top, meta, boxW, boxH);
    applyNodeShadow(root, g, node);
    return g;
  }

  if (node.key === 'image') {
    const src = node.attrs?.src;
    const processing = String(node.attrs?.processStatus || '') === 'running';
    const { left, top } = nodeLeftTop(document, node);
    const boxW = Math.max(1, Number(node.width) || 100);
    const boxH = Math.max(1, Number(node.height) || 100);
    const meta = objectMeta(node);
    const cssFilter = String(node.attrs?.cssFilter || '').trim();
    const isGen = isImageGeneratorNode(node);
    // Generator plates are always sharp (artboard-like), even for older docs with radius attrs.
    const cornerR = isGen
      ? { tl: 0, tr: 0, br: 0, bl: 0 }
      : radiiFromAttrs(node.attrs);
    const clipD = roundedRectPath(boxW, boxH, cornerR);

    if (!src && !processing) {
      const g = appendChild(parent, svgEl('g'));
      const plate = appendChild(g, svgEl('path', { d: clipD }));
      // Generator empty uses --gen-empty (light: cool wash #e9eaee; dark: raised surface).
      setFill(plate, isGen ? 'var(--gen-empty)' : '#E5E7EB');
      if (isGen) {
        // Border drawn inset so the painted outer edge === path geom === pixel grid
        // (center stroke would sit ink on *.5 and look like "half a cell").
        setStroke(plate, 'none');
        const sw = editorChromeStrokeSceneWidth(1);
        const inset = sw / 2;
        const border = appendChild(
          g,
          svgEl('path', {
            d: roundedRectPath(Math.max(1, boxW - sw), Math.max(1, boxH - sw), cornerR),
            transform: `translate(${inset},${inset})`,
            'pointer-events': 'none',
          })
        );
        setFill(border, 'none');
        setStroke(border, { color: 'var(--line)', width: sw });
      } else {
        setStroke(plate, {
          color: '#9CA3AF',
          width: editorChromeStrokeSceneWidth(1.5),
          dasharray: '6 4',
        });
      }
      setAttrs(plate, { 'data-radius-body': '1', 'data-baseline': '1' });
      if (isGen) {
        // Solid landscape glyph (sun + two peaks) — flat fill, no frame.
        // Scale with the plate; must fit inside (never a fixed 72 scene-px floor).
        const iconSize = generatorEmptyIconSize(boxW, boxH);
        if (iconSize >= 4) {
        const ix = (boxW - iconSize) / 2;
        const iy = (boxH - iconSize) / 2;
        const s = iconSize / 24;
        const icon = appendChild(
          g,
          svgEl('g', {
            transform: `translate(${ix},${iy}) scale(${s})`,
            'pointer-events': 'none',
          })
        );
        // Sun (upper-right)
        const sun = appendChild(
          icon,
          svgEl('circle', { cx: 16.5, cy: 7.5, r: 2.25 })
        );
        setFill(sun, 'var(--muted)');
        setStroke(sun, 'none');
        // Twin peaks silhouette
        const peaks = appendChild(
          icon,
          svgEl('path', {
            d: 'M3.5 18.5 L9.2 10.2 L13.1 15.1 L16.4 11.4 L20.5 18.5 Z',
          })
        );
        setFill(peaks, 'var(--muted)');
        setStroke(peaks, 'none');
        }
      } else {
        const wash = appendChild(
          g,
          svgEl('rect', {
            x: 8,
            y: 8,
            width: Math.max(1, boxW - 16),
            height: Math.max(1, boxH - 16),
            'pointer-events': 'none',
          })
        );
        setFill(wash, '#F9FAFB');
        setStroke(wash, 'none');
      }
      tagNode(g, nodeId, 'image', undefined, left, top, boxW, boxH);
      if (isGen || processing) setAttrs(g, { 'data-export-ignore': '1' });
      applyMeta(g, left, top, meta, boxW, boxH);
      return g;
    }

    if (processing) {
      const g = appendChild(parent, svgEl('g'));
      const kind = String(node.attrs?.processKind || '');
      const previewSrc =
        kind === 'upload' && src && String(src) !== TRANSPARENT_PIXEL_SRC ? String(src) : '';
      if (previewSrc) {
        const img = appendChild(
          g,
          svgEl('image', {
            width: boxW,
            height: boxH,
            x: 0,
            y: 0,
            // Fill the node box (like rects) — default SVG `meet` letterboxes.
            preserveAspectRatio: 'none',
          })
        );
        setSvgImageHref(img, previewSrc);
        if (cssFilter) setStyles(img, { filter: cssFilter });
        const overlay = appendChild(g, svgEl('path', { d: clipD }));
        setFill(overlay, 'rgba(185, 203, 218, 0.28)');
        // Screen hairline — fixed scene 1.5 blows up under camera scale and
        // reads as "selection larger than the photo" while uploading.
        setStroke(overlay, { color: '#A8C5E4', width: editorChromeStrokeSceneWidth(1.5) });
        setAttrs(overlay, {
          'pointer-events': 'none',
          'data-radius-body': '1',
          'data-baseline': '1',
        });
      } else {
        const gid = nextClipId('img-load');
        const defs = ensureDefs(root);
        const grad = svgEl('linearGradient', {
          id: gid,
          x1: '0%',
          y1: '50%',
          x2: '100%',
          y2: '50%',
        });
        grad.appendChild(svgEl('stop', { offset: '0', 'stop-color': '#B9CBDA' }));
        grad.appendChild(svgEl('stop', { offset: '0.55', 'stop-color': '#D5DEE6' }));
        grad.appendChild(svgEl('stop', { offset: '1', 'stop-color': '#E8ECF0' }));
        defs.appendChild(grad);
        const plate = appendChild(g, svgEl('path', { d: clipD }));
        setFill(plate, urlRef(gid));
        setStroke(plate, { color: '#A8C5E4', width: editorChromeStrokeSceneWidth(1.5) });
        setAttrs(plate, { 'data-radius-body': '1', 'data-baseline': '1' });
      }

      tagNode(g, nodeId, 'image', undefined, left, top, boxW, boxH);
      // Process shimmer is editor chrome — never bake into export / cover clones.
      setAttrs(g, { 'data-export-ignore': '1' });
      applyMeta(g, left, top, meta, boxW, boxH);
      applyNodeShadow(root, g, node);
      rememberSceneCornerRadii(g, cornerR);
      return g;
    }

    const g = appendChild(parent, svgEl('g'));
    const img = appendChild(
      g,
      svgEl('image', {
        width: boxW,
        height: boxH,
        x: 0,
        y: 0,
        // Stretch to the control box — same as shapes filling their bounds.
        // Default `xMidYMid meet` keeps photo aspect and leaves empty gutters.
        preserveAspectRatio: 'none',
      })
    );
    setSvgImageHref(img, String(src));
    const clipId = nextClipId('img-clip');
    const defs = ensureDefs(root);
    const clip = svgEl('clipPath', { id: clipId });
    const clipPath = svgEl('path', { d: clipD, 'data-radius-clip': '1' });
    clip.appendChild(clipPath);
    defs.appendChild(clip);
    setAttrs(img, { 'clip-path': urlRef(clipId) });
    setAttrs(g, { 'data-radius-clip-id': clipId });
    rememberSceneCornerRadii(g, cornerR);
    // Invisible baseline for host-mirrored selection chrome (clip path lives in defs).
    appendChild(
      g,
      svgEl('path', {
        d: clipD,
        fill: 'none',
        stroke: 'none',
        'pointer-events': 'none',
        'data-baseline': '1',
      })
    );
    tagNode(g, nodeId, 'image', undefined, left, top, boxW, boxH);
    if (isGen || isImageProcessRunning(node)) setAttrs(g, { 'data-export-ignore': '1' });
    applyMeta(g, left, top, meta, boxW, boxH);
    applyNodeShadow(root, g, node);
    if (cssFilter && cssFilter !== 'none') {
      const shadowFilter = String(g.style.filter || '').trim();
      const combined =
        shadowFilter && shadowFilter !== 'none' ? `${cssFilter} ${shadowFilter}` : cssFilter;
      setStyles(g, { filter: combined });
    }
    return g;
  }

  if (node.key === 'lottie' || isLottieNode(node) || isLottieGeneratorNode(node)) {
    const isGen = isLottieGeneratorNode(node);
    const hasData = Boolean(String(node.attrs?.animationData || '').trim());
    const processing = String(node.attrs?.processStatus || '') === 'running';
    const { left, top } = nodeLeftTop(document, node);
    const boxW = Math.max(1, Number(node.width) || 100);
    const boxH = Math.max(1, Number(node.height) || 100);
    const meta = objectMeta(node);
    const cornerR = isGen
      ? { tl: 0, tr: 0, br: 0, bl: 0 }
      : radiiFromAttrs(node.attrs);
    const clipD = roundedRectPath(boxW, boxH, cornerR);
    const g = appendChild(parent, svgEl('g'));
    const svgOwnsPixels = videoSvgOwnsPixels(root);
    const rawLottieFill = String(node.attrs?.['fill-color'] || node.attrs?.fill || '').trim();
    // Default surface plate — map empty/transparent to theme surface (not black).
    const plateFill = resolveThemeSurfaceFill(
      !rawLottieFill || rawLottieFill === 'transparent' ? '' : rawLottieFill
    );

    // Same process plate as image/video — shimmer chrome overlays this node.
    if (processing) {
      const plate = appendChild(g, svgEl('path', { d: clipD }));
      setFill(plate, '#B9CBDA');
      setStroke(plate, { color: '#A8C5E4', width: editorChromeStrokeSceneWidth(1.5) });
      setAttrs(plate, { 'data-radius-body': '1', 'data-baseline': '1' });
      rememberSceneCornerRadii(g, cornerR);
      tagNode(g, nodeId, 'lottie', undefined, left, top, boxW, boxH);
      setAttrs(g, { 'data-export-ignore': '1' });
      applyMeta(g, left, top, meta, boxW, boxH);
      applyNodeShadow(root, g, node);
      return g;
    }

    if (isGen || !hasData) {
      const plate = appendChild(g, svgEl('path', { d: clipD }));
      setFill(plate, isGen ? 'var(--gen-empty)' : '#E5E7EB');
      if (isGen) {
        setStroke(plate, 'none');
        const sw = editorChromeStrokeSceneWidth(1);
        const inset = sw / 2;
        const border = appendChild(
          g,
          svgEl('path', {
            d: roundedRectPath(Math.max(1, boxW - sw), Math.max(1, boxH - sw), cornerR),
            transform: `translate(${inset},${inset})`,
            'pointer-events': 'none',
          })
        );
        setFill(border, 'none');
        setStroke(border, { color: 'var(--line)', width: sw });
        // Soft play mark — same empty-plate language as video generator (title keeps clapperboard).
        const iconSize = generatorEmptyIconSize(boxW, boxH);
        if (iconSize >= 4) {
          const ix = (boxW - iconSize) / 2;
          const iy = (boxH - iconSize) / 2;
          const s = iconSize / 24;
          const icon = appendChild(
            g,
            svgEl('g', {
              transform: `translate(${ix},${iy}) scale(${s})`,
              'pointer-events': 'none',
            })
          );
          const play = appendChild(
            icon,
            svgEl('path', {
              d: 'M9 7.2 L9 16.8 L17.4 12 Z',
              'stroke-linejoin': 'round',
              'stroke-linecap': 'round',
            })
          );
          setFill(play, 'var(--muted)');
          setStroke(play, { color: 'var(--muted)', width: 2.75 });
        }
      } else {
        setStroke(plate, {
          color: '#9CA3AF',
          width: editorChromeStrokeSceneWidth(1.5),
          dasharray: '6 4',
        });
      }
      setAttrs(plate, { 'data-radius-body': '1', 'data-baseline': '1' });
      rememberSceneCornerRadii(g, cornerR);
      tagNode(g, nodeId, 'lottie', undefined, left, top, boxW, boxH);
      if (isGen || isImageProcessRunning(node)) setAttrs(g, { 'data-export-ignore': '1' });
      applyMeta(g, left, top, meta, boxW, boxH);
      return g;
    }

    // Plate fill under HTML ink (foreignObject). Export keeps SVG-only pixels.
    const plate = appendChild(g, svgEl('path', { d: clipD }));
    setFill(plate, plateFill);
    setStroke(plate, 'none');
    setAttrs(plate, {
      'data-radius-body': '1',
      'data-baseline': '1',
      ...(!svgOwnsPixels ? { 'data-rcb-lottie-html-hit': '1' } : {}),
    });
    if (!svgOwnsPixels) {
      appendHtmlMediaMount(g, { nodeId, width: boxW, height: boxH, kind: 'lottie' });
    }
    rememberSceneCornerRadii(g, cornerR);
    tagNode(g, nodeId, 'lottie', undefined, left, top, boxW, boxH);
    applyMeta(g, left, top, meta, boxW, boxH);
    applyNodeShadow(root, g, node);
    return g;
  }

  if (node.key === 'video') {
    const src = String(node.attrs?.src || '').trim();
    const poster = String(node.attrs?.poster || '').trim();
    const processing = String(node.attrs?.processStatus || '') === 'running';
    const { left, top } = nodeLeftTop(document, node);
    const boxW = Math.max(1, Number(node.width) || 100);
    const boxH = Math.max(1, Number(node.height) || 100);
    const meta = objectMeta(node);
    const isGen = isVideoGeneratorNode(node);
    const cornerR = isGen
      ? { tl: 0, tr: 0, br: 0, bl: 0 }
      : radiiFromAttrs(node.attrs);
    const clipD = roundedRectPath(boxW, boxH, cornerR);

    if (!src && !processing) {
      const g = appendChild(parent, svgEl('g'));
      const plate = appendChild(g, svgEl('path', { d: clipD }));
      setFill(plate, isGen ? 'var(--gen-empty)' : '#E5E7EB');
      if (isGen) {
        setStroke(plate, 'none');
        const sw = editorChromeStrokeSceneWidth(1);
        const inset = sw / 2;
        const border = appendChild(
          g,
          svgEl('path', {
            d: roundedRectPath(Math.max(1, boxW - sw), Math.max(1, boxH - sw), cornerR),
            transform: `translate(${inset},${inset})`,
            'pointer-events': 'none',
          })
        );
        setFill(border, 'none');
        setStroke(border, { color: 'var(--line)', width: sw });
      } else {
        setStroke(plate, {
          color: '#9CA3AF',
          width: editorChromeStrokeSceneWidth(1.5),
          dasharray: '6 4',
        });
      }
      setAttrs(plate, { 'data-radius-body': '1', 'data-baseline': '1' });
      if (isGen) {
        // Soft play triangle only — no frame / plus.
        const iconSize = generatorEmptyIconSize(boxW, boxH);
        if (iconSize >= 4) {
        const ix = (boxW - iconSize) / 2;
        const iy = (boxH - iconSize) / 2;
        const s = iconSize / 24;
        const icon = appendChild(
          g,
          svgEl('g', {
            transform: `translate(${ix},${iy}) scale(${s})`,
            'pointer-events': 'none',
          })
        );
        const play = appendChild(
          icon,
          svgEl('path', {
            d: 'M9 7.2 L9 16.8 L17.4 12 Z',
            'stroke-linejoin': 'round',
            'stroke-linecap': 'round',
          })
        );
        setFill(play, 'var(--muted)');
        setStroke(play, { color: 'var(--muted)', width: 2.75 });
        }
      }
      tagNode(g, nodeId, 'video', undefined, left, top, boxW, boxH);
      if (isGen || processing) setAttrs(g, { 'data-export-ignore': '1' });
      applyMeta(g, left, top, meta, boxW, boxH);
      return g;
    }

    if (processing) {
      const g = appendChild(parent, svgEl('g'));
      const preview = poster || (src && !String(src).startsWith('blob:') ? '' : poster);
      if (preview) {
        const img = appendChild(
          g,
          svgEl('image', {
            width: boxW,
            height: boxH,
            x: 0,
            y: 0,
            preserveAspectRatio: 'none',
          })
        );
        setSvgImageHref(img, preview);
      } else {
        const plate = appendChild(g, svgEl('path', { d: clipD }));
        setFill(plate, '#B9CBDA');
        setStroke(plate, { color: '#A8C5E4', width: editorChromeStrokeSceneWidth(1.5) });
        setAttrs(plate, { 'data-radius-body': '1' });
      }
      tagNode(g, nodeId, 'video', undefined, left, top, boxW, boxH);
      setAttrs(g, { 'data-export-ignore': '1' });
      applyMeta(g, left, top, meta, boxW, boxH);
      applyNodeShadow(root, g, node);
      rememberSceneCornerRadii(g, cornerR);
      return g;
    }

    const g = appendChild(parent, svgEl('g'));
    // Infinite editor: SVG poster/underlay + HTML <video> in foreignObject.
    // Both ride the same group transform during drag (previewSvgNodeGeometry).
    // Do not hide HTML globally while transforming — freeze frames live only in
    // HTML; blanking it left a dark underlay and blanked unrelated videos on
    // any geometry gesture. Export boards still use SVG-only pixels.
    const svgOwnsPixels = videoSvgOwnsPixels(root);
    const crop = readNodeCropNorm(node);
    if (poster) {
      const imgW = crop ? boxW / crop.w : boxW;
      const imgH = crop ? boxH / crop.h : boxH;
      const imgX = crop ? (-crop.x / crop.w) * boxW : 0;
      const imgY = crop ? (-crop.y / crop.h) * boxH : 0;
      const img = appendChild(
        g,
        svgEl('image', {
          width: imgW,
          height: imgH,
          x: imgX,
          y: imgY,
          preserveAspectRatio: 'none',
          'data-rcb-video-svg-underlay': '1',
        })
      );
      setSvgImageHref(img, poster);
      const clipId = nextClipId('vid-clip');
      const defs = ensureDefs(root);
      const clip = svgEl('clipPath', { id: clipId });
      clip.appendChild(svgEl('path', { d: clipD, 'data-radius-clip': '1' }));
      defs.appendChild(clip);
      setAttrs(img, { 'clip-path': urlRef(clipId) });
      setAttrs(g, { 'data-radius-clip-id': clipId });
      appendChild(
        g,
        svgEl('path', {
          d: clipD,
          fill: 'none',
          stroke: 'none',
          'pointer-events': 'none',
          'data-baseline': '1',
          ...(!svgOwnsPixels ? { 'data-rcb-video-html-hit': '1' } : {}),
        })
      );
    } else {
      const plate = appendChild(g, svgEl('path', { d: clipD }));
      setFill(plate, '#111827');
      setStroke(plate, 'none');
      setAttrs(plate, {
        'data-radius-body': '1',
        'data-baseline': '1',
        'data-rcb-video-svg-underlay': '1',
        ...(!svgOwnsPixels ? { 'data-rcb-video-html-hit': '1' } : {}),
      });
    }
    void src;
    if (!svgOwnsPixels && src) {
      appendHtmlMediaMount(g, { nodeId, width: boxW, height: boxH, kind: 'video' });
    }
    rememberSceneCornerRadii(g, cornerR);
    tagNode(g, nodeId, 'video', undefined, left, top, boxW, boxH);
    if (isGen || isImageProcessRunning(node)) setAttrs(g, { 'data-export-ignore': '1' });
    applyMeta(g, left, top, meta, boxW, boxH);
    applyNodeShadow(root, g, node);
    return g;
  }

  if (node.key === 'audio' || isAudioNode(node) || isAudioGeneratorNode(node)) {
    const isGen = isAudioGeneratorNode(node);
    const hasSrc = Boolean(String(node.attrs?.src || '').trim());
    const processing = String(node.attrs?.processStatus || '') === 'running';
    const { left, top } = nodeLeftTop(document, node);
    const boxW = Math.max(1, Number(node.width) || 100);
    const boxH = Math.max(1, Number(node.height) || 100);
    const meta = objectMeta(node);
    const cornerR = isGen
      ? { tl: 0, tr: 0, br: 0, bl: 0 }
      : radiiFromAttrs(node.attrs);
    const clipD = roundedRectPath(boxW, boxH, cornerR);
    const g = appendChild(parent, svgEl('g'));
    const svgOwnsPixels = videoSvgOwnsPixels(root);
    const plateFill = resolveThemeSurfaceFill(
      node.attrs?.['fill-color'] || node.attrs?.fill
    );

    if (processing) {
      const plate = appendChild(g, svgEl('path', { d: clipD }));
      setFill(plate, '#B9CBDA');
      setStroke(plate, { color: '#A8C5E4', width: editorChromeStrokeSceneWidth(1.5) });
      setAttrs(plate, { 'data-radius-body': '1', 'data-baseline': '1' });
      rememberSceneCornerRadii(g, cornerR);
      tagNode(g, nodeId, 'audio', undefined, left, top, boxW, boxH);
      setAttrs(g, { 'data-export-ignore': '1' });
      applyMeta(g, left, top, meta, boxW, boxH);
      applyNodeShadow(root, g, node);
      return g;
    }

    if (isGen || !hasSrc) {
      const plate = appendChild(g, svgEl('path', { d: clipD }));
      setFill(plate, isGen ? 'var(--gen-empty)' : 'var(--rail)');
      if (isGen) {
        setStroke(plate, 'none');
        const sw = editorChromeStrokeSceneWidth(1);
        const inset = sw / 2;
        const border = appendChild(
          g,
          svgEl('path', {
            d: roundedRectPath(Math.max(1, boxW - sw), Math.max(1, boxH - sw), cornerR),
            transform: `translate(${inset},${inset})`,
            'pointer-events': 'none',
          })
        );
        setFill(border, 'none');
        setStroke(border, { color: 'var(--line)', width: sw });
        const iconSize = generatorEmptyIconSize(boxW, boxH);
        if (iconSize >= 4) {
          const ix = (boxW - iconSize) / 2;
          const iy = (boxH - iconSize) / 2;
          const s = iconSize / 24;
          const icon = appendChild(
            g,
            svgEl('g', {
              transform: `translate(${ix},${iy}) scale(${s})`,
              'pointer-events': 'none',
            })
          );
          // Simple waveform mark for empty audio generator.
          for (const [x, h] of [
            [6, 8],
            [10, 14],
            [14, 10],
            [18, 16],
          ] as const) {
            const bar = appendChild(
              icon,
              svgEl('rect', {
                x,
                y: 12 - h / 2,
                width: 2.2,
                height: h,
                rx: 1,
              })
            );
            setFill(bar, 'var(--muted)');
            setStroke(bar, 'none');
          }
        }
      } else {
        setStroke(plate, {
          color: 'var(--line)',
          width: editorChromeStrokeSceneWidth(1),
        });
      }
      setAttrs(plate, { 'data-radius-body': '1', 'data-baseline': '1' });
      rememberSceneCornerRadii(g, cornerR);
      tagNode(g, nodeId, 'audio', undefined, left, top, boxW, boxH);
      if (isGen || isImageProcessRunning(node)) setAttrs(g, { 'data-export-ignore': '1' });
      applyMeta(g, left, top, meta, boxW, boxH);
      return g;
    }

    // Finished audio: SVG plate + decorative waveform (HTML overlay covers while idle;
    // geometryOverrides keep HTML glued during drag).
    const plate = appendChild(g, svgEl('path', { d: clipD }));
    setFill(plate, plateFill);
    setStroke(plate, 'none');
    setAttrs(plate, {
      'data-radius-body': '1',
      'data-baseline': '1',
      'data-rcb-audio-svg-underlay': '1',
      ...(!svgOwnsPixels ? { 'data-rcb-audio-html-hit': '1' } : {}),
    });
    const padX = Math.max(8, boxW * 0.04);
    const padY = Math.max(8, boxH * 0.12);
    const railW = Math.max(1, boxW - padX * 2);
    const railH = Math.max(1, boxH * 0.55);
    const railX = padX;
    const railY = Math.max(padY, (boxH - railH) * 0.38);
    const rail = appendChild(
      g,
      svgEl('rect', {
        x: railX,
        y: railY,
        width: railW,
        height: railH,
        rx: Math.min(12, railH * 0.18),
        'pointer-events': 'none',
      })
    );
    setFill(rail, 'var(--rail)');
    setStroke(rail, 'none');
    const barCount = Math.max(12, Math.min(48, Math.floor(railW / 6)));
    const gap = 2;
    const barW = Math.max(1.5, (railW - gap * (barCount - 1)) / barCount);
    const midY = railY + railH / 2;
    for (let i = 0; i < barCount; i++) {
      const t = i / Math.max(1, barCount - 1);
      const hump = Math.sin(t * Math.PI) * 0.55 + 0.25;
      const wobble = 0.35 + 0.65 * Math.abs(Math.sin(i * 2.7 + boxW * 0.01));
      const h = Math.max(4, railH * 0.72 * hump * wobble);
      const bar = appendChild(
        g,
        svgEl('rect', {
          x: railX + i * (barW + gap),
          y: midY - h / 2,
          width: barW,
          height: h,
          rx: Math.min(2, barW / 2),
          'pointer-events': 'none',
        })
      );
      setFill(bar, 'var(--muted)');
      setStroke(bar, 'none');
      setAttrs(bar, { opacity: '0.55' });
    }
    if (!svgOwnsPixels && hasSrc) {
      appendHtmlMediaMount(g, { nodeId, width: boxW, height: boxH, kind: 'audio' });
    }
    rememberSceneCornerRadii(g, cornerR);
    tagNode(g, nodeId, 'audio', undefined, left, top, boxW, boxH);
    applyMeta(g, left, top, meta, boxW, boxH);
    applyNodeShadow(root, g, node);
    return g;
  }

  return null;
}

export function applyInfiniteSvgViewport(root: SVGSVGElement) {
  setAttrs(root, {
    width: 1,
    height: 1,
    viewBox: '0 0 1 1',
    overflow: 'visible',
    preserveAspectRatio: 'none',
    'shape-rendering': 'geometricPrecision',
    'pointer-events': 'none',
    'data-rcb-infinite': '1',
  });
  setStyles(root, {
    display: 'block',
    overflow: 'visible',
    position: 'absolute',
    left: '0',
    top: '0',
    width: '1px',
    height: '1px',
    'pointer-events': 'none',
  });
}

const INFINITE_SVG_PAD = 64;

function isInfiniteSvgRoot(root: SVGSVGElement) {
  return root.getAttribute('data-rcb-infinite') === '1';
}

/**
 * Whether SVG alone owns the visible video pixels (no HTML plate on top).
 * Infinite editor paints an SVG poster underlay AND mounts HTML `<video>` in
 * foreignObject — both move with the node group. Export surfaces keep SVG-only
 * pixels (no FO mount).
 */
export function videoSvgOwnsPixels(root: SVGSVGElement): boolean {
  if (!isInfiniteSvgRoot(root)) return true;
  if (root.getAttribute('data-rcb-export-surface') === '1') return true;
  return false;
}

type ViewportBox = { minX: number; minY: number; w: number; h: number };

/**
 * Infinite-SVG CSS box === viewBox.
 * Under fractional browser DPR, snap the origin onto the device-pixel lattice
 * (matched left + viewBox min) so sibling surfaces (grid / hosts) do not round
 * apart. Absolute scene content still maps to scene*zoom+cam.
 */
function snapSurfaceBox(
  box: ViewportBox,
  camera?: RcbCamera | null,
  dpr?: number
): ViewportBox {
  const w = Math.max(1, box.w);
  const h = Math.max(1, box.h);
  const cam = resolvePaintCamera(camera);
  const d = resolvePaintDpr(dpr);
  if (!cam || !rcbDprIsFractional(d)) {
    return { minX: box.minX, minY: box.minY, w, h };
  }
  const z = rcbCameraCssZoom(cam);
  const { x: camX, y: camY } = rcbCameraScreenOffset(cam, d);
  return {
    minX: rcbSnapSceneSurfaceOrigin(box.minX, z, camX, d),
    minY: rcbSnapSceneSurfaceOrigin(box.minY, z, camY, d),
    w,
    h,
  };
}

function writeInfiniteViewport(
  root: SVGSVGElement,
  snapped: ViewportBox,
  opts?: { lock?: boolean; intent?: ViewportBox }
) {
  const intent = opts?.intent ?? snapped;
  const { minX, minY, w, h } = snapped;
  const attrs: Record<string, string | number> = {
    width: w,
    height: h,
    viewBox: `${minX} ${minY} ${w} ${h}`,
    overflow: 'visible',
    preserveAspectRatio: 'none',
    'shape-rendering': 'geometricPrecision',
    'pointer-events': 'none',
    'data-rcb-infinite': '1',
    // Pre-snap scene intent — re-snap when browser DPR / camera changes.
    'data-rcb-surface-x': intent.minX,
    'data-rcb-surface-y': intent.minY,
    'data-rcb-surface-w': intent.w,
    'data-rcb-surface-h': intent.h,
  };
  if (opts?.lock) attrs['data-rcb-viewport-locked'] = '1';
  setAttrs(root, attrs);
  setStyles(root, {
    display: 'block',
    overflow: 'visible',
    position: 'absolute',
    left: `${minX}px`,
    top: `${minY}px`,
    width: `${w}px`,
    height: `${h}px`,
    'pointer-events': 'none',
  });
}

function readSurfaceIntent(root: SVGSVGElement): ViewportBox | null {
  const minX = Number(root.getAttribute('data-rcb-surface-x'));
  const minY = Number(root.getAttribute('data-rcb-surface-y'));
  const w = Number(root.getAttribute('data-rcb-surface-w'));
  const h = Number(root.getAttribute('data-rcb-surface-h'));
  if (![minX, minY, w, h].every(Number.isFinite) || !(w > 0) || !(h > 0)) return null;
  return { minX, minY, w, h };
}

/** Apply a known scene AABB as the infinite SVG CSS box + viewBox (pre-paint). */
export function seedInfiniteSvgViewport(
  root: SVGSVGElement,
  box: { left: number; top: number; width: number; height: number },
  pad = INFINITE_SVG_PAD
) {
  if (!isInfiniteSvgRoot(root)) return;
  const intent: ViewportBox = {
    minX: box.left - pad,
    minY: box.top - pad,
    w: Math.max(1, box.width) + pad * 2,
    h: Math.max(1, box.height) + pad * 2,
  };
  const seeded = snapSurfaceBox(intent);
  // Seed owns the viewport — getBBox fit must not nudge *.5 → integer.
  writeInfiniteViewport(root, seeded, { lock: true, intent });
}

/**
 * Pan an infinite host SVG with a live node translate (no getBBox refit).
 * No-op for shared world-surface hosts — ink moves via element transform;
 * the CSS box stays the camera viewport so it stays locked to the grid.
 */
export function panInfiniteSvgViewport(
  root: SVGSVGElement,
  dLeft: number,
  dTop: number
) {
  if (!isInfiniteSvgRoot(root)) return;
  if (root.getAttribute('data-rcb-world-surface') === '1') return;
  if (!(dLeft || dTop)) return;
  const intent = readSurfaceIntent(root);
  const parts = (root.getAttribute('viewBox') || '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length < 4 || !parts.every(Number.isFinite)) return;
  const base = intent || { minX: parts[0], minY: parts[1], w: parts[2], h: parts[3] };
  const nextIntent: ViewportBox = {
    minX: base.minX + dLeft,
    minY: base.minY + dTop,
    w: base.w,
    h: base.h,
  };
  const snapped = snapSurfaceBox(nextIntent);
  const lock = root.getAttribute('data-rcb-viewport-locked') === '1';
  writeInfiniteViewport(root, snapped, { lock: lock || undefined, intent: nextIntent });
}

/**
 * Bind host CSS/viewBox to the shared camera world viewport (same box as the
 * pixel grid). Falls back to re-snapping a per-host intent when stage size is
 * not known yet.
 */
export function snapInfiniteSvgViewportToCamera(
  root: SVGSVGElement,
  camera?: RcbCamera | null,
  dpr?: number
) {
  if (!isInfiniteSvgRoot(root)) return;
  if (camera) setInfiniteSvgPaintCamera(camera, dpr);
  const world = worldCameraViewport(camera, dpr);
  if (world) {
    const intent: ViewportBox = {
      minX: world.left,
      minY: world.top,
      w: world.width,
      h: world.height,
    };
    // Identical box for every host — do not per-origin fractional-shift.
    writeInfiniteViewport(root, intent, { lock: true, intent });
    root.setAttribute('data-rcb-world-surface', '1');
    return;
  }
  const parts = (root.getAttribute('viewBox') || '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length < 4 || !parts.every(Number.isFinite)) return;
  const intent =
    readSurfaceIntent(root) ||
    ({ minX: parts[0], minY: parts[1], w: parts[2], h: parts[3] } as ViewportBox);
  const next = snapSurfaceBox(intent, camera, dpr);
  if (
    next.minX === parts[0] &&
    next.minY === parts[1] &&
    next.w === parts[2] &&
    next.h === parts[3]
  ) {
    return;
  }
  const lock = root.getAttribute('data-rcb-viewport-locked') === '1';
  writeInfiniteViewport(root, next, { lock: lock || undefined, intent });
}

/** Pass-through scene CSS box sizes for React/DOM. Prefer applySceneSurface at call sites. */
export function snapSvgSurfaceBox(
  box: { left: number; top: number; width: number; height: number },
  camera?: RcbCamera | null,
  dpr?: number
): { left: number; top: number; width: number; height: number } {
  const next = snapSurfaceBox(
    { minX: box.left, minY: box.top, w: box.width, h: box.height },
    camera,
    dpr
  );
  return { left: next.minX, top: next.minY, width: next.w, height: next.h };
}

/**
 * World-layer surface: CSS left/top/width/height === viewBox in scene units.
 * Use for grid, AABB chrome, guides, draw previews.
 */
export function applySvgSurfaceBox(
  root: SVGSVGElement,
  box: { left: number; top: number; width: number; height: number },
  camera?: RcbCamera | null,
  dpr?: number
): { left: number; top: number; width: number; height: number } {
  const s = snapSvgSurfaceBox(box, camera, dpr);
  root.setAttribute('width', String(s.width));
  root.setAttribute('height', String(s.height));
  root.setAttribute('viewBox', `${s.left} ${s.top} ${s.width} ${s.height}`);
  root.setAttribute('overflow', 'visible');
  root.setAttribute('preserveAspectRatio', 'none');
  root.setAttribute('data-rcb-infinite', '1');
  root.style.position = 'absolute';
  root.style.overflow = 'visible';
  root.style.display = 'block';
  root.style.left = `${s.left}px`;
  root.style.top = `${s.top}px`;
  root.style.width = `${s.width}px`;
  root.style.height = `${s.height}px`;
  return s;
}

/** Alias — prefer this name at new call sites. */
export const applySceneSurface = applySvgSurfaceBox;

export type HostSurfaceSnapshot = {
  viewBox: string;
  left: string;
  top: string;
  width: string;
  height: string;
  attrWidth: string | null;
  attrHeight: string | null;
};

/** Read a mounted shape-host infinite SVG surface (CSS box + viewBox). */
export function readHostSurface(hostRoot: SVGSVGElement): HostSurfaceSnapshot | null {
  const viewBox = hostRoot.getAttribute('viewBox') || '';
  const left = hostRoot.style?.left || '';
  const top = hostRoot.style?.top || '';
  if (!viewBox || !left || !top) return null;
  return {
    viewBox,
    left,
    top,
    width: hostRoot.style.width || '',
    height: hostRoot.style.height || '',
    attrWidth: hostRoot.getAttribute('width'),
    attrHeight: hostRoot.getAttribute('height'),
  };
}

/**
 * Copy the shape host's CSS box + viewBox onto a chrome twin SVG
 * so path ink and chrome share one lattice under browser zoom.
 */
export function mirrorHostSurface(target: SVGSVGElement, hostRoot: SVGSVGElement): boolean {
  const s = readHostSurface(hostRoot);
  if (!s) return false;
  target.style.position = 'absolute';
  target.style.overflow = 'visible';
  target.style.display = 'block';
  target.style.left = s.left;
  target.style.top = s.top;
  target.style.width = s.width || hostRoot.style.width;
  target.style.height = s.height || hostRoot.style.height;
  if (s.attrWidth) target.setAttribute('width', s.attrWidth);
  if (s.attrHeight) target.setAttribute('height', s.attrHeight);
  target.setAttribute('viewBox', s.viewBox);
  target.setAttribute('overflow', 'visible');
  target.setAttribute('preserveAspectRatio', 'none');
  target.setAttribute('data-rcb-infinite', '1');
  return true;
}

/**
 * Grow an infinite SVG CSS box + viewBox by scene pad without re-snapping.
 * Needed so resize/rotate hits that sit outside the path geom still receive
 * pointer events (overflow:visible paints outside the box but does not hit-test).
 */
export function expandInfiniteSvgPad(root: SVGSVGElement, pad: number): boolean {
  const p = Math.max(0, Number(pad) || 0);
  if (p < 1e-9) return false;
  const parts = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (parts.length < 4 || parts.some((n) => !Number.isFinite(n))) return false;
  const [minX, minY, w, h] = parts;
  const left = minX - p;
  const top = minY - p;
  const width = Math.max(1e-4, w + p * 2);
  const height = Math.max(1e-4, h + p * 2);
  root.setAttribute('viewBox', `${left} ${top} ${width} ${height}`);
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  root.style.left = `${left}px`;
  root.style.top = `${top}px`;
  root.style.width = `${width}px`;
  root.style.height = `${height}px`;
  return true;
}

/**
 * Body `<g transform>` matching host ink.
 * `mirrored`: prefer live host `transform` / `__sceneLeft`; else box translate (+ rotate).
 */
export function hostChromeBodyTransform(
  el: SVGElement | null | undefined,
  box: { left: number; top: number; width: number; height: number },
  angleDeg: number,
  mirrored: boolean
): string {
  if (mirrored) {
    const hostTransform = el?.getAttribute?.('transform') || '';
    if (hostTransform) return hostTransform;
    const hl = Number((el as { __sceneLeft?: number } | null | undefined)?.__sceneLeft);
    const ht = Number((el as { __sceneTop?: number } | null | undefined)?.__sceneTop);
    const left = Number.isFinite(hl) ? hl : box.left;
    const top = Number.isFinite(ht) ? ht : box.top;
    return `translate(${left} ${top})`;
  }
  const w = Math.max(1, box.width);
  const h = Math.max(1, box.height);
  const angle = Number(angleDeg) || 0;
  if (Math.abs(angle) > 0.01) {
    return `translate(${box.left} ${box.top}) rotate(${angle} ${w / 2} ${h / 2})`;
  }
  return `translate(${box.left} ${box.top})`;
}

/** React props for a scene-surface SVG (CSS box === viewBox). */
export function sceneSurfaceSvgProps(
  box: { left: number; top: number; width: number; height: number },
  camera?: RcbCamera | null,
  dpr?: number
): {
  width: number;
  height: number;
  viewBox: string;
  style: {
    left: number;
    top: number;
    width: number;
    height: number;
    overflow: 'visible';
    display: 'block';
    shapeRendering: 'geometricPrecision';
  };
} {
  const s = snapSvgSurfaceBox(box, camera, dpr);
  return {
    width: s.width,
    height: s.height,
    viewBox: `${s.left} ${s.top} ${s.width} ${s.height}`,
    style: {
      left: s.left,
      top: s.top,
      width: s.width,
      height: s.height,
      overflow: 'visible',
      display: 'block',
      shapeRendering: 'geometricPrecision',
    },
  };
}

/** React props mirroring a host surface, or null when host is incomplete. */
export function hostMirrorSvgProps(hostRoot: SVGSVGElement): {
  viewBox: string;
  width: string | undefined;
  height: string | undefined;
  style: {
    left: string;
    top: string;
    width: string;
    height: string;
    overflow: 'visible';
    display: 'block';
    shapeRendering: 'geometricPrecision';
  };
} | null {
  const s = readHostSurface(hostRoot);
  if (!s) return null;
  return {
    viewBox: s.viewBox,
    width: s.attrWidth || undefined,
    height: s.attrHeight || undefined,
    style: {
      left: s.left,
      top: s.top,
      width: s.width || hostRoot.style.width,
      height: s.height || hostRoot.style.height,
      overflow: 'visible',
      display: 'block',
      shapeRendering: 'geometricPrecision',
    },
  };
}

export function fitInfiniteSvgToContent(root: SVGSVGElement, layer?: SVGElement | null) {
  if (!isInfiniteSvgRoot(root)) return;
  // Shared world surface — never shrink to content bbox (would desync from grid).
  if (root.getAttribute('data-rcb-world-surface') === '1') return;
  // Locked after seedInfiniteSvgViewport — preserve half-pixel origins for
  // odd center strokes (visual outer on integer grid). getBBox often reports
  // 269.5 as ~270 and used to rewrite CSS left, which browser zoom amplifies.
  if (root.getAttribute('data-rcb-viewport-locked') === '1') return;

  let minX = 0;
  let minY = 0;
  let w = 1;
  let h = 1;
  try {
    const target = (layer || root) as SVGGraphicsElement;
    const box = getBBox(target);
    if (
      Number.isFinite(box.x) &&
      Number.isFinite(box.y) &&
      Number.isFinite(box.width) &&
      Number.isFinite(box.height) &&
      (box.width > 0 || box.height > 0)
    ) {
      minX = box.x - INFINITE_SVG_PAD;
      minY = box.y - INFINITE_SVG_PAD;
      w = Math.max(1, box.width + INFINITE_SVG_PAD * 2);
      h = Math.max(1, box.height + INFINITE_SVG_PAD * 2);
    }
  } catch {
    /* empty layer */
  }

  // Keep a freshly seeded viewport when getBBox only nudges by ≤1px (common
  // 269.5→270 jump from stroke/getBBox). That half-pixel shift desyncs guides.
  const prevIntent = readSurfaceIntent(root);
  const prevMinX = prevIntent?.minX ?? parseFloat(root.style.left);
  const prevMinY = prevIntent?.minY ?? parseFloat(root.style.top);
  const prevW = prevIntent?.w ?? parseFloat(root.style.width);
  const prevH = prevIntent?.h ?? parseFloat(root.style.height);
  if (
    [prevMinX, prevMinY, prevW, prevH].every(Number.isFinite) &&
    Math.abs(minX - prevMinX) <= 1 &&
    Math.abs(minY - prevMinY) <= 1 &&
    Math.abs(w - prevW) <= 1 &&
    Math.abs(h - prevH) <= 1
  ) {
    return;
  }

  const intent: ViewportBox = { minX, minY, w, h };
  writeInfiniteViewport(root, snapSurfaceBox(intent), { intent });
}

export async function loadSceneOntoSvg(
  root: SVGSVGElement,
  layer: SVGElement,
  document: SceneDocument,
  loadSeq = 0,
  boardMeta?: { loadSeq?: number },
  opts?: { infinite?: boolean; /** Skip generators + process-shimmer plates (export / cover). */ omitNonExportable?: boolean; /** @deprecated use omitNonExportable */ omitImageGenerators?: boolean }
) {
  if (!root || !layer || !document?.deltaSetLike?.ROOT) {
    return new Map<string, SVGElement>();
  }

  const infinite = Boolean(opts?.infinite);
  const omitNonExportable = Boolean(opts?.omitNonExportable || opts?.omitImageGenerators);
  const w = Math.round(document.width || 794);
  const h = Math.round(document.height || 1123);
  if (infinite) {
    applyInfiniteSvgViewport(root);
  } else {
    setAttrs(root, { width: w, height: h, viewBox: `0 0 ${w} ${h}` });
  }
  clearChildren(layer);

  const docBg = resolveDocumentBackground(document);
  if (!infinite && !isTransparentFill(docBg)) {
    const bg = appendChild(layer, svgEl('rect', { x: 0, y: 0, width: w, height: h }));
    setAttrs(bg, { 'data-scene-bg': '1', 'pointer-events': 'none' });
    applySvgFill(root, bg, docBg, 'doc-bg');
  }

  const children: string[] = document.deltaSetLike.ROOT.children || [];
  const nodeEls = new Map<string, SVGElement>();

  for (const nodeId of children) {
    if (boardMeta && loadSeq && boardMeta.loadSeq !== loadSeq) return nodeEls;
    const node = document.deltaSetLike[nodeId];
    if (omitNonExportable ? !isExportableSceneNode(node) : isNodeHidden(node)) continue;
    try {
      const el = await nodeToSvgElement(root, layer, document, node, nodeId);
      if (boardMeta && loadSeq && boardMeta.loadSeq !== loadSeq) {
        el?.remove();
        return nodeEls;
      }
      if (el) {
        applyFrameContentClip(root, el, document, node);
        nodeEls.set(nodeId, el);
      }
    } catch (err) {
      console.error('nodeToSvgElement failed', nodeId, err);
    }
  }

  if (infinite) fitInfiniteSvgToContent(root, layer);
  return nodeEls;
}

export function dedupeSceneNode(layer: SVGElement, nodeId: string, keep?: SVGElement | null) {
  try {
    const matches = [...layer.querySelectorAll('[data-scene-node-id]')].filter(
      (n) => n.getAttribute('data-scene-node-id') === nodeId
    );
    if (matches.length <= 1) return;
    const survivor = keep && matches.includes(keep) ? keep : matches[matches.length - 1];
    matches.forEach((n) => {
      if (n === survivor) return;
      detachSceneNodeEl(n);
    });
  } catch {
    /* ignore */
  }
}

export function purgeOrphanSceneNodes(
  layer: SVGElement,
  nodeEls: Map<string, SVGElement>,
  validIds?: Iterable<string>
) {
  try {
    const allowed = validIds ? new Set(validIds) : null;
    layer.querySelectorAll('[data-scene-node-id]').forEach((n) => {
      const id = n.getAttribute('data-scene-node-id');
      if (!id) return;
      if (allowed && !allowed.has(id)) {
        detachSceneNodeEl(n);
        return;
      }
      const keep = nodeEls.get(id);
      if (keep && n !== keep) {
        detachSceneNodeEl(n);
      }
    });
  } catch {
    /* ignore */
  }
}

function setPathD(target: Element | null | undefined, d: string): boolean {
  if (!target || !d) return false;
  target.setAttribute('d', d);
  // Keep outside-stroke underlay in sync (sibling behind the filled body).
  const parent = target.parentElement;
  if (parent) {
    parent.querySelectorAll(':scope > [data-stroke-under="1"]').forEach((u) => {
      u.setAttribute('d', d);
    });
  }
  const prev = target.previousElementSibling;
  if (prev instanceof Element && prev.getAttribute('data-stroke-under') === '1') {
    prev.setAttribute('d', d);
  }
  return true;
}

export function clearSceneDragPreview(nodeEls: Map<string, SVGElement>, nodeId: string) {
  const el = nodeEls.get(nodeId);
  if (!el) return;
  const bag = asHost(el);
  delete bag.__sceneDragBaseW;
  delete bag.__sceneDragBaseH;
  delete bag.__sceneDragBaseFontSize;
  delete bag.__sceneDragBaseLetterSpacing;
  delete bag.__sceneDidResize;
}

function previewResizeText(
  el: SVGElement,
  box: { left: number; top: number; width: number; height: number },
  options?: {
    textResizeMode?: 'scale' | 'wrap';
    plainText?: string;
    textStyle?: ReturnType<typeof parseNodeTextStyle>;
  }
): boolean {
  const anyEl = asHost(el);
  if (String(anyEl.sceneNodeKey || '') !== 'text') return false;

  const geom = readGeom(el);
  if (!geom) return false;

  if (!anyEl.__sceneDragBaseW) {
    anyEl.__sceneDragBaseW = geom.width;
    anyEl.__sceneDragBaseH = geom.height;
    let fontSize = Number(anyEl.__sceneFontSize);
    if (!(fontSize > 0)) {
      fontSize = Number(String(el.getAttribute('font-size') || '').replace(/px$/i, '')) || 14;
    }
    anyEl.__sceneDragBaseFontSize = fontSize;
    const lsRaw = String(el.getAttribute('letter-spacing') || '0').replace(/px$/i, '');
    anyEl.__sceneDragBaseLetterSpacing = Number(lsRaw) || 0;
  }

  const bh = Math.max(1, Number(anyEl.__sceneDragBaseH) || geom.height);
  const baseFs = Math.max(1, Number(anyEl.__sceneDragBaseFontSize) || 14);
  const lineHeight = Math.max(0.8, Number(anyEl.__sceneLineHeight) || 1.4);
  const mode = options?.textResizeMode === 'wrap' ? 'wrap' : 'scale';
  const anchor = String(el.getAttribute('text-anchor') || 'start');
  const lineCount = Math.max(1, Number(anyEl.__sceneLineCount) || el.querySelectorAll('tspan').length || 1);
  const originY =
    anchor === 'middle'
      ? textVerticalOriginY(bh, baseFs, lineHeight, lineCount)
      : 0;

  let localX = 0;
  if (anchor === 'middle') localX = box.width / 2;
  else if (anchor === 'end') localX = box.width;

  if (mode === 'wrap') {
    const style = options?.textStyle || parseNodeTextStyle({});
    const plain =
      options?.plainText != null ? options.plainText : String(anyEl.__scenePlainText ?? '');
    const wrapStyle = { ...style, fontSize: baseFs };
    const lines = wrapPlainTextLines(plain || ' ', wrapStyle, Math.max(24, box.width));
    clearChildren(el);
    const dy = `${lineHeight}em`;
    lines.forEach((line, i) => {
      const tspan = svgEl('tspan', {
        x: localX,
        ...(i === 0 ? { y: originY } : { dy }),
      });
      tspan.textContent = line || ' ';
      el.appendChild(tspan);
    });
    setAttrs(el, {
      'font-family': toFabricFontFamily(style.fontFamily || wrapStyle.fontFamily),
      'font-size': baseFs,
      'font-weight': String(style.fontWeight || 'normal'),
      'font-style': style.fontStyle || 'normal',
      'text-anchor':
        style.textAlign === 'center' ? 'middle' : style.textAlign === 'right' ? 'end' : 'start',
      fill: hexWithOpacity(style.fill || '#333333', style.fillOpacity ?? 100),
      x: localX,
      y: originY,
      'dominant-baseline': 'text-before-edge',
      'alignment-baseline': 'before-edge',
    });
    anyEl.__sceneFontSize = baseFs;
    anyEl.__sceneLineCount = Math.max(1, lines.length);
    anyEl.__scenePlainText = plain;
    anyEl.__sceneDidResize = false;
    writeGeom(el, {
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      abs: false,
    });
    reapplySceneTransform(el, box.left, box.top, box.width, box.height);
    return true;
  }

  const sy = box.height / bh;
  const fontSize = Math.max(1, baseFs * sy);
  setAttrs(el, {
    'font-size': fontSize,
    x: localX,
    y: originY,
    'dominant-baseline': 'text-before-edge',
    'alignment-baseline': 'before-edge',
  });
  anyEl.__sceneFontSize = fontSize;

  const baseLs = Number(anyEl.__sceneDragBaseLetterSpacing) || 0;
  if (baseLs || el.getAttribute('letter-spacing') != null) {
    setAttrs(el, { 'letter-spacing': `${baseLs * sy}px` });
  }

  el.querySelectorAll('tspan').forEach((t, i) => {
    if (i === 0) {
      t.removeAttribute('dy');
      t.setAttribute('y', String(originY));
      t.removeAttribute('x');
    }
  });

  anyEl.__sceneDidResize = false;
  writeGeom(el, {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    abs: false,
  });
  reapplySceneTransform(el, box.left, box.top, box.width, box.height);
  return true;
}

function previewResizeImage(
  el: SVGElement,
  box: { left: number; top: number; width: number; height: number }
): boolean {
  const anyEl = asHost(el);
  const key = String(anyEl.sceneNodeKey || el.getAttribute('data-scene-node-key') || '');
  // Video / lottie / audio plates use the same poster/<image> (or path) group layout as images.
  if (key !== 'image' && key !== 'video' && key !== 'lottie' && key !== 'audio') {
    return false;
  }

  const geom = readGeom(el);
  if (!geom) return false;

  const w = Math.max(1, box.width);
  const h = Math.max(1, box.height);
  const EPS = 1e-3;
  const sameSize =
    Math.abs(geom.width - w) < EPS && Math.abs(geom.height - h) < EPS;

  // Pure translate — keep bitmap attrs; just move the group.
  if (sameSize && !anyEl.__sceneDidResize) {
    writeGeom(el, {
      left: box.left,
      top: box.top,
      width: w,
      height: h,
      abs: false,
    });
    reapplySceneTransform(el, box.left, box.top, w, h);
    return true;
  }

  // Live resize: scale the group (same as svg/custom-path nodes). Mutating
  // <image width/height> alone does not reliably repaint under per-shape
  // infinite SVG hosts — the control box moves while the bitmap stays put.
  // Final size is baked via replaceShapePaint on commit.
  if (!anyEl.__sceneDragBaseW) {
    anyEl.__sceneDragBaseW = geom.width;
    anyEl.__sceneDragBaseH = geom.height;
  }
  anyEl.__sceneDidResize = true;
  const bw = Math.max(1, Number(anyEl.__sceneDragBaseW) || geom.width);
  const bh = Math.max(1, Number(anyEl.__sceneDragBaseH) || geom.height);

  writeGeom(el, {
    left: box.left,
    top: box.top,
    width: w,
    height: h,
    abs: false,
  });
  reapplySceneTransformScaled(el, box.left, box.top, bw, bh, w / bw, h / bh);
  return true;
}

export function previewSvgNodeAngle(
  nodeEls: Map<string, SVGElement>,
  nodeId: string,
  angleDeg: number,
  _sceneDocument?: SceneDocument | null
): boolean {
  const el = nodeEls.get(nodeId);
  if (!el) return false;
  const geom = readGeom(el);
  if (!geom) return false;

  const anyEl = asHost(el);
  anyEl.__sceneAngle = angleDeg;
  const baseW = Number(anyEl.__sceneDragBaseW);
  const baseH = Number(anyEl.__sceneDragBaseH);
  if (anyEl.__sceneDidResize && baseW > 0 && baseH > 0) {
    reapplySceneTransformScaled(
      el,
      geom.left,
      geom.top,
      baseW,
      baseH,
      geom.width / baseW,
      geom.height / baseH
    );
  } else {
    reapplySceneTransform(el, geom.left, geom.top, geom.width, geom.height);
  }
  return true;
}

function reapplySceneTransformScaled(
  el: SVGElement,
  left: number,
  top: number,
  baseW: number,
  baseH: number,
  sx: number,
  sy: number
) {
  const anyEl = asHost(el);
  const angle = Number(anyEl.__sceneAngle) || 0;
  const flipX = !!anyEl.__sceneFlipX;
  const flipY = !!anyEl.__sceneFlipY;
  const geom = readGeom(el);
  const abs = geom ? geom.abs : !!anyEl.__sceneAbsPos;
  const parts: string[] = [];

  if (!abs) {
    parts.push(`translate(${left} ${top})`);
    if (Math.abs(sx - 1) > 1e-4 || Math.abs(sy - 1) > 1e-4) {
      parts.push(`scale(${sx} ${sy})`);
    }
  }

  const rx = abs ? left + (baseW * sx) / 2 : baseW / 2;
  const ry = abs ? top + (baseH * sy) / 2 : baseH / 2;
  if (angle) parts.push(`rotate(${angle} ${rx} ${ry})`);
  if (flipX || flipY) {
    const fsx = flipX ? -1 : 1;
    const fsy = flipY ? -1 : 1;
    parts.push(`translate(${rx} ${ry}) scale(${fsx} ${fsy}) translate(${-rx} ${-ry})`);
  }

  if (parts.length) setAttrs(el, { transform: parts.join(' ') });
  else el.removeAttribute('transform');
  syncStrokeUnderlayTransform(el);
}

function previewResizeLocalGeometry(el: SVGElement, width: number, height: number): boolean {
  const anyEl = asHost(el);
  const shapeType = String(
    anyEl.sceneShapeType || el.getAttribute('data-scene-shape-type') || ''
  );

  if (isCustomPathShape(shapeType)) return false;

  if (shapeType === 'line') {
    const mid = Math.max(1, height) / 2;
    setAttrs(el, { x1: 0, y1: mid, x2: width, y2: mid });
    return true;
  }

  if (shapeType === 'arrow') {
    const d =
      getShapeBaselineD({
        key: 'shape',
        width,
        height,
        attrs: { shapeType: 'arrow' },
      }) || '';
    if (el.tagName.toLowerCase() === 'path') return setPathD(el, d);
    return false;
  }

  if (shapeType === 'circle') {
    const live = readSceneEllipseParams(el);
    const d =
      getShapeBaselineD({
        key: 'shape',
        width,
        height,
        attrs: {
          shapeType: 'circle',
          ellipseInnerRatio: live.innerRatio,
          ellipseArcPercent: live.arcPercent,
          ellipseStartDeg: live.startDeg,
        },
      }) || '';
    const body =
      el.tagName.toLowerCase() === 'path'
        ? el
        : el.querySelector('[data-baseline="1"]') ||
          el.querySelector('path:not([data-stroke-under])');
    if (live.innerRatio > 1e-4 && body instanceof Element) {
      body.setAttribute('fill-rule', 'evenodd');
    } else if (body instanceof Element) {
      body.removeAttribute('fill-rule');
    }
    if (el.tagName.toLowerCase() === 'path') return setPathD(el, d);
    return setPathD(body, d);
  }

  const liveR = clampCornerRadii(readSceneCornerRadii(el), width, height);

  if (shapeType === 'triangle' || shapeType === 'star' || shapeType === 'polygon') {
    const d =
      getShapeBaselineD({
        key: 'shape',
        width,
        height,
        attrs: {
          shapeType,
          sides: readSceneSides(el),
          radiusTL: liveR.tl,
          radiusTR: liveR.tr,
          radiusBR: liveR.br,
          radiusBL: liveR.bl,
        },
      }) || roundedShapePath(shapeType, width, height, liveR, readSceneSides(el));
    if (el.tagName.toLowerCase() === 'path') return setPathD(el, d);
    return setPathD(el.querySelector('path'), d);
  }

  if (shapeType === 'rect' || shapeType === 'roundRect' || shapeType === '') {
    // Must keep cached corner radii — zeroR made move/resize flash a sharp rect.
    const d = roundedRectPath(width, height, liveR);
    if (el.tagName.toLowerCase() === 'path') return setPathD(el, d);
    // Prefer the filled baseline body (not the stroke underlay).
    const body =
      el.querySelector(':scope > [data-baseline="1"]') ||
      el.querySelector(':scope > [data-radius-body="1"]:not([data-stroke-under])') ||
      el.querySelector(':scope > path:not([data-stroke-under])');
    return setPathD(body, d);
  }

  return false;
}

function dmoveAbs(el: SVGElement, dx: number, dy: number) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'line') {
    setAttrs(el, {
      x1: num(el.getAttribute('x1')) + dx,
      y1: num(el.getAttribute('y1')) + dy,
      x2: num(el.getAttribute('x2')) + dx,
      y2: num(el.getAttribute('y2')) + dy,
    });
    return;
  }
  if (el.hasAttribute('x') || el.hasAttribute('y')) {
    setAttrs(el, {
      x: num(el.getAttribute('x')) + dx,
      y: num(el.getAttribute('y')) + dy,
    });
  }
}

export function previewSvgNodeGeometry(
  nodeEls: Map<string, SVGElement>,
  nodeId: string,
  box: { left: number; top: number; width: number; height: number },
  options?: {
    textResizeMode?: 'scale' | 'wrap';
    plainText?: string;
    textStyle?: ReturnType<typeof parseNodeTextStyle>;
  }
): boolean {
  const el = nodeEls.get(nodeId);
  if (!el) return false;
  const anyEl = asHost(el);
  const nodeKey = String(anyEl.sceneNodeKey || el.getAttribute('data-scene-node-key') || '');

  if (nodeKey === 'image' || nodeKey === 'video' || nodeKey === 'lottie' || nodeKey === 'audio') {
    return previewResizeImage(el, box);
  }
  if (nodeKey === 'svg') {
    // Scale whole group like a custom path — content re-renders on commit.
    const geom = readGeom(el);
    if (!geom) return false;
    if (!anyEl.__sceneDragBaseW) {
      anyEl.__sceneDragBaseW = geom.width;
      anyEl.__sceneDragBaseH = geom.height;
    }
    anyEl.__sceneDidResize = true;
    const bw = Math.max(1, Number(anyEl.__sceneDragBaseW) || geom.width);
    const bh = Math.max(1, Number(anyEl.__sceneDragBaseH) || geom.height);
    writeGeom(el, {
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      abs: false,
    });
    reapplySceneTransformScaled(
      el,
      box.left,
      box.top,
      bw,
      bh,
      box.width / bw,
      box.height / bh
    );
    return true;
  }

  const geom = readGeom(el);
  if (!geom) return false;

  const EPS = 1e-3;
  const sameSize =
    Math.abs(geom.width - box.width) < EPS && Math.abs(geom.height - box.height) < EPS;
  const samePos =
    Math.abs(geom.left - box.left) < EPS && Math.abs(geom.top - box.top) < EPS;

  if (geom.abs && sameSize && !samePos) {
    const dx = box.left - geom.left;
    const dy = box.top - geom.top;
    if (dx || dy) dmoveAbs(el, dx, dy);
    writeGeom(el, { ...geom, left: box.left, top: box.top });
    const root = el.ownerSVGElement;
    if (root) panInfiniteSvgViewport(root, dx, dy);
    return true;
  }

  if (!geom.abs) {
    const shapeType = String(
      anyEl.sceneShapeType || el.getAttribute('data-scene-shape-type') || ''
    );
    const isStrokeShape = shapeType === 'line' || shapeType === 'arrow';
    const isText = String(anyEl.sceneNodeKey || el.getAttribute('data-scene-node-key') || '') === 'text';

    if (isText) {
      return previewResizeText(el, box, options);
    }

    // Custom path (boolean / pen): live resize is CSS scale from gesture base.
    // Keep that scale for the whole gesture — including when clamped at min size
    // (sameSize). Dropping it calls plain translate and the path flashes at 1:1.
    if (isCustomPathShape(shapeType) && (!sameSize || anyEl.__sceneDidResize)) {
      if (!anyEl.__sceneDragBaseW) {
        anyEl.__sceneDragBaseW = geom.width;
        anyEl.__sceneDragBaseH = geom.height;
      }
      anyEl.__sceneDidResize = true;
      const bw = Math.max(1, Number(anyEl.__sceneDragBaseW) || geom.width);
      const bh = Math.max(1, Number(anyEl.__sceneDragBaseH) || geom.height);
      writeGeom(el, {
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        abs: false,
      });
      reapplySceneTransformScaled(
        el,
        box.left,
        box.top,
        bw,
        bh,
        box.width / bw,
        box.height / bh
      );
      return true;
    }

    if (isStrokeShape) {
      if (!sameSize) anyEl.__sceneDidResize = true;
      writeGeom(el, {
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        abs: false,
      });
      if (!previewResizeLocalGeometry(el, box.width, box.height)) return false;
      reapplySceneTransform(el, box.left, box.top, box.width, box.height);
      return true;
    }

    writeGeom(el, {
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      abs: false,
    });
    // Pure move: only translate. Regenerating local `d` (even at same size) used
    // to wipe corner radii and flash a sharp rect until commit remounted.
    if (sameSize && !anyEl.__sceneDidResize) {
      const dLeft = box.left - geom.left;
      const dTop = box.top - geom.top;
      reapplySceneTransform(el, box.left, box.top, box.width, box.height);
      // Glue host viewBox to the translate so ink stays in-bounds (not overflow).
      const root = el.ownerSVGElement;
      if (root) panInfiniteSvgViewport(root, dLeft, dTop);
      return true;
    }
    if (previewResizeLocalGeometry(el, box.width, box.height)) {
      if (!sameSize) anyEl.__sceneDidResize = true;
      reapplySceneTransform(el, box.left, box.top, box.width, box.height);
      return true;
    }
    // Scale-preview shapes (fallback): same min-clamp rule as custom path.
    if (!sameSize || anyEl.__sceneDidResize) {
      if (!anyEl.__sceneDragBaseW) {
        anyEl.__sceneDragBaseW = geom.width;
        anyEl.__sceneDragBaseH = geom.height;
      }
      anyEl.__sceneDidResize = true;
      const bw = Math.max(1, Number(anyEl.__sceneDragBaseW) || geom.width);
      const bh = Math.max(1, Number(anyEl.__sceneDragBaseH) || geom.height);
      reapplySceneTransformScaled(
        el,
        box.left,
        box.top,
        bw,
        bh,
        box.width / bw,
        box.height / bh
      );
      return true;
    }
    reapplySceneTransform(el, box.left, box.top, box.width, box.height);
    return true;
  }

  if (geom.abs && sameSize && !anyEl.__sceneDidResize) {
    writeGeom(el, {
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      abs: geom.abs,
    });
    reapplySceneTransform(el, box.left, box.top, box.width, box.height);
    return true;
  }

  if (!sameSize || anyEl.__sceneDidResize) {
    if (!anyEl.__sceneDragBaseW) {
      anyEl.__sceneDragBaseW = geom.width;
      anyEl.__sceneDragBaseH = geom.height;
    }
    anyEl.__sceneDidResize = true;
    const bw = Math.max(1, Number(anyEl.__sceneDragBaseW) || geom.width);
    const bh = Math.max(1, Number(anyEl.__sceneDragBaseH) || geom.height);
    writeGeom(el, {
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      abs: geom.abs,
    });
    reapplySceneTransformScaled(
      el,
      box.left,
      box.top,
      bw,
      bh,
      box.width / bw,
      box.height / bh
    );
    return true;
  }

  writeGeom(el, {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    abs: geom.abs,
  });
  reapplySceneTransform(el, box.left, box.top, box.width, box.height);
  return true;
}

/**
 * Live circle / ellipse inner-radius + arc preview without remounting.
 */
export function previewSvgNodeEllipseParams(
  nodeEls: Map<string, SVGElement>,
  nodeId: string,
  opts: {
    width: number;
    height: number;
    innerRatio: number;
    arcPercent: number;
    startDeg?: number;
  }
): boolean {
  const el = nodeEls.get(nodeId);
  if (!el) return false;
  const w = Math.max(1, opts.width);
  const h = Math.max(1, opts.height);
  const innerRatio = clampEllipseInnerRatio(opts.innerRatio);
  const arcPercent = clampEllipseArcPercent(opts.arcPercent);
  const startDeg = clampEllipseStartDeg(opts.startDeg);
  const d =
    getShapeBaselineD({
      key: 'shape',
      width: w,
      height: h,
      attrs: {
        shapeType: 'circle',
        ellipseInnerRatio: innerRatio,
        ellipseArcPercent: arcPercent,
        ellipseStartDeg: startDeg,
      },
    }) || '';
  if (!d) return false;
  rememberSceneEllipseParams(el, innerRatio, arcPercent, startDeg);
  const body =
    el.tagName.toLowerCase() === 'path'
      ? el
      : el.querySelector(':scope > [data-baseline="1"]') ||
        el.querySelector(':scope > path:not([data-stroke-under])');
  if (body instanceof Element) {
    if (innerRatio > 1e-4) body.setAttribute('fill-rule', 'evenodd');
    else body.removeAttribute('fill-rule');
  }
  if (el.tagName.toLowerCase() === 'path') return setPathD(el, d);
  return setPathD(body, d);
}

/**
 * Live corner-radius preview without remounting the shape host.
 * (Redux skipHistory patches remount via documentPatchToken and can leave ghosts.)
 */
export function previewSvgNodeCornerRadii(
  nodeEls: Map<string, SVGElement>,
  nodeId: string,
  opts: {
    width: number;
    height: number;
    shapeType: string;
    radii: CornerRadii;
    attrs?: Record<string, unknown> | null;
    sides?: number;
  }
): boolean {
  const el = nodeEls.get(nodeId);
  if (!el) return false;
  const w = Math.max(1, opts.width);
  const h = Math.max(1, opts.height);
  const r = clampCornerRadii(opts.radii, w, h);
  const t = String(opts.shapeType || 'rect');

  let d = '';
  if (t === 'path') {
    const base =
      String(asHost(el).__sceneBasePath || '') ||
      el.getAttribute('data-scene-base-path') ||
      '';
    if (!base.trim()) return false;
    d = filletPathD(base, r, opts.attrs);
  } else if (t === 'triangle' || t === 'star' || t === 'polygon') {
    d =
      roundedShapePath(
        t,
        w,
        h,
        r,
        opts.sides ?? readSceneSides(el),
        opts.attrs
      ) || '';
  } else if (t === 'circle' || t === 'line' || t === 'arrow' || t === 'pen') {
    return false;
  } else {
    d = roundedRectPath(w, h, r);
  }
  if (!d) return false;

  rememberSceneCornerRadii(el, r);

  let ok = false;
  if (el.tagName.toLowerCase() === 'path') {
    ok = setPathD(el, d);
  } else {
    const body =
      el.querySelector(':scope > [data-baseline="1"]') ||
      el.querySelector(':scope > [data-radius-body="1"]:not([data-stroke-under])') ||
      el.querySelector(':scope > path:not([data-stroke-under])');
    ok = setPathD(body, d);
  }

  // Image / video: visible rounding is a <clipPath> in defs (baseline path is pe:none).
  const clipId = String(el.getAttribute('data-radius-clip-id') || '').trim();
  if (clipId) {
    const root = el.ownerSVGElement;
    let clipPathEl: Element | null = null;
    try {
      const clip = root?.getElementById(clipId);
      clipPathEl = clip?.querySelector('[data-radius-clip="1"]') || clip?.querySelector('path') || null;
    } catch {
      clipPathEl = null;
    }
    if (setPathD(clipPathEl, d)) ok = true;
  }

  return ok;
}

function removeSceneNodesById(layer: SVGElement, nodeId: string) {
  try {
    layer.querySelectorAll('[data-scene-node-id]').forEach((n) => {
      if (n.getAttribute('data-scene-node-id') !== nodeId) return;
      detachSceneNodeEl(n);
    });
  } catch {
    /* ignore */
  }
}

const replaceGenByMap = new WeakMap<object, Map<string, number>>();

export async function replaceSvgNode(
  root: SVGSVGElement,
  layer: SVGElement,
  document: SceneDocument,
  nodeEls: Map<string, SVGElement>,
  nodeId: string
) {
  let gens = replaceGenByMap.get(nodeEls);
  if (!gens) {
    gens = new Map();
    replaceGenByMap.set(nodeEls, gens);
  }
  const gen = (gens.get(nodeId) || 0) + 1;
  gens.set(nodeId, gen);

  removeSceneNodesById(layer, nodeId);
  const prev = nodeEls.get(nodeId);
  if (prev) {
    detachSceneNodeEl(prev);
    nodeEls.delete(nodeId);
  }

  const node = document.deltaSetLike?.[nodeId];
  const el = await nodeToSvgElement(root, layer, document, node, nodeId);
  if (gens.get(nodeId) !== gen) {
    el?.remove();
    return;
  }
  if (!el) return;
  dedupeSceneNode(layer, nodeId, el);
  applyFrameContentClip(root, el, document, node);
  nodeEls.set(nodeId, el);
  try {
    fitInfiniteSvgToContent(root, layer);
  } catch {
    /* ignore */
  }
}

export function createSvgBoard(
  host: HTMLElement,
  width: number,
  height: number,
  opts?: {
    infinite?: boolean;
    /** Attach a layer `<g>` into the shared world SVG instead of a private root. */
    sharedRoot?: SVGSVGElement | null;
    sharedMount?: SVGGElement | null;
  }
): { root: SVGSVGElement; layer: SVGGElement; shared: boolean } {
  const infinite = Boolean(opts?.infinite);
  const sharedRoot = opts?.sharedRoot;
  const sharedMount = opts?.sharedMount;
  if (infinite && sharedRoot && sharedMount) {
    const layer = appendChild(
      sharedMount,
      svgEl('g', { id: 'scene-layer', 'data-rcb-shape-layer': '1' })
    );
    return { root: sharedRoot, layer, shared: true };
  }
  const root = createSvgRoot(host);
  if (infinite) {
    applyInfiniteSvgViewport(root);
  } else {
    setAttrs(root, {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      preserveAspectRatio: 'none',
      'shape-rendering': 'geometricPrecision',
    });
    setStyles(root, {
      display: 'block',
      overflow: 'visible',
      width: '100%',
      height: '100%',
    });
  }
  const layer = appendChild(root, svgEl('g', { id: 'scene-layer' }));
  return { root, layer, shared: false };
}
