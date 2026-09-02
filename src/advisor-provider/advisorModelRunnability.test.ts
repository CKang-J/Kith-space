import assert from "node:assert/strict";
import test from "node:test";
import { piSdkModelRunnability } from "./advisorModelRunnability.js";

test("Pi SDK runnability mirrors the helper: strict catalog OR OpenAI-compatible endpoint", () => {
  // Bundled catalog entry at its reviewed origin stays strict-compatible.
  assert.deepEqual(piSdkModelRunnability({
    backendId: "deepseek", modelId: "deepseek-v4-flash", apiKind: "openai-completions",
    canonicalOrigin: "https://api.deepseek.com", thinkingLevel: "off",
  }), { supported: true });
  // A custom model id on a bundled provider is only runnable when the API kind
  // is OpenAI-compatible (the helper constructs the request dynamically).
  assert.deepEqual(piSdkModelRunnability({
    backendId: "openai", modelId: "deepseek-v4-flash", apiKind: "openai-responses",
    canonicalOrigin: "https://api.deepseek.com", thinkingLevel: "off",
  }), { supported: true });
  assert.deepEqual(piSdkModelRunnability({
    backendId: "custom", modelId: "any-model", apiKind: "openai-completions",
    canonicalOrigin: "https://gateway.example.com", thinkingLevel: "off",
  }), { supported: true });
  // Base paths (OpenAI-compatible /v1 endpoints) stay runnable.
  assert.deepEqual(piSdkModelRunnability({
    backendId: "custom", modelId: "any-model", apiKind: "openai-completions",
    canonicalOrigin: "https://gateway.example.com/v1", thinkingLevel: "off",
  }), { supported: true });
  // Non-OpenAI-compatible API kinds without a bundled catalog entry stay rejected.
  assert.deepEqual(piSdkModelRunnability({
    backendId: "anthropic", modelId: "custom-model", apiKind: "anthropic-messages",
    canonicalOrigin: "https://api.anthropic.com", thinkingLevel: "off",
  }), { supported: false, reason: "unknown_model" });
  assert.deepEqual(piSdkModelRunnability({
    backendId: "openai", modelId: "gpt-anything", apiKind: "anthropic-messages",
    canonicalOrigin: "https://api.openai.com", thinkingLevel: "off",
  }), { supported: false, reason: "unknown_model" });
});
