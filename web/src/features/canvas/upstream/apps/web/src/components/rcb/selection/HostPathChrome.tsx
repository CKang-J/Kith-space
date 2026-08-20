/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/selection/HostPathChrome.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';
/**
 * Path indicator + path handles.
 * Mirrors the shape-host CSS box + viewBox so chrome shares the ink lattice.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRcbCamera } from '@recombyn-native/components/rcb/camera/context';
import {
  applySceneSurface,
  expandInfiniteSvgPad,
  hostChromeBodyTransform,
  mirrorHostSurface,
} from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import { HEAVY_PATH_D_CHARS, rememberNodePath2D } from '@recombyn-native/components/rcb/scene/document/sceneShapes';
import { geometryIndicatorPathD } from '@recombyn-native/components/rcb/scene/paint/outlineToPath';
import {
  getShapeHost,
  getSharedNodeEls,
  listShapeHosts,
  subscribeShapeHosts,
} from '@recombyn-native/components/rcb/shapes/shapeHostRegistry';
import type { SceneBox } from './alignGuides';
import { cursorForRotate } from './rotateCornerCursor';
import {
  CHROME_HANDLE_HIT_PX,
  CHROME_HANDLE_VIS_PX,
  CHROME_LINE_ENDPOINT_HALO_PX,
  CHROME_LINE_ENDPOINT_HIT_PX,
  CHROME_LINE_ENDPOINT_VIS_PX,
  CHROME_ROTATE_GAP_PX,
  CHROME_ROTATE_HIT_PX,
  CHROME_STROKE_PX,
  chromeHitScaleForBox,
  chromeOutsideHitPadScene,
  cursorForResize,
  rotateHotzoneOutward,
} from './SelectionChrome';
import type { RcbCamera } from '@recombyn-native/components/rcb/core/types';

function liveNodeEl(nodeId: string): Element | null {
  return (
    (getSharedNodeEls()?.get(nodeId) as Element | undefined) ||
    (getShapeHost(nodeId)?.el as Element | null | undefined) ||
    null
  );
}

/** Live geometry from the mounted shape host (same numbers paint uses). */
function liveShapeGeomBox(nodeId: string): SceneBox | null {
  const el = liveNodeEl(nodeId) as any;
  if (!el) return null;
  const left = Number(el.__sceneLeft);
  const top = Number(el.__sceneTop);
  const width = Number(el.sceneWidth);
  const height = Number(el.sceneHeight);
  if (![left, top, width, height].every(Number.isFinite)) return null;
  if (!(width > 0) || !(height > 0)) return null;
  return { left, top, width, height };
}

/** Shape / image / video / lottie / path on SVG host (not text / frame). */
function nodeUsesPathChrome(node: SceneNodeInput): boolean {
  if (!node) return false;
  const key = String(node.key || '');
  if (key === 'text' || key === 'frame') return false;
  // Media plates share the host lattice so chrome tracks SVG `__sceneLeft` —
  // world SelectionChrome from Redux alone drifts after sticky re-align.
  if (key === 'image' || key === 'video' || key === 'lottie' || key === 'audio') return true;
  if (key === 'shape' || key === 'path' || key === 'rect' || key === 'ellipse') return true;
  return Boolean(node.attrs?.shapeType);
}

export type ShapeOutlineItem = {
  id: string;
  pathD: string;
  box: SceneBox;
  angle: number;
  color?: string;
  /** Selected: inject resize (and rotate) hits into the host with the outline. */
  withHandles?: boolean;
  lineMode?: boolean;
  /** Line/arrow: knobs at shaft ends (not path tip). */
  shaftEndpoints?: boolean;
  showRotate?: boolean;
  /** When false, handles/edges only. */
  showPath?: boolean;
  /** Multi-select union control box; mirrors `mirrorHostId` viewport. */
  unionChrome?: boolean;
  mirrorHostId?: string;
  cornerHandlesOnly?: boolean;
  edgeHandles?: 'all' | 'horizontal' | 'none';
  /**
   * Pad from geom-local origin to control box (≥ 0). Normally 0 — box on path.
   */
  chromeOutset?: number;
};

const SVG_NS = 'http://www.w3.org/2000/svg' as const;
const SEL_OUTLINE_ATTR = 'data-rcb-sel-outline';
const SEL_CHROME_ATTR = 'data-rcb-sel-chrome';
/** Legacy host AABB box attr — cleaned on sync; path silhouette is the outline. */
const SEL_BOX_ATTR = 'data-rcb-sel-box';
/** Inspect pair top/bottom (or L/R) edge rails — host-injected. */
const SEL_EDGE_ATTR = 'data-rcb-sel-edge';
/** Gap / size badge pill — host-injected. */
const SEL_BADGE_ATTR = 'data-rcb-sel-badge';
/** World-layer mount for path chrome (above shape hosts; does not lift node ink). */
const SEL_CHROME_LAYER_ATTR = 'data-rcb-sel-chrome-layer';
const SEL_EP_HOVER_STYLE = 'g.sel-hit:hover > .sel-ep-halo { opacity: 1; }';

