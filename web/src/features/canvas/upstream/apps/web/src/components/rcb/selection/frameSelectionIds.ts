/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/selection/frameSelectionIds.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/** Synthetic selection ids for artboard frames (marquee / multi-select). */
export const FRAME_SEL_PREFIX = '__frame__:';

export function frameSelId(frameId: string) {
  return `${FRAME_SEL_PREFIX}${frameId}`;
}

export function parseFrameSelId(selId: string): string | null {
  const s = String(selId || '');
  if (!s.startsWith(FRAME_SEL_PREFIX)) return null;
  const id = s.slice(FRAME_SEL_PREFIX.length);
  return id || null;
}
