/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/core/dprDebug.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Temporary DPR / subpixel diagnostics.
 * Enable:  window.__RCB_DPR_DEBUG__ = true
 * Dump now: window.__rcbDumpDpr?.()
 *
 * Align guides: window.__RCB_ALIGN_DEBUG__ = true
 * Last align dump: window.__rcbLastAlignDump
 * Dump now: window.__rcbDumpAlign?.()
 *
 * Default OFF — enable explicitly when debugging browser-zoom seams.
 */

import { nearestDprMultiple } from './dpr';
import { rcbSceneToScreen } from './math';
import type { RcbCamera } from './types';

declare global {
  interface Window {
    __RCB_DPR_DEBUG__?: boolean;
    __RCB_ALIGN_DEBUG__?: boolean;
    __rcbDumpDpr?: () => void;
    __rcbDumpAlign?: () => void;
    __rcbDumpGrid?: () => Record<string, unknown>;
    __rcbLastDprDump?: Record<string, unknown>;
    __rcbLastAlignDump?: Record<string, unknown>;
    __rcbLastGridDump?: Record<string, unknown>;
  }
}

const TAG = '[rcb:dpr]';

function debugEnabled() {
  if (typeof window === 'undefined') return false;
  // Opt-in only — default OFF (was spamming + noise during 90% zoom tests).
  return window.__RCB_DPR_DEBUG__ === true;
}

function frac(n: number) {
  return Math.abs(n - Math.round(n));
}

function classify(devicePx: number) {
  const f = frac(devicePx);
  if (f < 0.02 || f > 0.98) return 'integer';
  if (f > 0.45 && f < 0.55) return 'half';
  return 'frac';
}

/** Scene → CSS px under camera (uses snapped camera pan). */
export function sceneToCss(camera: RcbCamera, sceneX: number, sceneY: number, dpr?: number) {
  return rcbSceneToScreen(camera, sceneX, sceneY, dpr);
}

export type DprEdgeSample = {
  id: string;
  scene: { left: number; top: number; right: number; bottom: number };
  css: { left: number; top: number; right: number; bottom: number };
  device: { left: number; top: number; right: number; bottom: number };
  edgeClass: {
    left: string;
    top: string;
    right: string;
    bottom: string;
  };
};

export function sampleBoxEdges(
  id: string,
  box: { left: number; top: number; width: number; height: number },
  camera: RcbCamera,
  dpr: number
): DprEdgeSample {
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  const tl = sceneToCss(camera, box.left, box.top, dpr);
  const br = sceneToCss(camera, right, bottom, dpr);
  const device = {
    left: tl.x * dpr,
    top: tl.y * dpr,
    right: br.x * dpr,
    bottom: br.y * dpr,
  };
  return {
    id,
    scene: { left: box.left, top: box.top, right, bottom },
    css: { left: tl.x, top: tl.y, right: br.x, bottom: br.y },
    device,
    edgeClass: {
      left: classify(device.left),
      top: classify(device.top),
      right: classify(device.right),
      bottom: classify(device.bottom),
    },
  };
}

/** Gap between A's right edge and B's left edge in device pixels. */
export function adjacentSeam(
  a: DprEdgeSample,
  b: DprEdgeSample
): { cssGap: number; deviceGap: number; aRightClass: string; bLeftClass: string } | null {
  // Prefer horizontal neighbors: A left of B
  const cssGap = b.css.left - a.css.right;
  if (Math.abs(cssGap) > 40) return null;
  return {
    cssGap,
    deviceGap: b.device.left - a.device.right,
    aRightClass: a.edgeClass.right,
    bLeftClass: b.edgeClass.left,
  };
}

export function logDprCameraState(opts: {
  reason: string;
  dpr: number;
  camera: RcbCamera;
  camCss?: { x: number; y: number; z: number };
}) {
  if (!debugEnabled()) return;
  const { reason, dpr, camera, camCss } = opts;
  const multiple = nearestDprMultiple(dpr);
  const payload = {
    reason,
    dpr,
    dprMultiple: multiple,
    dprTimesMultiple: dpr * multiple,
    dprIsFractional: Math.abs(dpr - Math.round(dpr)) > 0.02,
    camera: { ...camera },
    camCssWritten: camCss ?? {
      x: camera.x,
      y: camera.y,
      z: camera.zoom,
    },
    // After CSS scale(z) translate(x,y), a scene unit becomes zoom CSS px → zoom*dpr device px.
    sceneUnitDevicePx: camera.zoom * dpr,
    visualViewportScale:
      typeof window !== 'undefined' && window.visualViewport
        ? window.visualViewport.scale
        : undefined,
  };
  window.__rcbLastDprDump = payload;
  console.log(TAG, reason, payload);
}

