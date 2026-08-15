/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/selection/rotateCornerCursor.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import rotateCornerSvg from '@recombyn-native/assets/svg/editor/rotate_corner.svg?raw';

/** Inner paths from `editor/rotate_corner.svg`. */
function extractInnerMarkup(svgRaw: string): string {
  const match = svgRaw.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
  return (match?.[1] || '').trim();
}

const INNER = extractInnerMarkup(rotateCornerSvg);

/**
 * CSS cursor using the shared rotate_corner.svg asset, rotated per corner + selection angle.
 * Offsets: nwse=0, nesw=90, senw=180, swne=270.
 */
export function cursorForRotate(iconDeg: number, angleDeg: number): string {
  const r = ((iconDeg + angleDeg) % 360 + 360) % 360;
  const rad = (-r * Math.PI) / 180;
  const s = Math.sin(rad);
  const c = Math.cos(rad);
  const dx = 1 * c - 1 * s;
  const dy = 1 * s + 1 * c;
  const svg =
    `<svg height='32' width='32' viewBox='0 0 32 32' xmlns='http://www.w3.org/2000/svg'>` +
    `<defs><filter id='shadow' y='-40%' x='-40%' width='180px' height='180%' color-interpolation-filters='sRGB'>` +
    `<feDropShadow dx='${dx}' dy='${dy}' stdDeviation='1.2' flood-opacity='.5'/></filter></defs>` +
    `<g fill='none' transform='rotate(${r} 16 16)' filter='url(%23shadow)'>${INNER}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 16, grab`;
}
