/**
 * Volcengine Ark Seedream / Seedance catalog used by Human generators and Workers.
 * Limits follow Recombyn ImageAspectRatioPicker presets plus current Ark docs:
 * Seedream 4.0: 1K/2K/4K; 4.5: 2K/4K; 5.0 lite: 2K/3K/4K; 5.0 pro: 1K/2K.
 * Seedance 1.0 Pro: 480p/720p/1080p, 2–12s; Lite: 480p/720p (no 1080p), 2–12s.
 * Seedance 2.0 / OpenRouter ids are not Ark-native and stay out of this catalog.
 */

export const DEFAULT_DOUBAO_IMAGE_MODEL = "doubao-seedream-4-0-250828";
export const DEFAULT_SEEDREAM_VIDEO_MODEL = "doubao-seedance-1-0-pro-250528";

export const IMAGE_ASPECT_RATIOS = [
  "smart",
  "21:9",
  "16:9",
  "3:2",
  "4:3",
  "1:1",
  "3:4",
  "2:3",
  "9:16",
] as const;

export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];
export type NamedImageAspectRatio = Exclude<ImageAspectRatio, "smart">;
export type ImageResolutionTier = "1K" | "2K" | "3K" | "4K";
export type VideoResolutionTier = "480p" | "720p" | "1080p";
export type VideoAspectRatio = "21:9" | "16:9" | "9:16" | "4:3" | "3:4" | "1:1";

export interface ArkImageModel {
  id: string;
  label: string;
  description: string;
  preset: "seedream_5_pro" | "seedream_5_lite" | "seedream_4_5" | "seedream_4_0";
  resolutions: ImageResolutionTier[];
  defaultResolution: ImageResolutionTier;
  minPixels: number;
  maxPixels: number;
}

export interface ArkVideoModel {
  id: string;
  label: string;
  description: string;
  resolutions: VideoResolutionTier[];
  defaultResolution: VideoResolutionTier;
  durations: number[];
  defaultDuration: number;
  minDuration: number;
  maxDuration: number;
  aspectRatios: VideoAspectRatio[];
}

export const ARK_IMAGE_MODELS: readonly ArkImageModel[] = [
  {
    id: "doubao-seedream-5-0-pro-260628",
    label: "Seedream 5.0 Pro",
    description: "旗舰画质与细节；Ark size 仅 1K / 2K",
    preset: "seedream_5_pro",
    resolutions: ["1K", "2K"],
    defaultResolution: "2K",
    minPixels: 1280 * 720,
    maxPixels: Math.floor(2048 * 2048 * 1.1025),
  },
  {
    id: "doubao-seedream-5-0-260128",
    label: "Seedream 5.0 Lite",
    description: "更快更省的 5.0；Ark size 为 2K / 3K / 4K",
    preset: "seedream_5_lite",
    resolutions: ["2K", "3K", "4K"],
    defaultResolution: "2K",
    minPixels: 2560 * 1440,
    maxPixels: 4096 * 4096,
  },
  {
    id: "doubao-seedream-4-5-251128",
    label: "Seedream 4.5",
    description: "画质与速度均衡；Ark size 为 2K / 4K（无 1K）",
    preset: "seedream_4_5",
    resolutions: ["2K", "4K"],
    defaultResolution: "2K",
    minPixels: 2560 * 1440,
    maxPixels: 4096 * 4096,
  },
  {
    id: DEFAULT_DOUBAO_IMAGE_MODEL,
    label: "Seedream 4.0",
    description: "低成本稳定出图；Ark size 为 1K / 2K / 4K",
    preset: "seedream_4_0",
    resolutions: ["1K", "2K", "4K"],
    defaultResolution: "2K",
    minPixels: 1280 * 720,
    maxPixels: 4096 * 4096,
  },
];

