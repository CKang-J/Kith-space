/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/canvas/pointerToWorld.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { rcbResolveViewportEl, rcbScreenToScene, type RcbCamera } from '@recombyn-native/components/rcb';

export type ArtboardRect = { x?: number; y?: number; width: number; height: number };

export function pointerToWorld(
  camera: RcbCamera,
  opts: {
    stageEl?: HTMLElement | null;
    paperEl?: HTMLElement | null;
    viewportEl?: HTMLElement | null;
    artboard?: ArtboardRect;
  },
  clientX: number,
  clientY: number
): { x: number; y: number } {
  // Prefer a connected stage — EditorPage stageEl can go stale after resize remounts.
  const stage = rcbResolveViewportEl(opts.viewportEl, opts.stageEl);
  if (stage) return rcbScreenToScene(camera, stage, clientX, clientY);
  if (opts.paperEl && opts.artboard) {
    const rect = opts.paperEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    const w = Math.max(1, opts.artboard.width);
    const h = Math.max(1, opts.artboard.height);
    const ox = Number(opts.artboard.x) || 0;
    const oy = Number(opts.artboard.y) || 0;
    return {
      x: ox + ((clientX - rect.left) / rect.width) * w,
      y: oy + ((clientY - rect.top) / rect.height) * h,
    };
  }
  return { x: 0, y: 0 };
}
