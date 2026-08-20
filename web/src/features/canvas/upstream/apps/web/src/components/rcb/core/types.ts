/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/core/types.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/** RCB canvas — shared types. */

export type RcbVec = { x: number; y: number };

export type RcbBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Camera: screen = scene * zoom + (x, y). */
export type RcbCamera = {
  x: number;
  y: number;
  zoom: number;
};

export const RCB_DEFAULT_CAMERA: RcbCamera = { x: 80, y: 60, zoom: 1 };
