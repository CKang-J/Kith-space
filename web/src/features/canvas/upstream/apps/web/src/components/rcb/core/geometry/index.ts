/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/core/geometry/index.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
export { PathBuilder, type Pt } from './PathBuilder';
export {
  getShapeBaseline,
  getShapeBaselineD,
  arrowBaselinePath,
  lineBaselinePath,
  ARROW_HEAD,
  type ShapeBaseline,
  type BaselineSizeOpts,
} from './baseline';