export function logEdgeSamples(
  reason: string,
  samples: DprEdgeSample[],
  dpr: number,
  camera: RcbCamera
) {
  if (!debugEnabled() || !samples.length) return;
  console.groupCollapsed(`${TAG} edges · ${reason} · n=${samples.length}`);
  console.table(
    samples.map((s) => ({
      id: s.id.slice(0, 12),
      sceneL: s.scene.left,
      sceneR: s.scene.right,
      cssL: +s.css.left.toFixed(3),
      cssR: +s.css.right.toFixed(3),
      devL: +s.device.left.toFixed(3),
      devR: +s.device.right.toFixed(3),
      classL: s.edgeClass.left,
      classR: s.edgeClass.right,
      classT: s.edgeClass.top,
      classB: s.edgeClass.bottom,
    }))
  );

  // Check pairwise horizontal seams (likely adjacent rects).
  const seams: Array<Record<string, unknown>> = [];
  for (let i = 0; i < samples.length; i++) {
    for (let j = 0; j < samples.length; j++) {
      if (i === j) continue;
      const seam = adjacentSeam(samples[i], samples[j]);
      if (!seam) continue;
      if (Math.abs(seam.cssGap) > 8) continue;
      seams.push({
        a: samples[i].id.slice(0, 12),
        b: samples[j].id.slice(0, 12),
        cssGap: +seam.cssGap.toFixed(4),
        deviceGap: +seam.deviceGap.toFixed(4),
        aRight: seam.aRightClass,
        bLeft: seam.bLeftClass,
        suspect:
          Math.abs(seam.deviceGap) > 0.15 ||
          seam.aRightClass !== 'integer' ||
          seam.bLeftClass !== 'integer',
      });
    }
  }
  if (seams.length) {
    console.log(TAG, 'adjacent seams (cssGap≈0 = touching in scene*zoom)', {
      dpr,
      zoom: camera.zoom,
    });
    console.table(seams);
  } else {
    console.log(TAG, 'no near-horizontal adjacent pairs found in sample');
  }
  console.groupEnd();
}

export function installDprDebugHelpers(getState: () => {
  dpr: number;
  camera: RcbCamera;
  boxes?: Array<{ id: string; left: number; top: number; width: number; height: number }>;
}) {
  if (typeof window === 'undefined') return;
  window.__rcbDumpDpr = () => {
    const { dpr, camera, boxes = [] } = getState();
    logDprCameraState({ reason: 'manual-dump', dpr, camera });
    const samples = boxes.map((b) =>
      sampleBoxEdges(b.id, b, camera, dpr)
    );
    logEdgeSamples('manual-dump', samples, dpr, camera);
  };
  window.__rcbDumpAlign = () => {
    const last = window.__rcbLastAlignDump;
    if (!last) {
      console.warn(TAG, 'no align dump yet — enable __RCB_ALIGN_DEBUG__ and drag to snap');
      return;
    }
    console.log(TAG, 'align dump (copy JSON)', JSON.stringify(last, null, 2));
  };
  window.__rcbDumpGrid = () => dumpGridVsHosts(getState);
}

const GRID_TAG = '[rcb:grid]';

