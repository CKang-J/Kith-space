import assert from "node:assert/strict";
import test from "node:test";
import { advisorModelCompatibility } from "./advisorModelCompatibility.js";

const base = {
  modelId: "claude-haiku-4-5",
  thinkingLevel: "off" as const,
  networkClass: "public_cloud" as const,
};

test("advisor compatibility keeps Pi SDK metadata exact", () => {
  assert.deepEqual(advisorModelCompatibility({
    executorId: "pi_sdk", backendId: "anthropic", apiKind: "anthropic-messages",
    canonicalOrigin: "https://api.anthropic.com", credentialSourceKind: "kith_secret", ...base,
  }), { supported: true });
  assert.deepEqual(advisorModelCompatibility({
    executorId: "pi_sdk", backendId: "anthropic", apiKind: "anthropic-messages",
    canonicalOrigin: "https://api.anthropic.com", credentialSourceKind: "kith_secret",
    networkClass: "public_cloud", modelId: "custom-model", thinkingLevel: "off",
  }), { supported: false, reason: "unknown_model" });
});

test("Pi SDK advisor serves OpenAI-compatible endpoints at any reviewed origin", () => {
  // A DeepSeek-style configuration (OpenAI-compatible wire API at a custom
  // origin) is runnable through the helper's dynamic provider path even though
  // the model id is not in the strict bundled catalog.
  assert.deepEqual(advisorModelCompatibility({
    executorId: "pi_sdk", backendId: "openai", modelId: "deepseek-v4-flash",
    apiKind: "openai-responses", canonicalOrigin: "https://api.deepseek.com",
    credentialSourceKind: "kith_secret", networkClass: "public_cloud", thinkingLevel: "off",
  }), { supported: true });
  assert.deepEqual(advisorModelCompatibility({
    executorId: "pi_sdk", backendId: "custom", modelId: "any-model",
    apiKind: "openai-completions", canonicalOrigin: "https://gateway.example.com",
    credentialSourceKind: "kith_secret", networkClass: "public_cloud", thinkingLevel: "off",
  }), { supported: true });
  // Non-OpenAI-compatible API kinds stay gated by the strict catalog.
  assert.deepEqual(advisorModelCompatibility({
    executorId: "pi_sdk", backendId: "google", modelId: "not-in-catalog",
    apiKind: "google-generative-ai", canonicalOrigin: "https://generativelanguage.googleapis.com",
    credentialSourceKind: "kith_secret", networkClass: "public_cloud", thinkingLevel: "off",
  }), { supported: false, reason: "unknown_model" });
});

test("Claude Code requires explicit Anthropic credentials and origin", () => {
  assert.deepEqual(advisorModelCompatibility({
    executorId: "claude_cli", backendId: "anthropic", apiKind: "anthropic-messages",
    canonicalOrigin: "https://api.anthropic.com", credentialSourceKind: "kith_secret", ...base,
  }), { supported: true });
  assert.deepEqual(advisorModelCompatibility({
    executorId: "claude_cli", backendId: "anthropic", apiKind: "anthropic-messages",
    canonicalOrigin: "https://api.anthropic.com", credentialSourceKind: "keyless_local", ...base,
  }), { supported: false, reason: "keyless_unsupported" });
  assert.deepEqual(advisorModelCompatibility({
    executorId: "claude_cli", backendId: "openai", apiKind: "openai-responses",
    canonicalOrigin: "https://api.openai.com", credentialSourceKind: "kith_secret", ...base,
  }), { supported: false, reason: "provider_mismatch" });
});

test("a dedicated pi_sdk snapshot entry stays authoritative when present", () => {
  assert.deepEqual(advisorModelCompatibility({
    executorId: "pi_sdk", backendId: "openai", modelId: "deepseek-v4-flash",
    apiKind: "openai-responses", canonicalOrigin: "https://api.deepseek.com",
    credentialSourceKind: "kith_secret", networkClass: "public_cloud", thinkingLevel: "off",
    runtimeCompatibilitySnapshot: { pi_sdk: { supported: false, reason: "reviewed_out" } },
  }), { supported: false, reason: "reviewed_out" });
  // The chat runtime's wire-level `pi` entry never overrides advisor runnability.
  assert.deepEqual(advisorModelCompatibility({
    executorId: "pi_sdk", backendId: "google", modelId: "not-in-catalog",
    apiKind: "google-generative-ai", canonicalOrigin: "https://generativelanguage.googleapis.com",
    credentialSourceKind: "kith_secret", networkClass: "public_cloud", thinkingLevel: "off",
    runtimeCompatibilitySnapshot: { pi: { supported: true } },
  }), { supported: false, reason: "unknown_model" });
});
