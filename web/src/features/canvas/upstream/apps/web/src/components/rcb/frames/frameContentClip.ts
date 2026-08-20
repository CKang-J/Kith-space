/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/frames/frameContentClip.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { ArtboardFrame } from '@recombyn-native/components/rcb/frames/types';
import { ensureDefs, setAttrs, svgEl, urlRef } from '@recombyn-native/components/rcb/scene/paint/svgDom';

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

let clipSeq = 0;
function nextClipId(prefix: string) {
  clipSeq += 1;
  return `${prefix}-${clipSeq}`;
}

/**
 * clipContent frame for a node: largest bbox intersection, then smaller area, then topmost.
 */
export function findClippingFrameForNode(
  document: { frames?: ArtboardFrame[]; x?: number; y?: number } | null | undefined,
  node: Record<string, unknown> | null | undefined
): ArtboardFrame | null {
  if (!node || !document) return null;
  const frames = Array.isArray(document.frames) ? document.frames : [];
  if (!frames.length) return null;

  const nx = num(node.x);
  const ny = num(node.y);
  const nw = Math.max(1, num(node.width, 1));
  const nh = Math.max(1, num(node.height, 1));

  let best: ArtboardFrame | null = null;
  let bestInter = -1;
  let bestArea = Infinity;

  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const f = frames[i];
    if (!f || !f.clipContent || f.hidden) continue;
    const fw = Math.max(1, num(f.width, 1));
    const fh = Math.max(1, num(f.height, 1));
    const fx = num(f.x);
    const fy = num(f.y);

    const ix0 = Math.max(nx, fx);
    const iy0 = Math.max(ny, fy);
    const ix1 = Math.min(nx + nw, fx + fw);
    const iy1 = Math.min(ny + nh, fy + fh);
    const iw = ix1 - ix0;
    const ih = iy1 - iy0;
    if (iw <= 0 || ih <= 0) continue;

    const inter = iw * ih;
    const area = fw * fh;
    if (inter > bestInter || (inter === bestInter && area < bestArea)) {
      best = f;
      bestInter = inter;
      bestArea = area;
    }
  }
  return best;
}

/** Scene-space origin (matches nodeLeftTop / shape paint). */
function sceneOrigin(document: { x?: number; y?: number } | null | undefined) {
  return { ox: num(document?.x, 0), oy: num(document?.y, 0) };
}

function unwrapFrameClip(el: SVGElement) {
  const wrap = el.parentElement;
  if (wrap?.getAttribute('data-frame-clip-wrap') !== '1') {
    el.removeAttribute('clip-path');
    return;
  }
  const parent = wrap.parentNode;
  if (parent) {
    parent.insertBefore(el, wrap);
    try {
      wrap.remove();
    } catch {
      /* ignore */
    }
  }
  el.removeAttribute('clip-path');
}

/** Remove a painted node (and its frame-clip wrap, if any). */
export function detachSceneNodeEl(el: Element | null | undefined) {
  if (!el) return;
  const wrap = el.parentElement;
  try {
    if (wrap?.getAttribute('data-frame-clip-wrap') === '1') wrap.remove();
    else el.remove();
  } catch {
    /* ignore */
  }
}

/**
 * Clip a shape host to its owning clipContent frame.
 *
 * Clip sits on an **untransformed** wrapper with a **scene-absolute** rect — the
 * same lattice as `HtmlArtboardFrame` plate. Putting clip-path on the node `g`
 * (local fx−node) fights rotate and can desync half a pixel from the plate SVG
 * under browser zoom / fractional DPR (leak outside + hairline crop).
 */
export function applyFrameContentClip(
  root: SVGSVGElement,
  el: SVGElement | null | undefined,
  document: { frames?: ArtboardFrame[]; x?: number; y?: number } | null | undefined,
  node: Record<string, unknown> | null | undefined,
  opts?: { zoom?: number }
): void {
  if (!el || !root) return;
  const frame = findClippingFrameForNode(document, node);
  if (!frame) {
    unwrapFrameClip(el);
    return;
  }
  try {
    const { ox, oy } = sceneOrigin(document);
    const fx = num(frame.x) - ox;
    const fy = num(frame.y) - oy;
    const fw = Math.max(1, num(frame.width, 1));
    const fh = Math.max(1, num(frame.height, 1));
    // ~½ CSS px in scene space — kills AA bleed past the sibling plate SVG.
    const z = Math.max(0.05, Number(opts?.zoom) || 1);
    const inset = 0.5 / z;

    const id = nextClipId('frame-clip');
    const defs = ensureDefs(root);
    const clip = svgEl('clipPath', {
      id,
      clipPathUnits: 'userSpaceOnUse',
    });
    clip.appendChild(
      svgEl('rect', {
        x: fx + inset,
        y: fy + inset,
        width: Math.max(0, fw - inset * 2),
        height: Math.max(0, fh - inset * 2),
      })
    );
    defs.appendChild(clip);

    // SVG parentElement is typed as HTMLElement in DOM lib; clip wrap is an SVG `<g>`.
    let wrap: Element | null = el.parentElement;
    if (wrap?.getAttribute('data-frame-clip-wrap') !== '1') {
      const parent = el.parentNode;
      if (!parent) return;
      wrap = svgEl('g');
      setAttrs(wrap, { 'data-frame-clip-wrap': '1' });
      parent.insertBefore(wrap, el);
      wrap.appendChild(el);
    }
    setAttrs(wrap, { 'clip-path': urlRef(id) });
    // Clip must not live on the transformed node (local CS / rotate).
    el.removeAttribute('clip-path');
  } catch {
    /* ignore */
  }
}
