import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  GenerationRequest,
  GenerationStatus,
  IGenerationProvider,
} from "../contracts.js";
import { ARK_FETCH_TIMEOUT_MS } from "../arkClient.js";
import {
  DEFAULT_OPENROUTER_AUDIO_MODEL_ID,
  DEFAULT_OPENROUTER_ENDPOINT,
  resolveOpenRouterAudioModel,
} from "../openrouterAudioCatalog.js";
import { kithSpaceHome } from "../../../paths.js";

export const OPENROUTER_BYTES_JOB_PREFIX = "openrouter-bytes:";

export class OpenRouterAudioProvider implements IGenerationProvider {
  readonly name = "openrouter" as const;
  readonly type = "audio" as const;

  constructor(
    private readonly apiKey: string,
    private readonly endpoint = DEFAULT_OPENROUTER_ENDPOINT,
    private readonly model = DEFAULT_OPENROUTER_AUDIO_MODEL_ID,
  ) {}

  async submit(params: GenerationRequest): Promise<string> {
    const catalog = resolveOpenRouterAudioModel(params.config?.model || this.model);
    const voice = params.config?.voice?.trim() || catalog.voice;
    const url = `${this.endpoint.replace(/\/+$/, "")}/audio/speech`;
    const bytes = await fetchOpenRouterSpeech(url, {
      apiKey: this.apiKey,
      body: {
        model: catalog.apiModel,
        input: params.prompt,
        response_format: "mp3",
        ...(voice ? { voice } : {}),
      },
    });
    const id = randomUUID();
    writeCachedAudio(id, bytes);
    return encodeOpenRouterBytesJobId(id);
  }

  async getStatus(providerJobId: string): Promise<GenerationStatus> {
    const id = decodeOpenRouterBytesJobId(providerJobId);
    if (!id) return { status: "failed", error: "OpenRouter audio job id is not a cached speech result" };
    if (!existsSync(cachedAudioPath(id))) {
      return { status: "failed", error: "OpenRouter audio result expired before import" };
    }
    return { status: "completed", resultUrl: providerJobId };
  }

  async downloadResult(providerJobId: string): Promise<Buffer> {
    const status = await this.getStatus(providerJobId);
    if (status.status !== "completed") {
      throw new Error(`OpenRouter audio job is not completed: ${providerJobId}`);
    }
    const id = decodeOpenRouterBytesJobId(providerJobId);
    if (!id) throw new Error(`OpenRouter audio job id is not a cached speech result: ${providerJobId}`);
    const file = cachedAudioPath(id);
    const bytes = readFileSync(file);
    try {
      unlinkSync(file);
    } catch {
      // Import already has the bytes; leftover cache is non-fatal.
    }
    return bytes;
  }
}

export function encodeOpenRouterBytesJobId(id: string): string {
  return `${OPENROUTER_BYTES_JOB_PREFIX}${id}`;
}

export function decodeOpenRouterBytesJobId(providerJobId: string): string | null {
  return providerJobId.startsWith(OPENROUTER_BYTES_JOB_PREFIX)
    ? providerJobId.slice(OPENROUTER_BYTES_JOB_PREFIX.length)
    : null;
}

function cachedAudioPath(id: string): string {
  return path.join(kithSpaceHome(), "generation-cache", `${id}.mp3`);
}

function writeCachedAudio(id: string, bytes: Buffer): void {
  const file = cachedAudioPath(id);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

async function fetchOpenRouterSpeech(
  url: string,
  init: { apiKey: string; body: Record<string, unknown>; timeoutMs?: number },
): Promise<Buffer> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), init.timeoutMs ?? ARK_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${init.apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "Kith-space",
      },
      body: JSON.stringify(init.body),
      signal: timeout.signal,
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`OpenRouter speech API error: ${response.status} ${errorMessageFromSpeech(buffer)}`);
    }
    if (buffer.length === 0) throw new Error("OpenRouter speech API returned empty audio");
    return buffer;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`OpenRouter speech request timed out after ${init.timeoutMs ?? ARK_FETCH_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function errorMessageFromSpeech(bytes: Buffer): string {
  const text = bytes.toString("utf8").trim();
  if (!text) return "empty error";
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();
    if (parsed.error && typeof parsed.error === "object" && typeof parsed.error.message === "string") {
      return parsed.error.message.trim();
    }
    if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message.trim();
  } catch {
    // Fall through to the raw body snippet.
  }
  return text.slice(0, 300);
}
