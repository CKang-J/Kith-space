import type { GenerationJobConfig, GenerationJobPlacement } from "./contracts.js";
import { arkImageSizeForModel } from "./arkModelCatalog.js";

export const ARK_URL_JOB_PREFIX = "ark-url:";

export const ARK_IMAGE_SIZES = {
  "1:1": "2048x2048",
  "16:9": "2560x1440",
  "9:16": "1440x2560",
  "4:3": "2304x1728",
  "3:4": "1728x2304",
} as const;

const ASPECT_TARGETS: Array<{ ratio: keyof typeof ARK_IMAGE_SIZES; value: number }> = [
  { ratio: "1:1", value: 1 },
  { ratio: "16:9", value: 16 / 9 },
  { ratio: "9:16", value: 9 / 16 },
  { ratio: "4:3", value: 4 / 3 },
  { ratio: "3:4", value: 3 / 4 },
];

export function inferAspectRatio(width: number, height: number): keyof typeof ARK_IMAGE_SIZES {
  if (!(width > 0) || !(height > 0)) return "1:1";
  const value = width / height;
  let best: keyof typeof ARK_IMAGE_SIZES = "1:1";
  let distance = Number.POSITIVE_INFINITY;
  for (const candidate of ASPECT_TARGETS) {
    const next = Math.abs(candidate.value - value);
    if (next < distance) {
      best = candidate.ratio;
      distance = next;
    }
  }
  return best;
}

export function arkImageSize(config?: GenerationJobConfig, placement?: GenerationJobPlacement): string {
  const ratio = config?.aspectRatio
    ?? (placement ? inferAspectRatio(placement.width, placement.height) : "1:1");
  return arkImageSizeForModel(config?.model, ratio, config?.resolution);
}

export function composeImagePrompt(prompt: string, config?: GenerationJobConfig): string {
  const parts = [prompt.trim()];
  if (config?.letteringText?.trim()) {
    parts.push(`Visible lettering in the image must read exactly: "${config.letteringText.trim()}".`);
  }
  if (config?.stylePreset?.trim()) {
    parts.push(`Style: ${config.stylePreset.trim()}.`);
  }
  if (config?.removeBg) {
    const cutout = config.cutoutMode === "hair" ? "Preserve fine hair edges." : "Keep a clean product-style silhouette.";
    parts.push(`Output a cutout on a fully transparent background as PNG. Subject only, no backdrop. ${cutout}`);
  }
  return parts.join("\n");
}

export function encodeArkUrlJobId(url: string): string {
  return `${ARK_URL_JOB_PREFIX}${url}`;
}

export function decodeArkUrlJobId(providerJobId: string): string | null {
  return providerJobId.startsWith(ARK_URL_JOB_PREFIX)
    ? providerJobId.slice(ARK_URL_JOB_PREFIX.length)
    : null;
}

export const ARK_FETCH_TIMEOUT_MS = 90_000;

export async function arkFetchJson(
  url: string,
  init: RequestInit & { apiKey: string; timeoutMs?: number },
): Promise<{ status: number; body: unknown; text: string }> {
  const { apiKey, timeoutMs = ARK_FETCH_TIMEOUT_MS, signal, ...rest } = init;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  const onOuterAbort = () => timeout.abort();
  signal?.addEventListener("abort", onOuterAbort, { once: true });
  try {
    const response = await fetch(url, {
      ...rest,
      signal: timeout.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(rest.headers ?? {}),
      },
    });
    const text = await response.text();
    let body: unknown = text;
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    return { status: response.status, body, text };
  } catch (error) {
    if (timeout.signal.aborted && !signal?.aborted) {
      throw new Error(`Ark request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}

export async function downloadUrlBytes(url: string, timeoutMs = ARK_FETCH_TIMEOUT_MS): Promise<Buffer> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: timeout.signal });
    if (!response.ok) {
      throw new Error(`failed to download generation result: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (timeout.signal.aborted) {
      throw new Error(`Ark download timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function errorMessageFromArk(body: unknown, fallback: string): string {
  const record = asRecord(body);
  const error = asRecord(record?.error);
  const message = record?.message ?? error?.message ?? error?.code;
  return typeof message === "string" && message.trim() ? message.trim() : fallback;
}
