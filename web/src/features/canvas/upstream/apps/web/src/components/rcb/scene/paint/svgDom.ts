/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/scene/paint/svgDom.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Thin native SVG helpers — no SVG.js, no chaining facade.
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const XLINK_NS = 'http://www.w3.org/1999/xlink';

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number | null | undefined>
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
  if (attrs) setAttrs(el, attrs);
  return el;
}

export function setAttrs(
  el: Element,
  attrs: Record<string, string | number | null | undefined>
): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) el.removeAttribute(k);
    else el.setAttribute(k, String(v));
  }
}

export function setStyles(
  el: HTMLElement | SVGElement,
  styles: Record<string, string | null | undefined>
): void {
  for (const [k, v] of Object.entries(styles)) {
    if (v == null) el.style.removeProperty(k);
    else el.style.setProperty(k, v);
  }
}

export function append(parent: Element, child: Element): void {
  parent.appendChild(child);
}

export function clearChildren(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function setFill(el: Element, fill: string): void {
  el.setAttribute('fill', fill);
}

export function setStroke(
  el: Element,
  stroke:
    | 'none'
    | {
        color: string;
        width: number;
        linecap?: string;
        linejoin?: string;
        dasharray?: string;
      }
): void {
  if (stroke === 'none') {
    el.setAttribute('stroke', 'none');
    el.removeAttribute('stroke-width');
    return;
  }
  el.setAttribute('stroke', stroke.color);
  el.setAttribute('stroke-width', String(stroke.width));
  if (stroke.linecap) el.setAttribute('stroke-linecap', stroke.linecap);
  if (stroke.linejoin) el.setAttribute('stroke-linejoin', stroke.linejoin);
  if (stroke.dasharray) el.setAttribute('stroke-dasharray', stroke.dasharray);
}

export function ensureDefs(svg: SVGSVGElement): SVGDefsElement {
  let defs = svg.querySelector(':scope > defs') as SVGDefsElement | null;
  if (!defs) {
    defs = svgEl('defs');
    svg.insertBefore(defs, svg.firstChild);
  }
  return defs;
}

export function urlRef(id: string): string {
  return `url(#${id})`;
}

export function createSvgRoot(host: HTMLElement): SVGSVGElement {
  clearChildren(host);
  const root = svgEl('svg');
  host.appendChild(root);
  return root;
}

export function getBBox(el: SVGGraphicsElement): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  try {
    const b = el.getBBox();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  } catch {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
}
