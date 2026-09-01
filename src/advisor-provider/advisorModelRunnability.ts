import { piSdkModelCompatibility } from "./piSdkCatalog.js";

/**
 * OpenAI-compatible endpoints are served by pi-advisor-helper's dynamic provider
 * path: the configured model id is sent to the reviewed canonical origin over
 * the openai-completions / openai-responses wire API. Any such configuration is
 * runnable — the endpoint decides model availability — so acceptance mirrors the
 * helper instead of the strict bundled catalog.
 */
const OPENAI_COMPATIBLE_API_KINDS: ReadonlySet<string> = new Set(["openai-completions", "openai-responses"]);

export type AdvisorModelRunnability = { supported: true } | { supported: false; reason: string };

/** Whether the Pi SDK advisor helper can serve this model configuration. */
export function piSdkModelRunnability(input: {
  backendId: string;
  modelId: string;
  apiKind: string;
  canonicalOrigin: string;
  thinkingLevel?: string | null;
}): AdvisorModelRunnability {
  const strict = piSdkModelCompatibility({
    backendId: input.backendId,
    modelId: input.modelId,
    apiKind: input.apiKind,
    canonicalOrigin: input.canonicalOrigin,
    thinkingLevel: input.thinkingLevel ?? "off",
  });
  if (strict.compatible) return { supported: true };
  if (OPENAI_COMPATIBLE_API_KINDS.has(input.apiKind)) return { supported: true };
  return { supported: false, reason: strict.reason ?? "provider_model_incompatible" };
}
