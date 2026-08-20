import type { CanvasGenerationJob } from "@/features/canvas/adapters/canvasCoreApi";

/** Image jobs (t2i, i2i, remove-bg) wait this long in the UI before surfacing an error. */
export const IMAGE_JOB_WAIT_MS = 90_000;

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

export type CanvasMediaGenerationInput = {
  jobType: "image" | "video" | "audio";
  genPrompt: string;
  targetNodeId: string;
  node?: {
    x?: unknown;
    y?: unknown;
    width?: unknown;
    height?: unknown;
    frameId?: unknown;
    parentId?: unknown;
    attrs?: Record<string, unknown> | null;
  } | null;
  fallbackBox?: { x: number; y: number; width: number; height: number };
  aspectRatio?: string;
  duration?: number;
  referenceAssetId?: string;
  model?: string;
  resolution?: string;
  signal?: AbortSignal;
};

type GenerationBridge = {
  createJob: (body: {
    jobType: "image" | "video" | "audio";
    genPrompt: string;
    placement: {
      x: number;
      y: number;
      width: number;
      height: number;
      frameId?: string;
      parentId?: string;
      name?: string;
      targetNodeId?: string;
      skipNodeCreate?: boolean;
    };
    config?: {
      aspectRatio?: GenerationAspectRatio;
      duration?: number;
      referenceAssetId?: string;
      model?: string;
      resolution?: string;
      removeBg?: boolean;
      cutoutMode?: "product" | "hair";
    };
    idempotencyKey: string;
  }) => Promise<CanvasGenerationJob>;
  getJob: (jobId: string) => Promise<CanvasGenerationJob>;
};

let activeBridge: GenerationBridge | null = null;

export function configureRecombynGenerationBridge(bridge: GenerationBridge | null): () => void {
  activeBridge = bridge;
  return () => { if (activeBridge === bridge) activeBridge = null; };
}

export function asGenerationAspectRatio(raw: string | undefined | null): GenerationAspectRatio | undefined {
  const value = String(raw || "").trim();
  if (
    value === "smart"
    || value === "1:1"
    || value === "16:9"
    || value === "9:16"
    || value === "4:3"
    || value === "3:4"
    || value === "3:2"
    || value === "2:3"
    || value === "21:9"
  ) return value;
  return undefined;
}

export function firstReferenceAssetId(
  contexts: Array<{ uploadKey?: string; payload?: string; dataUrl?: string; thumbUrl?: string }> | undefined,
  extraSrc?: string,
): string | undefined {
  for (const item of contexts ?? []) {
    const fromKey = String(item.uploadKey || "").trim();
    if (fromKey) return fromKey;
    const fromUrl = canvasAssetIdFromUrl(item.payload) || canvasAssetIdFromUrl(item.dataUrl) || canvasAssetIdFromUrl(item.thumbUrl);
    if (fromUrl) return fromUrl;
  }
  return canvasAssetIdFromUrl(extraSrc);
}

export function canvasAssetIdFromUrl(src: string | undefined | null): string | undefined {
  const match = /^\/api\/canvas-assets\/[^/]+\/[^/]+\/([^/]+)$/.exec(String(src || "").trim());
  if (!match) return undefined;
  try { return decodeURIComponent(match[1]!).trim() || undefined; }
  catch { return undefined; }
}

export function canvasNodePlacement(
  node: CanvasMediaGenerationInput["node"],
  fallback?: CanvasMediaGenerationInput["fallbackBox"],
): { x: number; y: number; width: number; height: number; frameId?: string; parentId?: string; name?: string } {
  const x = finiteNumber(node?.x, fallback?.x, 0);
  const y = finiteNumber(node?.y, fallback?.y, 0);
  const width = positiveNumber(node?.width, fallback?.width, 320);
  const height = positiveNumber(node?.height, fallback?.height, 180);
  const frameId = optionalString(node?.frameId);
  const parentId = optionalString(node?.parentId);
  const name = optionalString(node?.attrs?.name);
  return { x, y, width, height, ...(frameId ? { frameId } : {}), ...(parentId ? { parentId } : {}), ...(name ? { name } : {}) };
}

