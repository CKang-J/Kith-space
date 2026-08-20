import { and, eq, isNull } from "drizzle-orm";
import { CanvasCore, CanvasNotFoundError, CanvasValidationError } from "../canvasCore.js";
import type { SpaceDb } from "../../db/index.js";
import { schema } from "../../db/index.js";
import type {
  GenerationAspectRatio,
  GenerationJobConfig,
  GenerationJobPlacement,
  GenerationJobRow,
  GenerationJobType,
} from "./contracts.js";
import { createGenerationJob } from "./generationJobQueue.js";
import { durableCanvasAssetSrc } from "../canvasToolOps.js";
import { preferredGenerationProvider } from "./generationProviders.js";
import {
  clampImageResolution,
  clampVideoDuration,
  clampVideoResolution,
  isKnownArkImageModelId,
  isKnownArkVideoModelId,
  resolveArkImageModel,
  resolveArkVideoModel,
} from "./arkModelCatalog.js";

const ASPECT_RATIOS = new Set([
  "smart",
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "21:9",
]);
const IMAGE_RESOLUTIONS = new Set(["1K", "2K", "3K", "4K"]);
const VIDEO_RESOLUTIONS = new Set(["480p", "720p", "1080p"]);
const ID_MAX = 160;
const PROMPT_MAX = 2000;

export interface HumanCanvasGenerationInput {
  jobType: unknown;
  genPrompt: unknown;
  placement: unknown;
  config?: unknown;
  idempotencyKey: unknown;
}

export function enqueueHumanCanvasGenerationJob(
  db: SpaceDb,
  spaceId: string,
  canvasId: string,
  input: HumanCanvasGenerationInput,
): GenerationJobRow {
  const jobType = parseJobType(input.jobType);
  const genPrompt = parsePrompt(input.genPrompt);
  const placement = parsePlacement(input.placement);
  const config = parseConfig(input.config, jobType);
  const idempotencyKey = parseIdempotencyKey(input.idempotencyKey);
  const core = new CanvasCore(db, spaceId);
  const live = core.read(canvasId);
  if (config.referenceAssetId) assertCanvasAsset(db, spaceId, canvasId, config.referenceAssetId);
  const provider = preferredGenerationProvider(jobType);
  if (!provider) {
    throw new CanvasValidationError(jobType === "video"
      ? "configure Seedance in Settings or set KITH_CANVAS_SEEDREAM_API_KEY / KITH_CANVAS_ARK_API_KEY"
      : "configure Doubao in Settings or set KITH_CANVAS_DOUBAO_API_KEY / KITH_CANVAS_ARK_API_KEY");
  }
  return createGenerationJob(db, {
    canvasId: live.id,
    jobType,
    genPrompt,
    config,
    placement,
    provider: provider.name,
    idempotencyKey,
    expectedRevision: live.revisions.revision,
  });
}

function parseJobType(value: unknown): GenerationJobType {
  if (value === "image" || value === "video") return value;
  throw new CanvasValidationError("jobType must be image or video");
}

function parsePrompt(value: unknown): string {
  if (typeof value !== "string") throw new CanvasValidationError("genPrompt is required");
  const prompt = value.trim();
  if (!prompt) throw new CanvasValidationError("genPrompt is required");
  if (prompt.length > PROMPT_MAX) throw new CanvasValidationError("genPrompt is too long");
  return prompt;
}

function parseIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > ID_MAX) {
    throw new CanvasValidationError("idempotencyKey is required");
  }
  return value.trim();
}

function parsePlacement(value: unknown): GenerationJobPlacement {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CanvasValidationError("placement is required");
  }
  const raw = value as Record<string, unknown>;
  const x = numberOf(raw.x, "placement.x");
  const y = numberOf(raw.y, "placement.y");
  const width = positiveNumber(raw.width, "placement.width");
  const height = positiveNumber(raw.height, "placement.height");
  return {
    x,
    y,
    width,
    height,
    frameId: optionalId(raw.frameId, "placement.frameId"),
    parentId: optionalId(raw.parentId, "placement.parentId"),
    name: optionalName(raw.name),
    customId: optionalId(raw.customId, "placement.customId"),
    targetNodeId: optionalId(raw.targetNodeId, "placement.targetNodeId"),
    skipNodeCreate: raw.skipNodeCreate === true ? true : undefined,
  };
}

