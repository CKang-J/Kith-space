/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/scene/paint/svgPaint.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';
/**
 * Fill / shadow paint onto native SVG elements.
 */

import {
  ensureDefs,
  setAttrs,
  setFill,
  setStyles,
  svgEl,
  urlRef,
  XLINK_NS,
} from './svgDom';
import {
  resolveLinearCoords,
  stopsWithOpacity,
  type FillImageFit,
  type SvgPaint,
} from '../document/sceneFill';
import { resolveShadow, type ShadowSpec } from '../document/sceneEffects';

let paintSeq = 0;

function nextPaintId(prefix: string) {
  paintSeq += 1;
  return `${prefix}-${paintSeq}`;
}

function preserveAspectForFit(fit: FillImageFit) {
  if (fit === 'fit') return 'xMidYMid meet';
  if (fit === 'crop' || fit === 'fill') return 'xMidYMid slice';
  return 'none';
}

function tileSize(width: number, height: number) {
  return {
    w: Math.max(24, Math.round(width / 3)),
    h: Math.max(24, Math.round(height / 3)),
  };
}

/** Apply fill paint (solid / gradient / image pattern) onto an SVG element. */
export function applySvgFill(
  svg: SVGSVGElement,
  el: SVGElement,
  paint: SvgPaint,
  idHint = 'fill'
) {
  if (paint.kind === 'none') {
    setFill(el, 'none');
    return;
  }
  if (paint.kind === 'solid') {
    setFill(el, paint.color);
    return;
  }

  const defs = ensureDefs(svg);

  if (paint.kind === 'pattern') {
    const id = nextPaintId(idHint);
    const fit = paint.imageFit ?? 'fill';
    const rotate = paint.imageRotate ?? 0;
    const filter = paint.imageFilter;
    const opacityPct = paint.opacityPct ?? 100;
    const tile = fit === 'tile' ? tileSize(paint.width, paint.height) : null;
    const patternW = tile?.w ?? paint.width;
    const patternH = tile?.h ?? paint.height;

    const pattern = svgEl('pattern', {
      id,
      width: patternW,
      height: patternH,
      patternUnits: 'userSpaceOnUse',
    });
    const img = svgEl('image', {
      width: patternW,
      height: patternH,
      preserveAspectRatio: preserveAspectForFit(fit),
    });
    img.setAttributeNS(XLINK_NS, 'href', paint.dataUrl);
    img.setAttribute('href', paint.dataUrl);
    if (filter) setStyles(img, { filter });
    if (rotate) {
      img.setAttribute(
        'transform',
        `rotate(${rotate} ${patternW / 2} ${patternH / 2})`
      );
    }
    pattern.appendChild(img);
    defs.appendChild(pattern);
    setFill(el, urlRef(id));
    el.setAttribute('fill-opacity', String(Math.max(0, Math.min(1, opacityPct / 100))));
    return;
  }

  const id = nextPaintId(idHint);
  const stops = stopsWithOpacity(paint.gradient.colorStops, paint.opacityPct);

  if (paint.kind === 'linear') {
    const c = resolveLinearCoords(paint.gradient);
    const grad = svgEl('linearGradient', {
      id,
      x1: `${c.x1 * 100}%`,
      y1: `${c.y1 * 100}%`,
      x2: `${c.x2 * 100}%`,
      y2: `${c.y2 * 100}%`,
      gradientUnits: 'objectBoundingBox',
    });
    for (const s of stops) {
      grad.appendChild(
        svgEl('stop', { offset: String(s.offset), 'stop-color': s.color })
      );
    }
    defs.appendChild(grad);
    setFill(el, urlRef(id));
    return;
  }

  const cx = (paint.gradient.cx ?? 50) / 100;
  const cy = (paint.gradient.cy ?? 50) / 100;
  const r = Math.max(0.01, (paint.gradient.r ?? 50) / 100);
  const grad = svgEl('radialGradient', {
    id,
    cx: `${cx * 100}%`,
    cy: `${cy * 100}%`,
    r: `${r * 100}%`,
    fx: `${cx * 100}%`,
    fy: `${cy * 100}%`,
    gradientUnits: 'objectBoundingBox',
  });
  for (const s of stops) {
    grad.appendChild(
      svgEl('stop', { offset: String(s.offset), 'stop-color': s.color })
    );
  }
  defs.appendChild(grad);
  setFill(el, urlRef(id));
}

export function applySvgShadow(el: SVGElement, shadow: ShadowSpec) {
  if (!shadow) {
    setStyles(el, { filter: null });
    return;
  }
  setStyles(el, {
    filter: `drop-shadow(${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px ${shadow.color})`,
  });
}

export function applyNodeShadow(_svg: SVGSVGElement, el: SVGElement, node: SceneNodeInput) {
  applySvgShadow(el, resolveShadow(node));
}
