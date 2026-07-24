import {
  createModels,
  getSupportedThinkingLevels,
  type Credential,
  type CredentialInfo,
  type CredentialStore,
  type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { amazonBedrockProvider } from "@earendil-works/pi-ai/providers/amazon-bedrock";
import { azureOpenAIResponsesProvider } from "@earendil-works/pi-ai/providers/azure-openai-responses";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { googleVertexProvider } from "@earendil-works/pi-ai/providers/google-vertex";
import { mistralProvider } from "@earendil-works/pi-ai/providers/mistral";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { installPinnedFetchGuard } from "./pinnedFetchGuard.js";
import { PI_ADVISOR_MAX_INPUT_BYTES, validatePiAdvisorHelperInput, type PiAdvisorHelperInput } from "./piAdvisorHelperInput.js";

const MAX_OUTPUT_BYTES = 256 * 1024;
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor! < 22 || (nodeMajor === 22 && nodeMinor! < 19)) throw new Error("provider_unavailable");
const factories = {
  anthropic: anthropicProvider,
  "amazon-bedrock": amazonBedrockProvider,
  "azure-openai-responses": azureOpenAIResponsesProvider,
  deepseek: deepseekProvider,
  google: googleProvider,
  "google-vertex": googleVertexProvider,
  mistral: mistralProvider,
  openai: openaiProvider,
  openrouter: openrouterProvider,
} as const;

class FrozenCredentialStore implements CredentialStore {
  constructor(private readonly providerId: string, private credential: Credential | undefined) {}
  async read(providerId: string): Promise<Credential | undefined> { return providerId === this.providerId ? this.credential : undefined; }
  async list(): Promise<readonly CredentialInfo[]> { return this.credential ? [{ providerId: this.providerId, type: this.credential.type }] : []; }
  async modify(providerId: string, _fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined> {
    // Intentionally never invoke provider OAuth callbacks: refresh/login are outside the Advisor boundary.
    return providerId === this.providerId ? this.credential : undefined;
  }
  async delete(providerId: string): Promise<void> { if (providerId === this.providerId) this.credential = undefined; }
}

async function readStdin(): Promise<PiAdvisorHelperInput> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > PI_ADVISOR_MAX_INPUT_BYTES) throw new Error("provider_request_invalid");
    chunks.push(buffer);
  }
  return validatePiAdvisorHelperInput(JSON.parse(Buffer.concat(chunks).toString("utf8")), new Set(Object.keys(factories)));
}

function emit(value: Record<string, unknown>): void { process.stdout.write(`${JSON.stringify(value)}\n`); }

async function main(): Promise<void> {
  const input = await readStdin();
  const releaseEgress = installPinnedFetchGuard(input);
  try {
  const credential: Credential | undefined = input.credential.type === "api_key"
    ? { type: "api_key", key: input.credential.value! }
    : input.credential.type === "oauth" ? {
      type: "oauth",
      access: input.credential.value!,
      refresh: "",
      expires: input.credential.expires ?? Date.now() + 60_000,
    } : undefined;
  const backendId = input.backendId as keyof typeof factories;
  const credentials = new FrozenCredentialStore(backendId, credential);
  const models = createModels({
    credentials,
    authContext: { async env() { return undefined; }, async fileExists() { return false; } },
  });
  models.setProvider(factories[backendId]());
  const model = models.getModel(backendId, input.modelId);
  const thinkingLevel = input.thinkingLevel as ModelThinkingLevel;
  if (!model || model.api !== input.apiKind) throw new Error("provider_model_incompatible");
  if (new URL(model.baseUrl).origin !== input.canonicalOrigin) throw new Error("provider_model_incompatible");
  if (!getSupportedThinkingLevels(model).includes(thinkingLevel)) throw new Error("provider_model_incompatible");
  const result = await models.completeSimple(model, {
    systemPrompt: input.systemInstruction,
    messages: [{ role: "user", content: input.transcript, timestamp: Date.now() }],
  }, {
    ...(thinkingLevel === "off" ? {} : { reasoning: thinkingLevel }),
    maxRetries: 0,
    timeoutMs: 75_000,
    transport: "sse",
  });
  if (result.stopReason !== "stop" && result.stopReason !== "length") throw new Error("provider_invalid_output");
  const text = result.content.filter((item): item is Extract<typeof item, { type: "text" }> => item.type === "text").map((item) => item.text).join("");
  if (!text || Buffer.byteLength(text) > MAX_OUTPUT_BYTES) throw new Error("provider_invalid_output");
  emit({
    ok: true,
    output: text,
    usage: { inputTokens: result.usage.input, outputTokens: result.usage.output, source: "final" },
  });
  } finally { await releaseEgress(); }
}

void main().catch((error) => {
  const code = error instanceof Error && /^provider_[a-z_]+$/.test(error.message) ? error.message : "provider_unavailable";
  emit({ ok: false, errorCode: code });
  process.exitCode = 1;
});
