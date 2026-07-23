import { createModels, getSupportedThinkingLevels, type ModelThinkingLevel, type Provider } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { amazonBedrockProvider } from "@earendil-works/pi-ai/providers/amazon-bedrock";
import { azureOpenAIResponsesProvider } from "@earendil-works/pi-ai/providers/azure-openai-responses";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { googleVertexProvider } from "@earendil-works/pi-ai/providers/google-vertex";
import { mistralProvider } from "@earendil-works/pi-ai/providers/mistral";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { createHash } from "node:crypto";

const FACTORIES: Record<string, () => Provider> = {
  anthropic: anthropicProvider, "amazon-bedrock": amazonBedrockProvider,
  "azure-openai-responses": azureOpenAIResponsesProvider, deepseek: deepseekProvider,
  google: googleProvider, "google-vertex": googleVertexProvider, mistral: mistralProvider,
  openai: openaiProvider, openrouter: openrouterProvider,
};

export function listPiSdkCatalog() {
  return Object.entries(FACTORIES).flatMap(([backendId, factory]) => {
    // Bedrock and Vertex require ambient/profile credential chains that the Advisor explicitly
    // disables. Their Pi model metadata is useful to Pi itself, but it is not an executable Kith
    // catalog entry. Azure's bundled entries similarly require a user-specific endpoint and ship
    // with an empty baseUrl, so custom instances must arrive through a reviewed imported profile.
    if (["amazon-bedrock", "google-vertex", "azure-openai-responses"].includes(backendId)) return [];
    const models = createModels({ authContext: { async env() { return undefined; }, async fileExists() { return false; } } });
    models.setProvider(factory());
    return models.getModels(backendId).flatMap((model) => {
      let canonicalOrigin: string;
      try {
        const parsed = new URL(model.baseUrl);
        if (parsed.protocol !== "https:" || parsed.username || parsed.password || /[{}]/.test(parsed.hostname)) return [];
        canonicalOrigin = parsed.origin;
      } catch {
        return [];
      }
      return [{
        backendId,
        modelId: model.id,
        apiKind: model.api,
        canonicalOrigin,
        thinkingLevels: getSupportedThinkingLevels(model),
      }];
    });
  });
}

export function piSdkCatalogDigest(): string {
  return createHash("sha256").update(JSON.stringify(listPiSdkCatalog())).digest("hex");
}

export function piSdkModelCompatibility(input: {
  backendId: string; modelId: string; apiKind: string; canonicalOrigin: string; thinkingLevel: string;
}): { compatible: boolean; reason?: "unknown_provider" | "unknown_model" | "api_mismatch" | "origin_mismatch" | "thinking_unsupported" } {
  const factory = FACTORIES[input.backendId];
  if (!factory) return { compatible: false, reason: "unknown_provider" };
  const models = createModels({ authContext: { async env() { return undefined; }, async fileExists() { return false; } } });
  models.setProvider(factory());
  const model = models.getModel(input.backendId, input.modelId);
  if (!model) return { compatible: false, reason: "unknown_model" };
  if (model.api !== input.apiKind) return { compatible: false, reason: "api_mismatch" };
  let expectedOrigin = "";
  try { expectedOrigin = new URL(model.baseUrl).origin; } catch { return { compatible: false, reason: "origin_mismatch" }; }
  if (expectedOrigin !== input.canonicalOrigin) return { compatible: false, reason: "origin_mismatch" };
  if (!getSupportedThinkingLevels(model).includes(input.thinkingLevel as ModelThinkingLevel)) return { compatible: false, reason: "thinking_unsupported" };
  return { compatible: true };
}