function parseConfig(value: unknown, jobType: GenerationJobType): GenerationJobConfig {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new CanvasValidationError("config must be an object");
  }
  const raw = value as Record<string, unknown>;
  const config: GenerationJobConfig = {};
  if (raw.aspectRatio != null) {
    if (typeof raw.aspectRatio !== "string" || !ASPECT_RATIOS.has(raw.aspectRatio)) {
      throw new CanvasValidationError("config.aspectRatio must be smart, 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, or 21:9");
    }
    config.aspectRatio = raw.aspectRatio as GenerationAspectRatio;
  }
  if (raw.model != null) {
    if (typeof raw.model !== "string" || !raw.model.trim() || raw.model.length > 200) {
      throw new CanvasValidationError("config.model is invalid");
    }
    const model = raw.model.trim();
    if (jobType === "image" && !isKnownArkImageModelId(model)) {
      throw new CanvasValidationError("config.model is not a supported Seedream model");
    }
    if (jobType === "video" && !isKnownArkVideoModelId(model)) {
      throw new CanvasValidationError("config.model is not a supported Seedance model");
    }
    config.model = model;
  }
  if (raw.resolution != null) {
    if (typeof raw.resolution !== "string" || !raw.resolution.trim()) {
      throw new CanvasValidationError("config.resolution is invalid");
    }
    if (jobType === "image") {
      const resolution = raw.resolution.trim().toUpperCase();
      if (!IMAGE_RESOLUTIONS.has(resolution)) {
        throw new CanvasValidationError("config.resolution must be 1K, 2K, 3K, or 4K for image jobs");
      }
      config.resolution = clampImageResolution(resolution, resolveArkImageModel(config.model));
    } else {
      const resolution = raw.resolution.trim().toLowerCase();
      if (!VIDEO_RESOLUTIONS.has(resolution)) {
        throw new CanvasValidationError("config.resolution must be 480p, 720p, or 1080p for video jobs");
      }
      config.resolution = clampVideoResolution(resolution, resolveArkVideoModel(config.model));
    }
  }
  if (raw.duration != null) {
    if (jobType !== "video") throw new CanvasValidationError("config.duration is only valid for video jobs");
    const duration = Number(raw.duration);
    if (!Number.isFinite(duration)) throw new CanvasValidationError("config.duration must be a number");
    config.duration = clampVideoDuration(duration, resolveArkVideoModel(config.model));
  }
  if (raw.referenceAssetId != null) {
    const id = optionalId(raw.referenceAssetId, "config.referenceAssetId");
    if (id) config.referenceAssetId = id;
  }
  if (raw.letteringText != null) {
    if (typeof raw.letteringText !== "string" || raw.letteringText.length > 200) {
      throw new CanvasValidationError("config.letteringText is invalid");
    }
    config.letteringText = raw.letteringText;
  }
  if (raw.removeBg != null) {
    if (typeof raw.removeBg !== "boolean") throw new CanvasValidationError("config.removeBg must be a boolean");
    config.removeBg = raw.removeBg;
  }
  if (raw.cutoutMode != null) {
    if (raw.cutoutMode !== "product" && raw.cutoutMode !== "hair") {
      throw new CanvasValidationError("config.cutoutMode must be product or hair");
    }
    config.cutoutMode = raw.cutoutMode;
  }
  if (raw.stylePreset != null) {
    if (typeof raw.stylePreset !== "string" || raw.stylePreset.length > 100) {
      throw new CanvasValidationError("config.stylePreset is invalid");
    }
    config.stylePreset = raw.stylePreset;
  }
  return config;
}

function numberOf(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new CanvasValidationError(`${label} must be a finite number`);
  return value;
}

function positiveNumber(value: unknown, label: string): number {
  const next = numberOf(value, label);
  if (!(next > 0)) throw new CanvasValidationError(`${label} must be positive`);
  return next;
}

function optionalId(value: unknown, label: string): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > ID_MAX) {
    throw new CanvasValidationError(`${label} is invalid`);
  }
  return value.trim();
}

function optionalName(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 200) throw new CanvasValidationError("placement.name is invalid");
  return value;
}

function assertCanvasAsset(db: SpaceDb, spaceId: string, canvasId: string, assetId: string): void {
  const asset = db.select({ id: schema.canvasAssets.id }).from(schema.canvasAssets).innerJoin(
    schema.canvasDocuments,
    eq(schema.canvasDocuments.id, schema.canvasAssets.canvasId),
  ).where(and(
    eq(schema.canvasAssets.id, assetId),
    eq(schema.canvasAssets.canvasId, canvasId),
    eq(schema.canvasAssets.state, "ready"),
    isNull(schema.canvasAssets.deletedAt),
    eq(schema.canvasDocuments.spaceId, spaceId),
    isNull(schema.canvasDocuments.deletedAt),
  )).get();
  if (!asset) throw new CanvasValidationError("reference asset does not exist on this Canvas");
}

export function publicGenerationJob(job: GenerationJobRow, spaceId?: string) {
  return {
    id: job.id,
    canvasId: job.canvasId,
    jobType: job.jobType,
    status: job.status,
    genPrompt: job.genPrompt,
    resultAssetId: job.resultAssetId,
    resultNodeId: job.resultNodeId,
    resultSrc: job.resultAssetId && spaceId
      ? durableCanvasAssetSrc(spaceId, job.canvasId, job.resultAssetId)
      : null,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  };
}

export { CanvasNotFoundError, CanvasValidationError };