/**
 * World chrome layer hit-shell — must stay `0×0` + overflow visible (same as
 * SelectionFeature / SvgCanvas overlay wrappers). Never full-bleed `inset-0`:
 * that keeps paint visible but drops `data-sel-handle` out of hit-testing under
 * world `[&>*]:pointer-events-auto`.
 */
export function selChromeLayerShell(): {
  className: string;
  width: string;
  height: string;
  zIndex: string;
  pointerEvents: 'none';
} {
  return {
    className: 'pointer-events-none absolute left-0 top-0 overflow-visible',
    width: '0',
    height: '0',
    zIndex: '1000000',
    pointerEvents: 'none',
  };
}

function ensureSelEpHoverStyle(root: SVGSVGElement) {
  if (root.querySelector('style[data-rcb-sel-ep-style]')) return;
  const style = document.createElementNS(SVG_NS, 'style');
  style.setAttribute('data-rcb-sel-ep-style', '1');
  style.textContent = SEL_EP_HOVER_STYLE;
  root.insertBefore(style, root.firstChild);
}

/** Local (box) → world, matching host chrome rotate-about-center. */
function localPointToWorld(
  lx: number,
  ly: number,
  box: SceneBox,
  angleDeg: number
): { x: number; y: number } {
  const w = Math.max(1, box.width);
  const h = Math.max(1, box.height);
  const cx = w / 2;
  const cy = h / 2;
  const rad = ((Number(angleDeg) || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = lx - cx;
  const dy = ly - cy;
  return {
    x: box.left + cx + dx * cos - dy * sin,
    y: box.top + cy + dx * sin + dy * cos,
  };
}

/** Place AABB so local point maps to a world point under `angleDeg`. */
function boxFromLocalAnchor(
  localX: number,
  localY: number,
  worldX: number,
  worldY: number,
  width: number,
  height: number,
  angleDeg: number
): SceneBox {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const cx = w / 2;
  const cy = h / 2;
  const rad = ((Number(angleDeg) || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = localX - cx;
  const dy = localY - cy;
  const centerX = worldX - (dx * cos - dy * sin);
  const centerY = worldY - (dx * sin + dy * cos);
  return { left: centerX - cx, top: centerY - cy, width: w, height: h };
}

/**
 * Host selection chrome mount. Applies {@link selChromeLayerShell}; inline
 * pe:none beats world auto so only pe:all kids receive hits.
 */
function ensureSelChromeLayer(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const world = document.querySelector('[data-rcb-world="1"]') as HTMLElement | null;
  if (!world) return null;
  let layer = world.querySelector(
    `:scope > [${SEL_CHROME_LAYER_ATTR}]`
  ) as HTMLElement | null;
  if (!layer) {
    layer = document.createElement('div');
    layer.setAttribute(SEL_CHROME_LAYER_ATTR, '1');
    world.appendChild(layer);
  }
  const shell = selChromeLayerShell();
  layer.className = shell.className;
  layer.style.width = shell.width;
  layer.style.height = shell.height;
  layer.style.zIndex = shell.zIndex;
  layer.style.pointerEvents = shell.pointerEvents;
  // Do not re-append every sync — z-index already stacks above hosts.
  return layer;
}

/** Fingerprint for resize/rotate DOM — skip tear-down when only camera pan updates. */
function hostSelHandlesKey(
  o: ShapeOutlineItem,
  stroke: number,
  inv: number,
  outlineD: string
): string {
  const b = o.box;
  return [
    o.withHandles ? 1 : 0,
    o.showRotate ? 1 : 0,
    o.lineMode ? 1 : 0,
    o.shaftEndpoints ? 1 : 0,
    o.cornerHandlesOnly ? 1 : 0,
    o.edgeHandles || 'all',
    o.color || '',
    stroke.toFixed(5),
    inv.toFixed(6),
    b.left.toFixed(2),
    b.top.toFixed(2),
    b.width.toFixed(2),
    b.height.toFixed(2),
    (Number(o.angle) || 0).toFixed(3),
    Number(o.chromeOutset) || 0,
    outlineD.length,
    outlineD.slice(0, 32),
    outlineD.slice(-32),
  ].join('|');
}

function syncHostSelHandlesIfNeeded(
  chrome: SVGGElement,
  o: ShapeOutlineItem,
  stroke: number,
  inv: number,
  outlineD: string
) {
  const key = hostSelHandlesKey(o, stroke, inv, outlineD);
  if (!o.withHandles) {
    if (chrome.getAttribute('data-rcb-handles-key')) {
      chrome
        .querySelectorAll(`g.sel-hit,[data-sel-handle],[data-rcb-sel-knob],[${SEL_BOX_ATTR}]`)
        .forEach((n) => n.remove());
      chrome.removeAttribute('data-rcb-handles-key');
    }
    return;
  }
  if (chrome.getAttribute('data-rcb-handles-key') === key) return;
  syncHostSelHandles(chrome, o, stroke, inv, outlineD);
  chrome.setAttribute('data-rcb-handles-key', key);
}

function clearHostSelOutline(nodeId: string) {
  const host = getShapeHost(nodeId);
  const el = host?.el || getSharedNodeEls()?.get(nodeId);
  const scopes: Array<Element | null | undefined> = [
    el,
    host?.root,
    el?.parentElement,
    typeof document !== 'undefined'
      ? document.querySelector(`[${SEL_CHROME_LAYER_ATTR}]`)
      : null,
  ];
  const edgeForSel = `g[data-rcb-sel-edge-for="${CSS.escape(nodeId)}"]`;
  for (const scope of scopes) {
    if (!scope || typeof scope.querySelectorAll !== 'function') continue;
    scope
      .querySelectorAll(
        `[${SEL_OUTLINE_ATTR}="${CSS.escape(nodeId)}"],[${SEL_CHROME_ATTR}="${CSS.escape(nodeId)}"],[${SEL_EDGE_ATTR}="${CSS.escape(nodeId)}"],[${SEL_BADGE_ATTR}="${CSS.escape(nodeId)}"],${edgeForSel}`
      )
      .forEach((n) => {
        try {
          n.remove();
        } catch {
          /* ignore */
        }
      });
  }
}

function readBaselinePathD(baseline: SVGElement | null, fallback: string): string {
  if (!baseline) return fallback;
  const tag = baseline.tagName.toLowerCase();
  if (tag === 'path') {
    const d = baseline.getAttribute('d') || '';
    return d.trim().length >= 2 ? d : fallback;
  }
  if (tag === 'line') {
    const x1 = Number(baseline.getAttribute('x1') || 0);
    const y1 = Number(baseline.getAttribute('y1') || 0);
    const x2 = Number(baseline.getAttribute('x2') || 0);
    const y2 = Number(baseline.getAttribute('y2') || 0);
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  return fallback;
}

/** Keep first subpath only (donut outer). */
function silhouettePathD(d: string): string {
  const raw = String(d || '').trim();
  if (!raw) return raw;
  // Each M/m starts a subpath; keep only the first (outer).
  const parts = raw.match(/[Mm][^Mm]*/g);
  if (!parts || parts.length <= 1) return raw;
  return parts[0].trim();
}

/** Path chrome `d` — prefer live host baseline, else attrs path; single contour. */
function readHostOutlinePathD(baseline: SVGElement | null, o: ShapeOutlineItem): string {
  return silhouettePathD(readBaselinePathD(baseline, o.pathD));
}

function pathLocalEndpoints(
  d: string,
  w: number,
  h: number,
  mode: 'path' | 'shaft' = 'path'
): [[number, number], [number, number]] {
  const midY = h / 2;
  const fallback: [[number, number], [number, number]] = [
    [0, midY],
    [Math.max(1, w), midY],
  ];
  if (mode === 'shaft') return fallback;
  const raw = String(d || '').trim();
  if (!raw || typeof document === 'undefined') return fallback;
  try {
    const el = document.createElementNS(SVG_NS, 'path');
    el.setAttribute('d', raw);
    const len = el.getTotalLength?.() ?? 0;
    if (!(len > 0)) return fallback;
    const a = el.getPointAtLength(0);
    const b = el.getPointAtLength(len);
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return fallback;
    return [
      [a.x, a.y],
      [b.x, b.y],
    ];
  } catch {
    return fallback;
  }
}

/** Line / arrow only — shaft endpoint knobs. Pen / pencil / path use AABB control box. */
function nodeUsesOpenStrokeEndpoints(node: SceneNodeInput): boolean {
  if (!node) return false;
  const t = String(node.attrs?.shapeType || '');
  return t === 'line' || t === 'arrow';
}

/** Freehand / boolean / stroke paths that must show real path ink as object outline. */
export function isVectorStrokeNode(node: SceneNodeInput, shapeType?: string): boolean {
  const t = shapeType ?? String(node?.attrs?.shapeType || '');
  return (
    t === 'pencil' ||
    t === 'pen' ||
    t === 'path' ||
    t === 'line' ||
    t === 'arrow' ||
    String(node?.key || '') === 'path' ||
    nodeUsesOpenStrokeEndpoints(node)
  );
}

/**
 * Object-outline path `d` in local geom space (HostPathChrome silhouette).
 * Vector strokes always use painted path; heavy geo falls back to AABB stand-in.
 */
export function resolveOutlinePathD(node: SceneNodeInput, gw: number, gh: number): string {
  const rawPath = String(node?.attrs?.path || node?.attrs?.d || '');
  const shapeType = String(node?.attrs?.shapeType || '');
  if (isVectorStrokeNode(node, shapeType)) {
    if (rawPath.trim().length >= 2) return rawPath;
    return geometryIndicatorPathD(node, { width: gw, height: gh });
  }
  if (rawPath.length >= HEAVY_PATH_D_CHARS) {
    return `M 0 0 H ${gw} V ${gh} H 0 Z`;
  }
  return geometryIndicatorPathD(node, { width: gw, height: gh });
}

type BoxResizeKnob = ['n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw', number, number];

/** Control-box resize seats for the given edge/corner policy. */
function boxResizeKnobs(
  bx: number,
  by: number,
  bw: number,
  bh: number,
  opts: { cornerHandlesOnly?: boolean; edgeHandles?: 'all' | 'horizontal' | 'none' }
): BoxResizeKnob[] {
  if (opts.cornerHandlesOnly) {
    return [
      ['nw', bx, by],
      ['ne', bx + bw, by],
      ['se', bx + bw, by + bh],
      ['sw', bx, by + bh],
    ];
  }
  if (opts.edgeHandles === 'horizontal') {
    return [
      ['w', bx, by + bh / 2],
      ['e', bx + bw, by + bh / 2],
    ];
  }
  return [
    ['nw', bx, by],
    ['n', bx + bw / 2, by],
    ['ne', bx + bw, by],
    ['e', bx + bw, by + bh / 2],
    ['se', bx + bw, by + bh],
    ['s', bx + bw / 2, by + bh],
    ['sw', bx, by + bh],
    ['w', bx, by + bh / 2],
  ];
}

function syncHostSelHandles(
  chrome: SVGGElement,
  o: ShapeOutlineItem,
  stroke: number,
  inv: number,
  outlineD: string
) {
  const w = Math.max(1, o.box.width);
  const h = Math.max(1, o.box.height);
  const color = o.color || '#3388ff';
  const hitScale = chromeHitScaleForBox(w, h, 1 / Math.max(0.05, inv));
  const handleVis = CHROME_HANDLE_VIS_PX * inv;
  const handleHit = CHROME_HANDLE_HIT_PX * inv * hitScale;
  const halfVis = handleVis / 2;
  const halfHit = handleHit / 2;
  const lineEpVis = CHROME_LINE_ENDPOINT_VIS_PX * inv;
  const lineEpHit = CHROME_LINE_ENDPOINT_HIT_PX * inv * hitScale;
  const rotateHit = CHROME_ROTATE_HIT_PX * inv * hitScale;
  const rotateGap = CHROME_ROTATE_GAP_PX * inv;

  // Drop previous handle/rotate/box children (keep path silhouette outline).
  chrome
    .querySelectorAll(`g.sel-hit,[data-sel-handle],[data-rcb-sel-knob],[${SEL_BOX_ATTR}]`)
    .forEach((n) => n.remove());

  if (o.lineMode) {
    const [start, end] = pathLocalEndpoints(
      outlineD,
      w,
      h,
      o.shaftEndpoints ? 'shaft' : 'path'
    );
    const knobs: Array<[string, number, number]> = [
      ['w', start[0], start[1]],
      ['e', end[0], end[1]],
    ];
    const lineEpHalo = CHROME_LINE_ENDPOINT_HALO_PX * inv;
    const root = chrome.ownerSVGElement as SVGSVGElement | null;
    if (root) ensureSelEpHoverStyle(root);
    for (const [dir, lx, ly] of knobs) {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'sel-hit');
      g.setAttribute('transform', `translate(${lx} ${ly})`);

      const halo = document.createElementNS(SVG_NS, 'circle');
      halo.setAttribute('class', 'sel-ep-halo');
      halo.setAttribute('r', String(lineEpHalo / 2));
      halo.setAttribute('fill', `${color}59`);
      halo.setAttribute('opacity', '0');
      halo.setAttribute('pointer-events', 'none');
      g.appendChild(halo);

      const vis = document.createElementNS(SVG_NS, 'circle');
      vis.setAttribute('data-rcb-sel-knob', '1');
      vis.setAttribute('data-rcb-sel-endpoint', dir);
      vis.setAttribute('r', String(Math.max(0.01, lineEpVis / 2 - stroke / 2)));
      vis.setAttribute('fill', '#fff');
      vis.setAttribute('stroke', color);
      vis.setAttribute('stroke-width', String(stroke));
      vis.setAttribute('pointer-events', 'none');
      g.appendChild(vis);

      const hit = document.createElementNS(SVG_NS, 'rect');
      hit.setAttribute('data-sel-handle', 'resize');
      hit.setAttribute('data-resize', dir);
      hit.setAttribute('role', 'button');
      hit.setAttribute('aria-label', `endpoint-${dir}`);
      hit.setAttribute('x', String(-lineEpHit / 2));
      hit.setAttribute('y', String(-lineEpHit / 2));
      hit.setAttribute('width', String(lineEpHit));
      hit.setAttribute('height', String(lineEpHit));
      hit.setAttribute('fill', 'transparent');
      hit.setAttribute('pointer-events', 'all');
      hit.style.cursor = 'grab';
      g.appendChild(hit);

      chrome.appendChild(g);
    }
    return;
  }

  // Control box + knobs (pen/pencil/path / image / video). No path silhouette when
  // selected — that is toggled via showPath on the outline.
  // o.box is path geom; chromeOutset is normally 0 (control box on path).
  const outset = Math.max(0, Number(o.chromeOutset) || 0);
  const bx = -outset;
  const by = -outset;
  const bw = w + outset * 2;
  const bh = h + outset * 2;
  const box = document.createElementNS(SVG_NS, 'rect');
  box.setAttribute(SEL_BOX_ATTR, o.id);
  box.setAttribute('x', String(bx));
  box.setAttribute('y', String(by));
  box.setAttribute('width', String(bw));
  box.setAttribute('height', String(bh));
  box.setAttribute('fill', 'none');
  box.setAttribute('stroke', color);
  box.setAttribute('stroke-width', String(stroke));
  box.setAttribute('pointer-events', 'none');
  chrome.appendChild(box);

  const edgeMode = o.edgeHandles || 'all';
  if (edgeMode === 'none') return;

  const knobs = boxResizeKnobs(bx, by, bw, bh, {
    cornerHandlesOnly: o.cornerHandlesOnly,
    edgeHandles: edgeMode,
  });

  const angle = Number(o.angle) || 0;
  // Rotate first, then resize on top — corner / control-box clicks prefer scale.
  if (o.showRotate) {
    const corners: Array<['nw' | 'ne' | 'se' | 'sw', number, number, number, number, number]> = [
      ['nw', bx, by, -1, -1, 0],
      ['ne', bx + bw, by, 1, -1, 90],
      ['se', bx + bw, by + bh, 1, 1, 180],
      ['sw', bx, by + bh, -1, 1, 270],
    ];
    const out = rotateHotzoneOutward(handleHit, rotateGap, rotateHit);
    for (const [corner, lx, ly, signX, signY, iconDeg] of corners) {
      // Axis-aligned outer quadrant from the control-box corner (same center as resize).
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'sel-hit');
      g.setAttribute('pointer-events', 'all');
      g.setAttribute('transform', `translate(${lx + signX * out} ${ly + signY * out})`);
      const hit = document.createElementNS(SVG_NS, 'rect');
      hit.setAttribute('data-sel-handle', 'rotate');
      hit.setAttribute('data-rotate-corner', corner);
      hit.setAttribute('role', 'button');
      hit.setAttribute('aria-label', 'Rotate');
      hit.setAttribute('x', String(-rotateHit / 2));
      hit.setAttribute('y', String(-rotateHit / 2));
      hit.setAttribute('width', String(rotateHit));
      hit.setAttribute('height', String(rotateHit));
      hit.setAttribute('fill', 'transparent');
      hit.setAttribute('pointer-events', 'all');
      hit.style.cursor = cursorForRotate(iconDeg, angle);
      g.appendChild(hit);
      chrome.appendChild(g);
    }
  }

  // Edges first, corners last — on tiny boxes edge hits otherwise cover corners
  // (e paints after ne → TR white square becomes east-resize / feels broken).
  const isCorner = (d: string) => d === 'nw' || d === 'ne' || d === 'se' || d === 'sw';
  const orderedKnobs = [
    ...knobs.filter(([d]) => !isCorner(d)),
    ...knobs.filter(([d]) => isCorner(d)),
  ];

  // Direct chrome children (absolute local x/y) — same as pre-regression HEAD.
  // A wrapping pe:none <g> under chrome pe:none dropped pe:all hits in practice.
  for (const [dir, lx, ly] of orderedKnobs) {
    const visFill = document.createElementNS(SVG_NS, 'rect');
    visFill.setAttribute('data-rcb-sel-knob', '1');
    visFill.setAttribute('x', String(lx - halfVis));
    visFill.setAttribute('y', String(ly - halfVis));
    visFill.setAttribute('width', String(handleVis));
    visFill.setAttribute('height', String(handleVis));
    visFill.setAttribute('fill', '#ffffff');
    visFill.setAttribute('pointer-events', 'none');
    chrome.appendChild(visFill);

    const visStroke = document.createElementNS(SVG_NS, 'rect');
    visStroke.setAttribute('data-rcb-sel-knob', '1');
    visStroke.setAttribute('x', String(lx - halfVis));
    visStroke.setAttribute('y', String(ly - halfVis));
    visStroke.setAttribute('width', String(handleVis));
    visStroke.setAttribute('height', String(handleVis));
    visStroke.setAttribute('fill', 'none');
    visStroke.setAttribute('stroke', color);
    visStroke.setAttribute('stroke-width', String(stroke));
    visStroke.setAttribute('pointer-events', 'none');
    chrome.appendChild(visStroke);

    const hit = document.createElementNS(SVG_NS, 'rect');
    hit.setAttribute('data-sel-handle', 'resize');
    hit.setAttribute('data-resize', dir);
    hit.setAttribute('x', String(lx - halfHit));
    hit.setAttribute('y', String(ly - halfHit));
    hit.setAttribute('width', String(handleHit));
    hit.setAttribute('height', String(handleHit));
    hit.setAttribute('fill', 'transparent');
    hit.setAttribute('pointer-events', 'all');
    hit.style.cursor = cursorForResize(dir, angle);
    chrome.appendChild(hit);
  }
}

/** Multi-select union control box; twin member host viewport. */
function syncHostSelUnionChrome(
  o: ShapeOutlineItem,
  stroke: number,
  inv: number,
  camera: RcbCamera
): boolean {
  const layer = ensureSelChromeLayer();
  if (!layer) return false;

  const mirrorId = o.mirrorHostId || o.id;
  const host = getShapeHost(mirrorId);
  const hostRoot = host?.root as SVGSVGElement | null | undefined;

  const w = Math.max(1, o.box.width);
  const h = Math.max(1, o.box.height);
  const outset = Math.max(0, Number(o.chromeOutset) || 0);
  const pad = chromeOutsideHitPadScene(inv, outset, stroke * 8);

  let root = layer.querySelector(
    `:scope > svg[${SEL_CHROME_ATTR}="${CSS.escape(o.id)}"]`
  ) as SVGSVGElement | null;
  if (!root) {
    root = document.createElementNS(SVG_NS, 'svg');
    root.setAttribute(SEL_CHROME_ATTR, o.id);
    root.setAttribute('overflow', 'visible');
    root.setAttribute('preserveAspectRatio', 'none');
    root.style.position = 'absolute';
    root.style.overflow = 'visible';
    root.style.pointerEvents = 'none';
    root.style.display = 'block';
    layer.appendChild(root);
  }
  root.style.pointerEvents = 'none';

  const mirrored = Boolean(hostRoot && mirrorHostSurface(root, hostRoot));
  if (mirrored) {
    // Shared world surface already covers the camera viewport — expanding it
    // by 1/zoom handle pad desyncs chrome from ink. Only pad private hosts.
    const worldSurface = hostRoot?.getAttribute('data-rcb-world-surface') === '1';
    if (o.withHandles && !worldSurface) expandInfiniteSvgPad(root, pad);
  } else {
    applySceneSurface(
      root,
      {
        left: o.box.left - pad,
        top: o.box.top - pad,
        width: w + pad * 2,
        height: h + pad * 2,
      },
      camera
    );
  }

  let chrome = root.querySelector(`:scope > g[${SEL_CHROME_ATTR}="body"]`) as SVGGElement | null;
  if (!chrome) {
    chrome = document.createElementNS(SVG_NS, 'g');
    chrome.setAttribute(SEL_CHROME_ATTR, 'body');
    chrome.setAttribute('pointer-events', 'none');
    root.appendChild(chrome);
  }
  const angle = Number(o.angle) || 0;
  chrome.setAttribute(
    'transform',
    Math.abs(angle) > 0.01
      ? `translate(${o.box.left} ${o.box.top}) rotate(${angle} ${w / 2} ${h / 2})`
      : `translate(${o.box.left} ${o.box.top})`
  );
  syncHostSelHandlesIfNeeded(chrome, o, stroke, inv, '');
  return mirrored;
}

/**
 * Blue path outline (+ handles) on the world chrome layer (z above all hosts).
 *
 * Accuracy: mirror the shape host SVG's CSS box + viewBox, and copy the paint
 * element's `transform` — same scene mapping as host ink.
 * Occlusion: paint lives on the top world layer so sibling hosts cannot cover it.
 */
function syncHostSelOutline(
  o: ShapeOutlineItem,
  stroke: number,
  inv: number,
  camera: RcbCamera
): boolean {
  if (o.unionChrome) return syncHostSelUnionChrome(o, stroke, inv, camera);

  const layer = ensureSelChromeLayer();
  if (!layer) return false;

  const host = getShapeHost(o.id);
  const hostRoot = host?.root as SVGSVGElement | null | undefined;
  const el = (host?.el || getSharedNodeEls()?.get(o.id)) as SVGElement | null | undefined;
  const baseline = el
    ? (el.getAttribute?.('data-baseline') === '1' ? el : null) ||
      (el.querySelector?.(':scope > [data-baseline="1"]') as SVGElement | null) ||
      (el.querySelector?.('[data-baseline="1"]') as SVGElement | null)
    : null;

  const d = readHostOutlinePathD(baseline, o);
  if (!d) {
    clearHostSelOutline(o.id);
    return false;
  }

  // Strip any leftover chrome still injected inside the shape host.
  if (el) {
    const hostParent =
      (baseline?.parentElement as Element | null) ||
      (el.tagName.toLowerCase() === 'g' ? el : el.parentElement);
    hostParent
      ?.querySelectorAll?.(
        `[${SEL_OUTLINE_ATTR}="${CSS.escape(o.id)}"],[${SEL_CHROME_ATTR}="${CSS.escape(o.id)}"]`
      )
      .forEach((n) => {
        try {
          n.remove();
        } catch {
          /* ignore */
        }
      });
  }

  const w = Math.max(1, o.box.width);
  const h = Math.max(1, o.box.height);
  const angle = Number(o.angle) || 0;
  const outset = Math.max(0, Number(o.chromeOutset) || 0);
  const pad = chromeOutsideHitPadScene(inv, outset, stroke * 8);
  const left = o.box.left;
  const top = o.box.top;

  let root = layer.querySelector(
    `:scope > svg[${SEL_CHROME_ATTR}="${CSS.escape(o.id)}"]`
  ) as SVGSVGElement | null;
  if (!root) {
    root = document.createElementNS(SVG_NS, 'svg');
    root.setAttribute(SEL_CHROME_ATTR, o.id);
    root.setAttribute('overflow', 'visible');
    root.setAttribute('preserveAspectRatio', 'none');
    root.style.position = 'absolute';
    root.style.overflow = 'visible';
    root.style.pointerEvents = 'none';
    root.style.display = 'block';
    layer.appendChild(root);
  }
  root.style.pointerEvents = 'none';

  // Host-mirrored surface; fallback: scene surface.
  // World hosts already cover the viewport — do not expandInfiniteSvgPad
  // (that shifted chrome off ink). Private hosts still need pad for outside hits.
  const mirrored = Boolean(hostRoot && mirrorHostSurface(root, hostRoot));
  if (mirrored) {
    const worldSurface = hostRoot?.getAttribute('data-rcb-world-surface') === '1';
    if (o.withHandles && !worldSurface) expandInfiniteSvgPad(root, pad);
  } else {
    applySceneSurface(
      root,
      {
        left: left - pad,
        top: top - pad,
        width: w + pad * 2,
        height: h + pad * 2,
      },
      camera
    );
  }

  let chrome = root.querySelector(`:scope > g[${SEL_CHROME_ATTR}="body"]`) as SVGGElement | null;
  if (!chrome) {
    chrome = document.createElementNS(SVG_NS, 'g');
    chrome.setAttribute(SEL_CHROME_ATTR, 'body');
    chrome.setAttribute('pointer-events', 'none');
    root.appendChild(chrome);
  }

  chrome.setAttribute(
    'transform',
    hostChromeBodyTransform(el, o.box, angle, mirrored)
  );

  let outline = chrome.querySelector(
    `:scope > path[${SEL_OUTLINE_ATTR}="${CSS.escape(o.id)}"]`
  ) as SVGPathElement | null;
  if (!outline) {
    outline = document.createElementNS(SVG_NS, 'path');
    outline.setAttribute(SEL_OUTLINE_ATTR, o.id);
    outline.setAttribute('fill', 'none');
    outline.setAttribute('pointer-events', 'none');
    chrome.insertBefore(outline, chrome.firstChild);
  }

  rememberNodePath2D(o.id, d);
  outline.setAttribute('d', d);
  const showPath = o.showPath !== false;
  outline.setAttribute('stroke', showPath ? o.color || '#3388ff' : 'none');
  outline.setAttribute('stroke-width', String(stroke));
  const roundStroke = Boolean(o.lineMode || o.shaftEndpoints);
  outline.setAttribute('stroke-linejoin', roundStroke ? 'round' : 'miter');
  outline.setAttribute('stroke-linecap', roundStroke ? 'round' : 'butt');

  if (o.withHandles) syncHostSelHandlesIfNeeded(chrome, o, stroke, inv, d);
  else syncHostSelHandlesIfNeeded(chrome, { ...o, withHandles: false }, stroke, inv, d);

  return true;
}

/** Path chrome overlay (host-mirrored twin SVG on world layer). */
function ShapeOutlineSvg({ outlines }: { outlines: ShapeOutlineItem[] }) {
  const camera = useRcbCamera();
  const z = Math.max(0.05, camera.zoom || 1);
  const inv = 1 / z;
  const stroke = CHROME_STROKE_PX * inv;
  const [hostEpoch, setHostEpoch] = useState(0);
  const outlineKey = outlines
    .map((o) => {
      const hostKeyId = o.mirrorHostId || o.id;
      const host = getShapeHost(hostKeyId);
      const hostEl = (host?.el || getSharedNodeEls()?.get(hostKeyId)) as SVGElement | null | undefined;
      const baseline =
        hostEl &&
        ((hostEl.getAttribute?.('data-baseline') === '1' ? hostEl : null) ||
          (hostEl.querySelector?.(':scope > [data-baseline="1"]') as SVGElement | null) ||
          (hostEl.querySelector?.('[data-baseline="1"]') as SVGElement | null));
      // Prefer live host `d` so radius / tip previews re-sync chrome (attrs path stays stale mid-drag).
      const liveD = readBaselinePathD(baseline, o.pathD);
      const vb = host?.root?.getAttribute?.('viewBox') || '';
      const tf = hostEl?.getAttribute?.('transform') || '';
      const anyEl = hostEl as any;
      const origin = `${Number(anyEl?.__sceneLeft) || o.box.left},${Number(anyEl?.__sceneTop) || o.box.top}`;
      return `${o.id}:${o.unionChrome ? 1 : 0}:${o.mirrorHostId || ''}:${liveD.length}:${liveD.slice(0, 24)}:${liveD.slice(-24)}:${o.box.left.toFixed(1)},${o.box.top.toFixed(1)},${o.box.width}x${o.box.height}:${o.angle.toFixed(2)}:${o.withHandles ? 1 : 0}:${o.showPath === false ? 0 : 1}:${o.lineMode ? 1 : 0}:${o.shaftEndpoints ? 1 : 0}:${o.showRotate ? 1 : 0}:${o.cornerHandlesOnly ? 1 : 0}:${o.edgeHandles || 'all'}:${o.color || ''}:${vb}:${tf}:${origin}`;
    })
    .join('|');
  const outlinesRef = useRef(outlines);
  outlinesRef.current = outlines;

  useEffect(() => subscribeShapeHosts(() => setHostEpoch((n) => n + 1)), []);

  useLayoutEffect(() => {
    const current = outlinesRef.current;
    const active = new Set(current.map((o) => o.id));
    let pending = current.filter((o) => !syncHostSelOutline(o, stroke, inv, camera));
    for (const h of listShapeHosts()) {
      if (!active.has(h.nodeId)) clearHostSelOutline(h.nodeId);
    }
    // Also clear world-layer chrome for ids that left the set (may not be in hosts).
    const layer = typeof document !== 'undefined'
      ? document.querySelector(`[${SEL_CHROME_LAYER_ATTR}]`)
      : null;
    layer?.querySelectorAll?.(`svg[${SEL_CHROME_ATTR}]`).forEach((n) => {
      const id = n.getAttribute(SEL_CHROME_ATTR);
      if (id && !active.has(id)) {
        try {
          n.remove();
        } catch {
          /* ignore */
        }
      }
    });

    let raf = 0;
    let tries = 0;
    const retry = () => {
      if (!pending.length) return;
      tries += 1;
      pending = pending.filter((o) => !syncHostSelOutline(o, stroke, inv, camera));
      if (pending.length && tries < 120) raf = requestAnimationFrame(retry);
    };
    if (pending.length) raf = requestAnimationFrame(retry);

    return () => {
      cancelAnimationFrame(raf);
      const next = new Set(outlinesRef.current.map((o) => o.id));
      for (const id of active) {
        if (!next.has(id)) clearHostSelOutline(id);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlineKey, stroke, inv, hostEpoch, camera.x, camera.y, camera.zoom]);

  useEffect(() => {
    return () => {
      for (const o of outlinesRef.current) clearHostSelOutline(o.id);
        };
  }, []);

  return null;
}

export {
  liveShapeGeomBox,
  nodeUsesPathChrome,
  nodeUsesOpenStrokeEndpoints,
  pathLocalEndpoints,
  localPointToWorld,
  boxFromLocalAnchor,
  hostSelHandlesKey,
  ShapeOutlineSvg,
};