export const ARK_VIDEO_MODELS: readonly ArkVideoModel[] = [
  {
    id: DEFAULT_SEEDREAM_VIDEO_MODEL,
    label: "Seedance 1.0 Pro",
    description: "文生/图生视频，480p / 720p / 1080p，2–12 秒",
    resolutions: ["480p", "720p", "1080p"],
    defaultResolution: "720p",
    durations: [4, 5, 6, 7, 8, 10, 12],
    defaultDuration: 5,
    minDuration: 2,
    maxDuration: 12,
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
  },
  {
    id: "doubao-seedance-1-0-lite-t2v-250428",
    label: "Seedance 1.0 Lite",
    description: "更快更省；Ark 无 1080p，时长 2–12 秒",
    resolutions: ["480p", "720p"],
    defaultResolution: "720p",
    durations: [4, 5, 6, 7, 8, 10, 12],
    defaultDuration: 5,
    minDuration: 2,
    maxDuration: 12,
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
  },
];

const IMAGE_BY_ID = new Map(ARK_IMAGE_MODELS.map((model) => [model.id, model]));
const VIDEO_BY_ID = new Map(ARK_VIDEO_MODELS.map((model) => [model.id, model]));

const SIZE_1K: Record<string, string> = {
  "1:1": "1024x1024",
  "16:9": "1280x720",
  "9:16": "720x1280",
  "4:3": "1152x864",
  "3:4": "864x1152",
  "3:2": "1248x832",
  "2:3": "832x1248",
  "21:9": "1680x720",
};

const SIZE_2K: Record<string, string> = {
  "1:1": "2048x2048",
  "16:9": "2560x1440",
  "9:16": "1440x2560",
  "4:3": "2304x1728",
  "3:4": "1728x2304",
  "3:2": "2496x1664",
  "2:3": "1664x2496",
  "21:9": "3024x1296",
};

const SIZE_3K: Record<string, string> = {
  "1:1": "3072x3072",
  "16:9": "3840x2160",
  "9:16": "2160x3840",
  "4:3": "3456x2592",
  "3:4": "2592x3456",
  "3:2": "3744x2496",
  "2:3": "2496x3744",
  "21:9": "4536x1944",
};

const SIZE_4K: Record<string, string> = {
  "1:1": "4096x4096",
  "16:9": "5504x3040",
  "9:16": "3040x5504",
  "4:3": "4704x3520",
  "3:4": "3520x4704",
  "3:2": "4992x3328",
  "2:3": "3328x4992",
  "21:9": "6240x2656",
};

const SIZE_TABLES: Record<ImageResolutionTier, Record<string, string>> = {
  "1K": SIZE_1K,
  "2K": SIZE_2K,
  "3K": SIZE_3K,
  "4K": SIZE_4K,
};

export function findArkImageModel(modelId?: string | null): ArkImageModel | undefined {
  const id = String(modelId || "").trim();
  if (IMAGE_BY_ID.has(id)) return IMAGE_BY_ID.get(id);
  return inferImageModel(id);
}

export function findArkVideoModel(modelId?: string | null): ArkVideoModel | undefined {
  const id = String(modelId || "").trim();
  if (VIDEO_BY_ID.has(id)) return VIDEO_BY_ID.get(id);
  return inferVideoModel(id);
}

export function resolveArkImageModel(modelId?: string | null): ArkImageModel {
  return findArkImageModel(modelId) ?? IMAGE_BY_ID.get(DEFAULT_DOUBAO_IMAGE_MODEL)!;
}

export function resolveArkVideoModel(modelId?: string | null): ArkVideoModel {
  return findArkVideoModel(modelId) ?? VIDEO_BY_ID.get(DEFAULT_SEEDREAM_VIDEO_MODEL)!;
}

export function isKnownArkImageModelId(modelId: string): boolean {
  return Boolean(findArkImageModel(modelId));
}

export function isKnownArkVideoModelId(modelId: string): boolean {
  return Boolean(findArkVideoModel(modelId));
}

export function clampImageResolution(
  resolution: string | undefined,
  model: ArkImageModel,
): ImageResolutionTier {
  const next = String(resolution || "").trim().toUpperCase() as ImageResolutionTier;
  if (model.resolutions.includes(next)) return next;
  return model.defaultResolution;
}

export function clampVideoResolution(
  resolution: string | undefined,
  model: ArkVideoModel,
): VideoResolutionTier {
  const next = String(resolution || "").trim().toLowerCase() as VideoResolutionTier;
  if (model.resolutions.includes(next)) return next;
  return model.defaultResolution;
}

