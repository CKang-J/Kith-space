import { canvasAssetIdFromUrl, runCanvasImageProcess } from "./recombynGeneration";
import { uploadImageFromSrc } from "./recombynDurableMedia";

export type ImageProcessKindApi =
  | "upscale"
  | "removeBg"
  | "multiAngle"
  | "expand"
  | "editText"
  | "editElements"
  | "detectRegions"
  | "replaceText"
  | "vector"
  | "adjust";

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
  type: "image" | "text" | string;
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
  layers?: ImageDecomposeLayer[];
  width?: number;
  height?: number;
  warnings?: string[];
  engines?: string[];
  credits?: number;
};

const IMAGE_RESOLUTIONS = new Set(["1K", "2K", "3K", "4K"]);
const UNSUPPORTED_KINDS = new Set(["editElements", "editText", "detectRegions", "vector"]);
const inflightByKey = new Map<string, Promise<ImageProcessResult>>();

export function unsupportedImageProcessKindMessage(kind: string): string {
  if (kind === "editElements" || kind === "editText" || kind === "detectRegions") {
    return "图片分层 / detectRegions 需要独立视觉分解服务，尚未接入火山方舟";
  }
  return `图片处理「${kind}」尚未接入`;
}

export function imageProcessPrompt(
  kind: string,
  meta: Record<string, unknown> = {},
  resolution?: string,
): string {
  switch (kind) {
    case "upscale":
      return `Upscale this image to ${resolution || "2K"}. Preserve identity, composition, lighting, textures, and every character of text exactly. Do not add, remove, or restyle objects.`;
    case "removeBg":
      return "Remove the background completely. Keep the subject sharp with clean edges on a transparent background.";
    case "multiAngle": {
      const rotate = Number(meta.rotate) || 0;
      const tilt = Number(meta.tilt) || 0;
      const zoom = Number(meta.zoom) || 1;
      const mode = String(meta.mode || "camera");
      return `Re-render this subject from a new ${mode} view. Horizontal yaw ${rotate} degrees, vertical pitch ${tilt} degrees, zoom ${zoom}. Keep the same identity, materials, colors, and lighting. Do not add new objects or text.`;
    }
    case "expand":
      return "Outpaint this image to fill the new canvas. Continue the existing scene, lighting, and textures naturally. Do not change the original content in the unexpanded region.";
    case "replaceText": {
      const original = String(meta.originalText || "").trim();
      const next = String(meta.newText || "").trim();
      if (!next) throw new Error("替换文字不能为空");
      return original
        ? `Replace the visible text "${original}" with exactly "${next}". Keep layout, lettering style, and the rest of the image unchanged.`
        : `Replace the visible lettering with exactly "${next}". Keep layout, lettering style, and the rest of the image unchanged.`;
    }
    default:
      throw new Error(unsupportedImageProcessKindMessage(kind));
  }
}

export async function processImageTool(
  data: ImageProcessBody,
  opts?: { signal?: AbortSignal },
): Promise<ImageProcessResult> {
  const kind = String(data.kind || "").trim();
  const image = String(data.image || "").trim();
  if (!image) throw new Error("未找到图片");
  if (UNSUPPORTED_KINDS.has(kind)) throw new Error(unsupportedImageProcessKindMessage(kind));
  const meta = data.meta && typeof data.meta === "object" && !Array.isArray(data.meta) ? data.meta : {};
  const resolution = asImageResolution(data.resolution) ?? asImageResolution(meta.resolution);
  const key = JSON.stringify({ kind, image, meta, resolution });
  let shared = inflightByKey.get(key);
  if (!shared) {
    shared = runImageProcessJob(kind, image, meta, resolution);
    inflightByKey.set(key, shared);
    void shared.finally(() => {
      if (inflightByKey.get(key) === shared) inflightByKey.delete(key);
    });
  }
  return await withOptionalAbort(shared, opts?.signal);
}

async function runImageProcessJob(
  kind: string,
  image: string,
  meta: Record<string, unknown>,
  resolution?: string,
): Promise<ImageProcessResult> {
  const prompt = imageProcessPrompt(kind, meta, resolution);
  const referenceAssetId = await ensureReferenceAssetId(image);
  const job = await runCanvasImageProcess({
    genPrompt: prompt,
    referenceAssetId,
    resolution,
    ...(kind === "removeBg" ? { removeBg: true, cutoutMode: asCutoutMode(meta.cutoutMode) } : {}),
  });
  const result = String(job.resultSrc || "").trim();
  if (!result) throw new Error("图片处理未返回结果");
  return { image: result, kind };
}

function withOptionalAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function ensureReferenceAssetId(image: string, signal?: AbortSignal): Promise<string> {
  const existing = canvasAssetIdFromUrl(image);
  if (existing) return existing;
  const uploaded = await uploadImageFromSrc(image, "process-source.png", { signal });
  const key = String(uploaded.key || "").trim();
  if (key) return key;
  throw new Error("无法保存参考图");
}

function asImageResolution(value: unknown): string | undefined {
  const resolution = String(value || "").trim().toUpperCase();
  return IMAGE_RESOLUTIONS.has(resolution) ? resolution : undefined;
}

function asCutoutMode(value: unknown): "product" | "hair" | undefined {
  return value === "product" || value === "hair" ? value : undefined;
}
