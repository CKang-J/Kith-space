/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/service/imageTools.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Image toolbar AI tools — POST /api/v1/image/process
 * (Seedream i2i, or vision decompose for editText / editElements).
 */

import { abortAfter, apiClient } from '@recombyn-native/service/client';

export type ImageProcessKindApi =
  | 'upscale'
  | 'removeBg'
  | 'multiAngle'
  | 'expand'
  | 'editText'
  | 'editElements'
  | 'detectRegions'
  | 'replaceText'
  | 'vector'
  | 'adjust';

export type ImageProcessBody = {
  kind: ImageProcessKindApi | string;
  image: string;
  meta?: Record<string, unknown>;
  aspect_ratio?: string;
  quality?: string;
  resolution?: string;
  model?: string;
};

export type ImageDecomposeLayer = {
  type: 'image' | 'text' | string;
  src?: string;
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string | number;
  fill?: string;
  lineHeight?: number;
};

export type ImageProcessResult = {
  image: string;
  text?: string | null;
  kind: string;
  model?: string;
  /** editText / editElements: split layers in source-pixel coords */
  layers?: ImageDecomposeLayer[];
  width?: number;
  height?: number;
  warnings?: string[];
  engines?: string[];
  /** Credits charged for this tool call (server-side). */
  credits?: number;
};

/** Run an image toolbar tool on the API (Seedream i2i or local rembg / OCR). */
export const processImageTool = (
  data: ImageProcessBody,
  opts?: { signal?: AbortSignal }
) =>
  apiClient.imageToolsPostImageProcess(
    { body: data as never },
    { signal: abortAfter(180_000, opts?.signal) }
  ) as Promise<ImageProcessResult>;
