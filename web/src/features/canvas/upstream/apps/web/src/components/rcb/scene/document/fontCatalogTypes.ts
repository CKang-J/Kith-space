/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/scene/document/fontCatalogTypes.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/** Shared font catalog types (FontFamily / FontChild). */

export type FontFaceFormat = 'woff2' | 'woff' | 'truetype' | 'opentype';

export type FontChild = {
  family: string;
  displayName: string;
  /** Optional file URL — registered as its own @font-face family when set. */
  url?: string;
  format?: FontFaceFormat;
  /** CSS fontWeight when several children share one family name. */
  weight?: number;
};

export type FontFamilyNode = {
  family: string;
  displayName: string;
  url?: string;
  format?: FontFaceFormat;
  children: FontChild[];
};

export type FontWeightOption = {
  value: string;
  label: string;
  weight?: number;
};
