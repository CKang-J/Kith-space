/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/models/assets.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * User AI asset types.
 */

export type AssetKind = "image" | "video" | "audio" | "font" | "lottie";

export type UserAsset = {
  id: string;
  kind: AssetKind;
  url: string;
  objectKey?: string | null;
  mime?: string | null;
  width?: number | null;
  height?: number | null;
  source?: string | null;
  prompt?: string | null;
  meta?: Record<string, unknown> | null;
  /** Bodymovin JSON for lottie — list API inlines this; do not refetch .json url. */
  animationData?: Record<string, unknown> | null;
  createdAt?: number | null;
};
