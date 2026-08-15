/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/shapes/shapeHostRegistry.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { replaceSvgNode, dedupeSceneNode } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import { invalidateNodePath2D } from '@recombyn-native/components/rcb/scene/document/sceneShapes';
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';

/** Paint element for one scene node (SVG under the camera layer). */
export type SceneHostEl = SVGElement;

/** One paint host per scene node (SVG mini-board under the camera layer). */
export type ShapeHostHandle = {
  nodeId: string;
  root: SVGSVGElement | null;
  layer: SVGGElement | null;
  el: SceneHostEl | null;
  kind: 'svg';
};

const hosts = new Map<string, ShapeHostHandle>();
const hostListeners = new Set<() => void>();
let hostEpoch = 0;

/** Shared nodeId → paint element map used by preview/replace. */
let sharedNodeEls: Map<string, SceneHostEl> | null = null;

function bumpHostEpoch() {
  hostEpoch += 1;
  for (const fn of hostListeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

/** Notify when a shape host registers / remounts / unregisters (paintToken remount). */
export function subscribeShapeHosts(fn: () => void) {
  hostListeners.add(fn);
  return () => {
    hostListeners.delete(fn);
  };
}

/**
 * Live DOM geometry preview (corner radius / star tip) changed `d` without remount.
 * Bump listeners so HostPathChrome re-reads the baseline path.
 */
export function notifyShapeHostGeometry(nodeId?: string) {
  if (nodeId) invalidateNodePath2D(nodeId);
  bumpHostEpoch();
}

export function getShapeHostEpoch() {
  return hostEpoch;
}

export function setSharedNodeEls(map: Map<string, SceneHostEl> | null) {
  sharedNodeEls = map;
}

export function getSharedNodeEls() {
  return sharedNodeEls;
}

export function registerShapeHost(handle: ShapeHostHandle) {
  hosts.set(handle.nodeId, handle);
  if (sharedNodeEls && handle.el) {
    sharedNodeEls.set(handle.nodeId, handle.el);
  }
  // createSvgBoard appends at mount end — re-sort immediately so a remounted
  // frame plate cannot paint over existing shape layers (click-through still works
  // because the world SVG is pointer-events: none).
  if (handle.layer && sceneShapesMount && handle.layer.parentNode === sceneShapesMount) {
    syncSharedMountPaintOrder(sceneShapesMount);
  }
  bumpHostEpoch();
}

export function updateShapeHostElement(nodeId: string, el: SceneHostEl | null) {
  const h = hosts.get(nodeId);
  if (h) h.el = el;
  if (sharedNodeEls) {
    if (el) sharedNodeEls.set(nodeId, el);
    else sharedNodeEls.delete(nodeId);
  }
  // Paint remount → drop Path2D binding so the next hit rebuilds from current `d`.
  invalidateNodePath2D(nodeId);
  bumpHostEpoch();
}

export function unregisterShapeHost(nodeId: string) {
  hosts.delete(nodeId);
  sharedNodeEls?.delete(nodeId);
  invalidateNodePath2D(nodeId);
  bumpHostEpoch();
}

export function getShapeHost(nodeId: string) {
  return hosts.get(nodeId) ?? null;
}

export function listShapeHosts() {
  return [...hosts.values()];
}

export function clearShapeHosts() {
  hosts.clear();
}

/** One SVG under `[data-rcb-world]` — grid + all shape layers share this lattice. */
let sceneWorldRoot: SVGSVGElement | null = null;
let sceneShapesMount: SVGGElement | null = null;
let sceneDrawPreviewMount: SVGGElement | null = null;
let sceneSmartGuidesMount: SVGGElement | null = null;
let sceneWorldEpoch = 0;

export function setSceneWorldRoot(
  root: SVGSVGElement | null,
  shapesMount: SVGGElement | null,
  drawPreviewMount: SVGGElement | null = null,
  smartGuidesMount: SVGGElement | null = null
) {
  sceneWorldRoot = root;
  sceneShapesMount = shapesMount;
  sceneDrawPreviewMount = drawPreviewMount;
  sceneSmartGuidesMount = smartGuidesMount;
  sceneWorldEpoch += 1;
  bumpHostEpoch();
}

export function getSceneWorldRoot() {
  return sceneWorldRoot;
}

export function getSceneShapesMount() {
  return sceneShapesMount;
}

/** SVG paint order must follow data-z (stackOrder). New layers append at mount end. */
export function syncSharedMountPaintOrder(mount?: SVGGElement | null) {
  const root = mount ?? sceneShapesMount;
  if (!root) return;
  const siblings: Element[] = [];
  for (let i = 0; i < root.children.length; i += 1) {
    const child = root.children[i];
    if (
      child instanceof Element &&
      (child.hasAttribute('data-rcb-shape-layer') || child.hasAttribute('data-rcb-frame-layer'))
    ) {
      siblings.push(child);
    }
  }
  if (siblings.length < 2) return;

  const zOf = (el: Element): number | null => {
    if (!el.hasAttribute('data-z')) return null;
    return Number(el.getAttribute('data-z')) || 0;
  };
  const frameBias = (el: Element) => (el.hasAttribute('data-rcb-frame-layer') ? -1 : 1);

  let ordered = true;
  for (let i = 1; i < siblings.length; i += 1) {
    const za = zOf(siblings[i - 1]);
    const zb = zOf(siblings[i]);
    let cmp = 0;
    if (za == null || zb == null) {
      const fa = frameBias(siblings[i - 1]);
      const fb = frameBias(siblings[i]);
      if (fa !== fb) cmp = fa - fb;
      else if (za == null && zb == null) cmp = 0;
      else if (za == null) cmp = fa;
      else cmp = -fb;
    } else {
      cmp = za - zb;
    }
    if (cmp > 0) {
      ordered = false;
      break;
    }
  }
  if (ordered) return;

  siblings.sort((a, b) => {
    const za = zOf(a);
    const zb = zOf(b);
    if (za == null || zb == null) {
      const aFrame = a.hasAttribute('data-rcb-frame-layer');
      const bFrame = b.hasAttribute('data-rcb-frame-layer');
      if (aFrame !== bFrame) return aFrame ? -1 : 1;
      if (za == null && zb == null) return 0;
      if (za == null) return aFrame ? -1 : 1;
      return bFrame ? 1 : -1;
    }
    return za - zb;
  });
  for (const g of siblings) root.appendChild(g);
}

export function getSceneDrawPreviewMount() {
  return sceneDrawPreviewMount;
}

/** Align/gap guides — must share world SVG lattice (not a sibling surface). */
export function getSceneSmartGuidesMount() {
  return sceneSmartGuidesMount;
}

export function getSceneWorldEpoch() {
  return sceneWorldEpoch;
}

/**
 * Recover a host after HMR / race cleared the module Map but the DOM mini-board remains.
 */
function recoverShapeHost(nodeId: string): ShapeHostHandle | null {
  if (typeof document === 'undefined') return null;
  const hostEl = document.querySelector(`[data-rcb-shape-host="${CSS.escape(nodeId)}"]`);
  if (!(hostEl instanceof HTMLElement)) return null;

  const root = hostEl.querySelector('svg');
  const layer = root?.querySelector('#scene-layer');
  if (!(root instanceof SVGSVGElement) || !(layer instanceof SVGGElement)) return null;
  const handle: ShapeHostHandle = {
    nodeId,
    root,
    layer,
    el:
      (layer.querySelector(`[data-scene-node-id="${CSS.escape(nodeId)}"]`) as SVGElement | null) ||
      null,
    kind: 'svg',
  };
  registerShapeHost(handle);
  return handle;
}

/**
 * Rebuild one node's paint. Prefers per-shape SVG host; falls back to mono board.
 */
export async function replaceShapePaint(
  document: SceneDocument,
  nodeEls: Map<string, SceneHostEl>,
  nodeId: string,
  mono?: { root: SVGSVGElement; layer: SVGElement } | null
) {
  const host = hosts.get(nodeId) || recoverShapeHost(nodeId);

  if (host?.root && host.layer) {
    await replaceSvgNode(
      host.root,
      host.layer,
      document,
      nodeEls as Map<string, SVGElement>,
      nodeId
    );
    const el = (nodeEls.get(nodeId) as SVGElement | undefined) ?? null;
    if (el) {
      el.style.removeProperty('mix-blend-mode');
      el.style.opacity = '1';
      el.setAttribute('opacity', '1');
    }
    updateShapeHostElement(nodeId, el);
    dedupeSceneNode(host.layer, nodeId, el);
    return;
  }
  if (mono?.root && mono?.layer) {
    await replaceSvgNode(
      mono.root,
      mono.layer,
      document,
      nodeEls as Map<string, SVGElement>,
      nodeId
    );
  }
}