export function clampVideoDuration(duration: number | undefined, model: ArkVideoModel): number {
  if (typeof duration !== "number" || !Number.isFinite(duration)) return model.defaultDuration;
  return Math.min(model.maxDuration, Math.max(model.minDuration, Math.round(duration)));
}

export function clampVideoAspectRatio(
  aspectRatio: string | undefined,
  model: ArkVideoModel,
): VideoAspectRatio {
  const next = String(aspectRatio || "").trim() as VideoAspectRatio;
  if (model.aspectRatios.includes(next)) return next;
  return "16:9";
}

export function isSmartImageAspect(aspectRatio?: string | null): boolean {
  const raw = String(aspectRatio || "").trim().toLowerCase();
  return !raw || raw === "smart" || raw === "auto";
}

/** Ark `size`: K-label when Smart; otherwise WxH inside that model's pixel budget. */
export function arkImageSizeForModel(
  modelId: string | undefined,
  aspectRatio: string | undefined,
  resolution: string | undefined,
): string {
  const model = resolveArkImageModel(modelId);
  const tier = clampImageResolution(resolution, model);
  if (isSmartImageAspect(aspectRatio)) return tier;
  const named = normalizeNamedAspect(aspectRatio);
  const cell = SIZE_TABLES[tier]?.[named];
  if (!cell) return tier;
  return clampPixelCell(cell, model);
}

function inferImageModel(blob: string): ArkImageModel | undefined {
  const lower = blob.toLowerCase();
  if (lower.includes("seedream-5-0-pro") || lower.includes("seedream_5_0_pro")) {
    return ARK_IMAGE_MODELS.find((model) => model.preset === "seedream_5_pro");
  }
  if (lower.includes("seedream-5-0") || lower.includes("seedream_5_0")) {
    return ARK_IMAGE_MODELS.find((model) => model.preset === "seedream_5_lite");
  }
  if (lower.includes("seedream-4-5") || lower.includes("seedream_4_5")) {
    return ARK_IMAGE_MODELS.find((model) => model.preset === "seedream_4_5");
  }
  if (lower.includes("seedream-4-0") || lower.includes("seedream_4_0")) {
    return ARK_IMAGE_MODELS.find((model) => model.preset === "seedream_4_0");
  }
  return undefined;
}

function inferVideoModel(blob: string): ArkVideoModel | undefined {
  const lower = blob.toLowerCase();
  if (lower.includes("lite")) {
    return ARK_VIDEO_MODELS.find((model) => model.id.includes("lite"));
  }
  if (lower.includes("seedance")) {
    return ARK_VIDEO_MODELS.find((model) => model.id === DEFAULT_SEEDREAM_VIDEO_MODEL);
  }
  return undefined;
}

function normalizeNamedAspect(aspectRatio?: string | null): NamedImageAspectRatio {
  const raw = String(aspectRatio || "").trim();
  if ((IMAGE_ASPECT_RATIOS as readonly string[]).includes(raw) && raw !== "smart") {
    return raw as NamedImageAspectRatio;
  }
  return "1:1";
}

function clampPixelCell(cell: string, model: ArkImageModel): string {
  const [widthRaw, heightRaw] = cell.split("x");
  const widthValue = Number(widthRaw);
  const heightValue = Number(heightRaw);
  if (!(widthValue > 0) || !(heightValue > 0)) return cell;
  let width = roundDim(widthValue);
  let height = roundDim(heightValue);
  let area = width * height;
  if (area < model.minPixels) {
    const scale = Math.sqrt(model.minPixels / area);
    width = roundDim(width * scale);
    height = roundDim(height * scale);
    while (width * height < model.minPixels) {
      if (width <= height) width += 16;
      else height += 16;
    }
    area = width * height;
  }
  if (area > model.maxPixels) {
    const scale = Math.sqrt(model.maxPixels / area);
    width = roundDim(width * scale);
    height = roundDim(height * scale);
    while (width * height > model.maxPixels && (width > 16 || height > 16)) {
      if (width >= height && width > 16) width -= 16;
      else if (height > 16) height -= 16;
      else break;
    }
  }
  return `${width}x${height}`;
}

function roundDim(value: number): number {
  return Math.max(16, Math.round(value / 16) * 16);
}