function parsePx(v: string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function onGrid(value: number, g: number) {
  if (!(g > 0)) return true;
  const q = Math.round(value / g) * g;
  return Math.abs(value - q) < 1e-6;
}

/** Measure infinite-canvas grid SVG vs shape hosts — always prints JSON. */
export function dumpGridVsHosts(getState: () => {
  dpr: number;
  camera: RcbCamera;
  boxes?: Array<{ id: string; left: number; top: number; width: number; height: number }>;
}): Record<string, unknown> {
  const { dpr, camera, boxes = [] } = getState();
  const world = document.querySelector('[data-rcb-world="1"]') as HTMLElement | null;
  const grid = document.querySelector('[data-rcb-pixel-grid="1"]') as SVGSVGElement | null;
  const g = Number(grid?.getAttribute('data-rcb-grid-size') || 1) || 1;
  const gridLeft = parsePx(grid?.getAttribute('data-rcb-grid-left'));
  const gridTop = parsePx(grid?.getAttribute('data-rcb-grid-top'));
  const gridStyleLeft = parsePx(grid?.style?.left);
  const gridStyleTop = parsePx(grid?.style?.top);
  const gridRect = grid?.getBoundingClientRect?.() ?? null;
  const worldTf = world?.style?.transform || '';

  const hosts = Array.from(document.querySelectorAll('[data-rcb-infinite="1"]:not([data-rcb-pixel-grid])'));
  const hostRows = hosts.slice(0, 24).map((node, i) => {
    const el = node as SVGSVGElement;
    const left = parsePx(el.style.left) ?? parsePx(el.getAttribute('x'));
    const top = parsePx(el.style.top) ?? parsePx(el.getAttribute('y'));
    const vb = (el.getAttribute('viewBox') || '').trim();
    const rect = el.getBoundingClientRect();
    const sceneLeft = left;
    const sceneTop = top;
    return {
      i,
      tag: el.tagName,
      sceneLeft,
      sceneTop,
      viewBox: vb,
      onGridX: sceneLeft == null ? null : onGrid(sceneLeft, g),
      onGridY: sceneTop == null ? null : onGrid(sceneTop, g),
      fracX: sceneLeft == null ? null : sceneLeft - Math.round(sceneLeft / g) * g,
      fracY: sceneTop == null ? null : sceneTop - Math.round(sceneTop / g) * g,
      client: {
        left: +rect.left.toFixed(3),
        top: +rect.top.toFixed(3),
        width: +rect.width.toFixed(3),
        height: +rect.height.toFixed(3),
      },
    };
  });

  const boxRows = boxes.map((b) => {
    const sample = sampleBoxEdges(b.id, b, camera, dpr);
    return {
      id: b.id,
      scene: sample.scene,
      onGrid: {
        left: onGrid(b.left, g),
        top: onGrid(b.top, g),
        right: onGrid(b.left + b.width, g),
        bottom: onGrid(b.top + b.height, g),
      },
      frac: {
        left: b.left - Math.round(b.left / g) * g,
        top: b.top - Math.round(b.top / g) * g,
        right: b.left + b.width - Math.round((b.left + b.width) / g) * g,
        bottom: b.top + b.height - Math.round((b.top + b.height) / g) * g,
      },
      css: sample.css,
      device: sample.device,
      edgeClass: sample.edgeClass,
    };
  });

  // Same parent? Grid must be under [data-rcb-world], sibling of shape hosts.
  const gridParentIsWorld = Boolean(grid && world && grid.parentElement === world);

  const payload: Record<string, unknown> = {
    dpr,
    visualViewportScale: window.visualViewport?.scale ?? null,
    camera: { ...camera },
    grid: {
      present: Boolean(grid),
      parentIsWorld: gridParentIsWorld,
      gridSize: g,
      attrOrigin: { left: gridLeft, top: gridTop },
      styleOrigin: { left: gridStyleLeft, top: gridStyleTop },
      viewBox: grid?.getAttribute('viewBox') || null,
      pathLen: grid?.querySelector('path')?.getAttribute('d')?.length ?? 0,
      usesPattern: Boolean(grid?.querySelector('pattern')),
      client: gridRect
        ? {
            left: +gridRect.left.toFixed(3),
            top: +gridRect.top.toFixed(3),
            width: +gridRect.width.toFixed(3),
            height: +gridRect.height.toFixed(3),
          }
        : null,
    },
    worldTransform: worldTf,
    stateBoxes: boxRows,
    domHosts: hostRows,
  };

  window.__rcbLastGridDump = payload;
  console.log(GRID_TAG, 'dump', payload);
  console.log(GRID_TAG, 'json', JSON.stringify(payload));
  return payload;
}

const ALIGN_TAG = '[rcb:align]';

function alignDebugEnabled() {
  if (typeof window === 'undefined') return false;
  return window.__RCB_ALIGN_DEBUG__ === true || window.__RCB_DPR_DEBUG__ === true;
}

/** Opt-in JSON dump while orange align guides are active (browser-zoom seams). */
export function logAlignGuideDump(payload: Record<string, unknown>) {
  if (!alignDebugEnabled()) return;
  window.__rcbLastAlignDump = payload;
  console.log(ALIGN_TAG, 'dump', payload);
  // One-line copy-friendly JSON for pasting back into chat.
  try {
    console.log(ALIGN_TAG, 'json', JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}
