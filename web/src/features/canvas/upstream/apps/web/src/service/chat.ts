/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/service/chat.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Chat / LLM API — models + image gen.
 */

import { abortAfter, apiQuery, queryClient } from '@recombyn-native/service/client';

export type ModelReferenceType = 'text' | 'vision' | 'image';

/** From admin catalog `imageLimits`. */
export type ImageLimits = {
  preset?: string;
  transport?: string;
  min_pixels?: number;
  max_pixels?: number;
  resolutions?: string[];
  default_resolution?: string;
  aspect_ratios?: string[];
  size_tables?: Record<string, Record<string, string>>;
  supports_output_format?: boolean;
  supports_quality?: boolean;
};

/** Catalog price provenance. */
export type ImagePriceMeta = {
  source?: string;
  billing?: string;
  unit?: string;
  usd_per_output_token?: number;
  fx_usd_cny?: number;
  base_resolution?: string;
  price_by_resolution_cny?: Record<string, number | string>;
  price_by_resolution?: Record<string, number | string>;
  output_image?: number;
  output_image_high?: number;
  high_pixels_threshold?: number;
  note?: string;
};

export type LlmModel = {
  id: string;
  label: string;
  provider: string;
  description?: string | null;
  kind?: 'text' | 'image' | 'svg' | 'video' | 'audio';
  referenceTypes?: ModelReferenceType[];
  reference_types?: ModelReferenceType[];
  thinking?: boolean;
  enabled?: boolean;
  iconUrl?: string | null;
  icon_url?: string | null;
  iconKey?: string | null;
  icon_key?: string | null;
  price?: string | null;
  priceMeta?: ImagePriceMeta | null;
  price_meta?: ImagePriceMeta | null;
  maxAttachments?: number;
  max_attachments?: number;
  imageLimits?: ImageLimits | null;
  image_limits?: ImageLimits | null;
};

/** Default generation params carried by image/video preset models. */
export type ByokPresetDefaults = {
  aspectRatios?: string[];
  resolutions?: string[];
  defaultResolution?: string;
  durations?: number[];
  defaultDuration?: number;
};

/** One selectable model under a legacy per-endpoint preset. */
export type ByokPresetModel = {
  apiModel: string;
  label: string;
  kind: 'text' | 'vision' | 'image' | 'video' | 'audio';
  thinking?: boolean;
  defaults?: ByokPresetDefaults;
};

/** Aggregator platform — one API key unlocks catalog models for that provider. */
export type ByokPlatform = {
  id: string;
  name: string;
  baseUrl: string;
  website?: string;
  iconKey?: string;
  kinds: Array<'text' | 'vision' | 'image' | 'video'>;
  /** Stable vault id, e.g. ``platform:openrouter``. */
  rowId: string;
  hint?: string;
};

/** @deprecated Prefer ByokPlatform — older ``byokPresets`` field. */
export type ByokPresetProvider = ByokPlatform & {
  models?: ByokPresetModel[];
};

export type ChatModelsResponse = {
  models: LlmModel[];
  available: boolean;
  imageModels?: LlmModel[];
  videoModels?: LlmModel[];
  audioModels?: LlmModel[];
  /** ISO country from GeoLite2 / edge headers when known. */
  clientRegion?: string | null;
  /** False when aggregator catalog is region-blocked. */
  openrouterAvailable?: boolean;
  /** Aggregator platforms — one key unlocks catalog models. */
  byokPlatforms?: ByokPlatform[];
  /** Alias of byokPlatforms for older clients. */
  byokPresets?: ByokPresetProvider[];
};

export type GenerateImageInput = {
  prompt: string;
  model?: string;
  aspect_ratio?: string;
  quality?: string;
  resolution?: string;
  images?: string[];
};

export type GenerateImageResult = {
  images: string[];
  text?: string | null;
  model: string;
  assets?: Array<{ url?: string | null; id?: string | null }> | null;
};

/** GET /api/v1/chat/models — Query-cached via oRPC. */
export function invalidateChatModelsCache() {
  void queryClient.invalidateQueries({ queryKey: apiQuery.chatGetModels.key() });
}

export async function listModels(opts?: { force?: boolean }): Promise<ChatModelsResponse> {
  if (opts?.force) {
    return queryClient.fetchQuery({
      ...apiQuery.chatGetModels.queryOptions(),
      staleTime: 0,
    }) as Promise<ChatModelsResponse>;
  }
  return queryClient.ensureQueryData({
    ...apiQuery.chatGetModels.queryOptions(),
    staleTime: 60_000,
  }) as Promise<ChatModelsResponse>;
}

/** Stage 1 keeps the native type boundary but never calls the Recombyn image job service. */
export async function generateImage(
  _data: GenerateImageInput,
  _opts?: { signal?: AbortSignal },
): Promise<GenerateImageResult> {
  throw new Error('Kith Media Job 尚未实现，Stage 1 暂不支持图片生成');
}

export type GenerateVideoInput = {
  prompt: string;
  model?: string;
  aspect_ratio?: string;
  resolution?: string;
  duration?: number;
  /** First-frame / style reference images (data URLs or http URLs). */
  images?: string[];
};

export type GenerateVideoResult = {
  videos: string[];
  text?: string | null;
  model: string;
  assets?: Array<{ url?: string | null; id?: string | null }> | null;
};

/** Stage 1 keeps the native type boundary but never calls the Recombyn video job service. */
export async function generateVideo(
  _data: GenerateVideoInput,
  _opts?: { signal?: AbortSignal },
): Promise<GenerateVideoResult> {
  throw new Error('Kith Media Job 尚未实现，Stage 1 暂不支持视频生成');
}

export type GenerateAudioInput = {
  prompt: string;
  model?: string;
  voice?: string;
  response_format?: string;
  speed?: number;
};

export type GenerateAudioResult = {
  audios: string[];
  model: string;
  voice?: string;
  mime?: string;
  assets?: Array<{ url?: string | null; id?: string | null }> | null;
};

/** Stage 1 keeps the native type boundary but never calls the Recombyn audio job service. */
export async function generateAudio(
  _data: GenerateAudioInput,
  _opts?: { signal?: AbortSignal },
): Promise<GenerateAudioResult> {
  throw new Error('Kith Media Job 尚未实现，Stage 1 暂不支持音频生成');
}
