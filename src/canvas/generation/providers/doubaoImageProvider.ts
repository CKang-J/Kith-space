import type {
  GenerationRequest,
  GenerationStatus,
  IGenerationProvider,
} from "../contracts.js";
import {
  arkFetchJson,
  arkImageSize,
  asRecord,
  composeImagePrompt,
  decodeArkUrlJobId,
  downloadUrlBytes,
  encodeArkUrlJobId,
  errorMessageFromArk,
} from "../arkClient.js";
import { sniffGeneratedMime } from "../generationAssetImport.js";
import { DEFAULT_ARK_ENDPOINT } from "../providerConfig.js";
import { DEFAULT_DOUBAO_IMAGE_MODEL } from "../arkModelCatalog.js";

export class DoubaoImageProvider implements IGenerationProvider {
  readonly name = "doubao" as const;
  readonly type = "image" as const;

  constructor(
    private readonly apiKey: string,
    private readonly endpoint = DEFAULT_ARK_ENDPOINT,
    private readonly model = DEFAULT_DOUBAO_IMAGE_MODEL,
  ) {}

  async submit(params: GenerationRequest): Promise<string> {
    const url = `${this.endpoint.replace(/\/+$/, "")}/images/generations`;
    const { status, body, text } = await arkFetchJson(url, {
      method: "POST",
      apiKey: this.apiKey,
      body: JSON.stringify({
        model: params.config?.model?.trim() || this.model,
        prompt: composeImagePrompt(params.prompt, params.config),
        size: arkImageSize(params.config),
        sequential_image_generation: "disabled",
        response_format: "url",
        watermark: false,
        stream: false,
        ...(params.referenceImage && params.referenceImage.length > 0
          ? { image: arkReferenceImage(params.referenceImage) }
          : {}),
      }),
    });
    if (status < 200 || status >= 300) {
      throw new Error(`Doubao image API error: ${status} ${errorMessageFromArk(body, text)}`);
    }
    const resultUrl = firstImageUrl(body);
    if (!resultUrl) throw new Error("Doubao image API returned no result URL");
    return encodeArkUrlJobId(resultUrl);
  }

  async getStatus(providerJobId: string): Promise<GenerationStatus> {
    const resultUrl = decodeArkUrlJobId(providerJobId);
    if (!resultUrl) {
      return { status: "failed", error: "Doubao image job id is not a completed Ark URL" };
    }
    return { status: "completed", resultUrl };
  }

  async downloadResult(providerJobId: string): Promise<Buffer> {
    const status = await this.getStatus(providerJobId);
    if (status.status !== "completed") {
      throw new Error(`Doubao image job is not completed: ${providerJobId}`);
    }
    return downloadUrlBytes(status.resultUrl);
  }
}

function arkReferenceImage(bytes: Buffer): string {
  return `data:${sniffGeneratedMime(bytes, "image")};base64,${bytes.toString("base64")}`;
}

function firstImageUrl(body: unknown): string | null {
  const record = asRecord(body);
  const data = Array.isArray(record?.data) ? record.data : [];
  for (const item of data) {
    const row = asRecord(item);
    if (typeof row?.url === "string" && row.url.trim()) return row.url.trim();
  }
  if (typeof record?.url === "string" && record.url.trim()) return record.url.trim();
  return null;
}
