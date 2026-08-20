export type GenerationJobType = "image" | "video" | "audio";

export type GenerationJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export type GenerationProvider =
  | "doubao"
  | "seedream"
  | "openrouter"
  | "stability"
  | "runway"
  | "dalle"
  | "pika";

export const IMAGE_GENERATION_PROVIDERS = ["doubao", "stability", "dalle"] as const;
export const VIDEO_GENERATION_PROVIDERS = ["seedream", "runway", "pika"] as const;
export const AUDIO_GENERATION_PROVIDERS = ["openrouter"] as const;

export function generationProviderType(name: GenerationProvider): GenerationJobType {
  if ((AUDIO_GENERATION_PROVIDERS as readonly string[]).includes(name)) return "audio";
  if ((IMAGE_GENERATION_PROVIDERS as readonly string[]).includes(name)) return "image";
  return "video";
}

export type GenerationAspectRatio =
  | "smart"
  | "1:1"
  | "16:9"
  | "9:16"
  | "4:3"
  | "3:4"
  | "3:2"
  | "2:3"
  | "21:9";

export interface GenerationJobConfig {
  letteringText?: string;
  removeBg?: boolean;
  cutoutMode?: "product" | "hair";
  aspectRatio?: GenerationAspectRatio;
  stylePreset?: string;
  duration?: number;
  referenceAssetId?: string;
  /** Ark inference model id, e.g. doubao-seedream-4-0-250828. */
  model?: string;
  /** Image: 1K/2K/3K/4K. Video: 480p/720p/1080p. */
  resolution?: string;
  /** OpenRouter TTS voice id; omitted when the catalog model has a provider default. */
  voice?: string;
}

export interface GenerationJobPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  frameId?: string;
  parentId?: string;
  name?: string;
  customId?: string;
  /** Human generator plate / quick-edit node to promote in place. */
  targetNodeId?: string;
  /**
   * Import the result asset only. Image toolbar process clones already exist in
   * the renderer document; creating another node would duplicate the plate.
   */
  skipNodeCreate?: boolean;
}

export interface GenerationJobRow {
  id: string;
  canvasId: string;
  jobType: GenerationJobType;
  status: GenerationJobStatus;
  genPrompt: string;
  configJson: string | null;
  placementJson: string;
  provider: GenerationProvider;
  providerJobId: string | null;
  errorMessage: string | null;
  retryCount: number;
  resultAssetId: string | null;
  resultNodeId: string | null;
  turnId: string | null;
  idempotencyKey: string;
  expectedRevision: number;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

export interface CreateGenerationJobParams {
  canvasId: string;
  jobType: GenerationJobType;
  genPrompt: string;
  config?: GenerationJobConfig;
  placement: GenerationJobPlacement;
  provider: GenerationProvider;
  turnId?: string;
  idempotencyKey: string;
  expectedRevision: number;
}

export interface GenerationRequest {
  prompt: string;
  config?: GenerationJobConfig;
  referenceImage?: Buffer;
}

export type GenerationStatus =
  | { status: "pending" | "processing" }
  | { status: "completed"; resultUrl: string }
  | { status: "failed"; error: string };

export interface IGenerationProvider {
  readonly name: GenerationProvider;
  readonly type: GenerationJobType;
  submit(params: GenerationRequest): Promise<string>;
  getStatus(providerJobId: string): Promise<GenerationStatus>;
  downloadResult(providerJobId: string): Promise<Buffer>;
  cancel?(providerJobId: string): Promise<void>;
}