export async function runCanvasMediaGeneration(input: CanvasMediaGenerationInput): Promise<CanvasGenerationJob> {
  if (!activeBridge) throw new Error("Canvas generation is not connected");
  const prompt = input.genPrompt.trim();
  if (!prompt) throw new Error("Prompt is required");
  const placement = {
    ...canvasNodePlacement(input.node, input.fallbackBox),
    targetNodeId: input.targetNodeId,
  };
  const aspectRatio = asGenerationAspectRatio(input.aspectRatio);
  const model = optionalString(input.model);
  const resolution = optionalString(input.resolution);
  const job = await activeBridge.createJob({
    jobType: input.jobType,
    genPrompt: prompt,
    placement,
    config: {
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(input.jobType === "video" && input.duration != null ? { duration: input.duration } : {}),
      ...(input.referenceAssetId ? { referenceAssetId: input.referenceAssetId } : {}),
      ...(model ? { model } : {}),
      ...(resolution ? { resolution } : {}),
    },
    idempotencyKey: crypto.randomUUID(),
  });
  return waitForCanvasGenerationJob(job.id, {
    signal: input.signal,
    intervalMs: input.jobType === "video" ? 3000 : 1500,
    timeoutMs: input.jobType === "video" ? 8 * 60_000 : IMAGE_JOB_WAIT_MS,
    timeoutMessage: input.jobType === "audio" ? "Audio generation timed out" : "Generation timed out",
  });
}

export type CanvasImageProcessInput = {
  genPrompt: string;
  referenceAssetId: string;
  resolution?: string;
  removeBg?: boolean;
  cutoutMode?: "product" | "hair";
  signal?: AbortSignal;
};

/** Image toolbar process: import result asset only, do not create a second node. */
export async function runCanvasImageProcess(input: CanvasImageProcessInput): Promise<CanvasGenerationJob> {
  if (!activeBridge) throw new Error("Canvas generation is not connected");
  const prompt = input.genPrompt.trim();
  if (!prompt) throw new Error("Prompt is required");
  const referenceAssetId = optionalString(input.referenceAssetId);
  if (!referenceAssetId) throw new Error("reference image is required");
  const resolution = optionalString(input.resolution);
  const job = await activeBridge.createJob({
    jobType: "image",
    genPrompt: prompt,
    placement: { x: 0, y: 0, width: 1, height: 1, skipNodeCreate: true },
    config: {
      referenceAssetId,
      ...(resolution ? { resolution } : {}),
      ...(input.removeBg ? { removeBg: true } : {}),
      ...(input.cutoutMode ? { cutoutMode: input.cutoutMode } : {}),
    },
    idempotencyKey: crypto.randomUUID(),
  });
  return waitForCanvasGenerationJob(job.id, {
    signal: input.signal,
    intervalMs: 1500,
    timeoutMs: IMAGE_JOB_WAIT_MS,
  });
}

export async function waitForCanvasGenerationJob(
  jobId: string,
  opts?: { signal?: AbortSignal; intervalMs?: number; timeoutMs?: number; timeoutMessage?: string },
): Promise<CanvasGenerationJob> {
  if (!activeBridge) throw new Error("Canvas generation is not connected");
  const started = Date.now();
  const intervalMs = opts?.intervalMs ?? 1500;
  const timeoutMs = opts?.timeoutMs ?? IMAGE_JOB_WAIT_MS;
  let current = await activeBridge.getJob(jobId);
  while (current.status === "pending" || current.status === "processing") {
    if (opts?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (Date.now() - started > timeoutMs) {
      throw new Error(formatGenerationWaitError(opts?.timeoutMessage || "Generation timed out"));
    }
    await delay(intervalMs, opts?.signal);
    current = await activeBridge.getJob(jobId);
  }
  if (current.status === "completed") return current;
  throw new Error(formatGenerationWaitError(current.errorMessage || "Generation failed"));
}

export function formatGenerationWaitError(message: string): string {
  const text = String(message || "").trim();
  if (/audio generation timed out/i.test(text)) {
    return "生成超时：请检查 OpenRouter API Key 与网络后重试；卡住的任务不会自动完成。";
  }
  if (/timed out/i.test(text)) {
    return "生成超时：图生图会把原图发给方舟，通常比文生图慢。请检查网络后重试；卡住的任务不会自动完成。";
  }
  return text || "Generation failed";
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

function finiteNumber(...candidates: Array<unknown>): number {
  for (const value of candidates) {
    const next = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(next)) return next;
  }
  return 0;
}

function positiveNumber(...candidates: Array<unknown>): number {
  for (const value of candidates) {
    const next = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(next) && next > 0) return next;
  }
  return 1;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
