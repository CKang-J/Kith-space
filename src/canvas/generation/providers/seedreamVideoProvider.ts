import type {
  GenerationRequest,
  GenerationStatus,
  IGenerationProvider,
} from "../contracts.js";
import {
  arkFetchJson,
  asRecord,
  decodeArkUrlJobId,
  downloadUrlBytes,
  encodeArkUrlJobId,
  errorMessageFromArk,
} from "../arkClient.js";
import { DEFAULT_ARK_ENDPOINT } from "../providerConfig.js";
import {
  DEFAULT_SEEDREAM_VIDEO_MODEL,
  clampVideoAspectRatio,
  clampVideoDuration,
  clampVideoResolution,
  resolveArkVideoModel,
} from "../arkModelCatalog.js";

export class SeedreamVideoProvider implements IGenerationProvider {
  readonly name = "seedream" as const;
  readonly type = "video" as const;

  constructor(
    private readonly apiKey: string,
    private readonly endpoint = DEFAULT_ARK_ENDPOINT,
    private readonly model = DEFAULT_SEEDREAM_VIDEO_MODEL,
  ) {}

  async submit(params: GenerationRequest): Promise<string> {
    const url = `${this.endpoint.replace(/\/+$/, "")}/contents/generations/tasks`;
    const modelId = params.config?.model?.trim() || this.model;
    const catalog = resolveArkVideoModel(modelId);
    const duration = clampVideoDuration(params.config?.duration, catalog);
    const content: Array<Record<string, unknown>> = [
      { type: "text", text: params.prompt },
    ];
    if (params.referenceImage && params.referenceImage.length > 0) {
      content.push({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${params.referenceImage.toString("base64")}` },
      });
    }
    const { status, body, text } = await arkFetchJson(url, {
      method: "POST",
      apiKey: this.apiKey,
      body: JSON.stringify({
        model: modelId,
        content,
        duration,
        ratio: clampVideoAspectRatio(params.config?.aspectRatio, catalog),
        resolution: clampVideoResolution(params.config?.resolution, catalog),
        watermark: false,
      }),
    });
    if (status < 200 || status >= 300) {
      throw new Error(`Seedance video API error: ${status} ${errorMessageFromArk(body, text)}`);
    }
    const id = taskIdFrom(body);
    if (!id) throw new Error("Seedance video API returned no task id");
    return id;
  }

  async getStatus(providerJobId: string): Promise<GenerationStatus> {
    const completedUrl = decodeArkUrlJobId(providerJobId);
    if (completedUrl) return { status: "completed", resultUrl: completedUrl };

    const url = `${this.endpoint.replace(/\/+$/, "")}/contents/generations/tasks/${encodeURIComponent(providerJobId)}`;
    const { status, body, text } = await arkFetchJson(url, {
      method: "GET",
      apiKey: this.apiKey,
    });
    if (status < 200 || status >= 300) {
      throw new Error(`Seedance status check failed: ${status} ${errorMessageFromArk(body, text)}`);
    }
    const record = asRecord(body);
    const state = String(record?.status ?? "").toLowerCase();
    if (state === "queued" || state === "pending" || state === "running" || state === "processing") {
      return { status: state === "queued" || state === "pending" ? "pending" : "processing" };
    }
    if (state === "succeeded" || state === "success" || state === "completed") {
      const resultUrl = videoUrlFrom(record);
      if (!resultUrl) return { status: "failed", error: "Seedance task succeeded without a video URL" };
      return { status: "completed", resultUrl };
    }
    if (state === "failed" || state === "cancelled" || state === "canceled" || state === "expired") {
      return { status: "failed", error: errorMessageFromArk(body, `Seedance task ${state}`) };
    }
    return { status: "processing" };
  }

  async downloadResult(providerJobId: string): Promise<Buffer> {
    const status = await this.getStatus(providerJobId);
    if (status.status !== "completed") {
      throw new Error(`Seedance video job is not completed: ${providerJobId}`);
    }
    return downloadUrlBytes(status.resultUrl);
  }

  async cancel(providerJobId: string): Promise<void> {
    if (decodeArkUrlJobId(providerJobId)) return;
    const url = `${this.endpoint.replace(/\/+$/, "")}/contents/generations/tasks/${encodeURIComponent(providerJobId)}`;
    await arkFetchJson(url, { method: "DELETE", apiKey: this.apiKey });
  }
}

export function seedanceCompletedJobId(resultUrl: string): string {
  return encodeArkUrlJobId(resultUrl);
}

function taskIdFrom(body: unknown): string | null {
  const record = asRecord(body);
  for (const key of ["id", "task_id", "taskId"]) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function videoUrlFrom(record: Record<string, unknown> | null): string | null {
  if (!record) return null;
  const content = asRecord(record.content);
  const output = asRecord(record.output);
  for (const candidate of [record.video_url, content?.video_url, output?.video_url, content?.url, output?.url]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}
