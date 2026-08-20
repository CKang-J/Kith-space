/**
 * Kith-owned Volcengine Ark catalog for generator pickers.
 * Keep ids / limits in sync with src/canvas/generation/arkModelCatalog.ts.
 */

export type KithImageLimits = {
  preset: string;
  transport: "doubao";
  min_pixels: number;
  max_pixels: number;
  resolutions: string[];
  default_resolution: string;
};

export type KithVideoLimits = {
  resolutions: string[];
  defaultResolution: string;
  durations: number[];
  defaultDuration: number;
  minDuration: number;
  maxDuration: number;
  aspectRatios: string[];
};

export type KithLlmModel = {
  id: string;
  label: string;
  provider: "doubao" | "openrouter";
  kind: "image" | "video" | "audio";
  description: string;
  iconKey: "doubao" | "openrouter" | "gemini" | "fishaudio";
  imageLimits?: KithImageLimits;
  videoLimits?: KithVideoLimits;
};

export const DEFAULT_KITH_IMAGE_MODEL_ID = "doubao-seedream-4-0-250828";
export const DEFAULT_KITH_VIDEO_MODEL_ID = "doubao-seedance-1-0-pro-250528";

export const KITH_IMAGE_MODELS: KithLlmModel[] = [
  {
    id: "doubao-seedream-5-0-pro-260628",
    label: "Seedream 5.0 Pro",
    provider: "doubao",
    kind: "image",
    description: "旗舰画质与细节；分辨率 1K / 2K",
    iconKey: "doubao",
    imageLimits: {
      preset: "seedream_5_pro",
      transport: "doubao",
      min_pixels: 1280 * 720,
      max_pixels: Math.floor(2048 * 2048 * 1.1025),
      resolutions: ["1K", "2K"],
      default_resolution: "2K",
    },
  },
  {
    id: "doubao-seedream-5-0-260128",
    label: "Seedream 5.0 Lite",
    provider: "doubao",
    kind: "image",
    description: "更快更省；分辨率 2K / 3K / 4K",
    iconKey: "doubao",
    imageLimits: {
      preset: "seedream_5_lite",
      transport: "doubao",
      min_pixels: 2560 * 1440,
      max_pixels: 4096 * 4096,
      resolutions: ["2K", "3K", "4K"],
      default_resolution: "2K",
    },
  },
  {
    id: "doubao-seedream-4-5-251128",
    label: "Seedream 4.5",
    provider: "doubao",
    kind: "image",
    description: "画质与速度均衡；分辨率 2K / 4K，无 1K",
    iconKey: "doubao",
    imageLimits: {
      preset: "seedream_4_5",
      transport: "doubao",
      min_pixels: 2560 * 1440,
      max_pixels: 4096 * 4096,
      resolutions: ["2K", "4K"],
      default_resolution: "2K",
    },
  },
  {
    id: DEFAULT_KITH_IMAGE_MODEL_ID,
    label: "Seedream 4.0",
    provider: "doubao",
    kind: "image",
    description: "低成本稳定出图；分辨率 1K / 2K / 4K",
    iconKey: "doubao",
    imageLimits: {
      preset: "seedream_4_0",
      transport: "doubao",
      min_pixels: 1280 * 720,
      max_pixels: 4096 * 4096,
      resolutions: ["1K", "2K", "4K"],
      default_resolution: "2K",
    },
  },
];

export const KITH_VIDEO_MODELS: KithLlmModel[] = [
  {
    id: DEFAULT_KITH_VIDEO_MODEL_ID,
    label: "Seedance 1.0 Pro",
    provider: "doubao",
    kind: "video",
    description: "文生/图生视频；480p / 720p / 1080p，2–12 秒",
    iconKey: "doubao",
    videoLimits: {
      resolutions: ["480p", "720p", "1080p"],
      defaultResolution: "720p",
      durations: [4, 5, 6, 7, 8, 10, 12],
      defaultDuration: 5,
      minDuration: 2,
      maxDuration: 12,
      aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    },
  },
  {
    id: "doubao-seedance-1-0-lite-t2v-250428",
    label: "Seedance 1.0 Lite",
    provider: "doubao",
    kind: "video",
    description: "更快更省；无 1080p，2–12 秒",
    iconKey: "doubao",
    videoLimits: {
      resolutions: ["480p", "720p"],
      defaultResolution: "720p",
      durations: [4, 5, 6, 7, 8, 10, 12],
      defaultDuration: 5,
      minDuration: 2,
      maxDuration: 12,
      aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    },
  },
];

export function kithImageModels(): KithLlmModel[] {
  return KITH_IMAGE_MODELS;
}

export function kithVideoModels(): KithLlmModel[] {
  return KITH_VIDEO_MODELS;
}

export function videoLimitsForModel(model?: { id?: string; videoLimits?: KithVideoLimits } | null): KithVideoLimits {
  return model?.videoLimits
    ?? KITH_VIDEO_MODELS.find((item) => item.id === model?.id)?.videoLimits
    ?? KITH_VIDEO_MODELS[0]!.videoLimits!;
}

export function clampToVideoLimits(
  limits: KithVideoLimits,
  current: { resolution?: string; duration?: number; aspectRatio?: string },
): { resolution: string; duration: number; aspectRatio: string } {
  const resolution = limits.resolutions.includes(String(current.resolution || ""))
    ? String(current.resolution)
    : limits.defaultResolution;
  const requestedDuration = Number(current.duration);
  const duration = limits.durations.includes(requestedDuration)
    ? requestedDuration
    : nearestNumber(limits.durations, requestedDuration, limits.defaultDuration);
  const aspectRatio = limits.aspectRatios.includes(String(current.aspectRatio || ""))
    ? String(current.aspectRatio)
    : "16:9";
  return { resolution, duration, aspectRatio };
}

function nearestNumber(allowed: number[], value: number, fallback: number): number {
  if (!allowed.length || !Number.isFinite(value)) return fallback;
  return allowed.reduce((best, item) => (
    Math.abs(item - value) < Math.abs(best - value) ? item : best
  ), allowed[0]!);
}
