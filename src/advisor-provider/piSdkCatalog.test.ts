import assert from "node:assert/strict";
import test from "node:test";
import { listPiSdkCatalog, piSdkModelCompatibility } from "./piSdkCatalog.js";

test("Pi executable catalog skips dynamic or ambient-only bundled descriptors without failing the whole catalog", () => {
  const catalog = listPiSdkCatalog();
  assert.ok(catalog.length > 0);
  assert.ok(catalog.some((item) => item.backendId === "anthropic" && item.modelId === "claude-haiku-4-5"));
  assert.ok(catalog.every((item) => !["amazon-bedrock", "google-vertex", "azure-openai-responses"].includes(item.backendId)));
  assert.ok(catalog.every((item) => new URL(item.canonicalOrigin).origin === item.canonicalOrigin));
});

test("Pi executable catalog requires an exact built-in model, API, origin, and thinking level", () => {
  assert.deepEqual(piSdkModelCompatibility({ backendId: "anthropic", modelId: "claude-haiku-4-5",
    apiKind: "anthropic-messages", canonicalOrigin: "https://api.anthropic.com", thinkingLevel: "off" }), { compatible: true });
  assert.equal(piSdkModelCompatibility({ backendId: "anthropic", modelId: "custom-model",
    apiKind: "anthropic-messages", canonicalOrigin: "https://api.anthropic.com", thinkingLevel: "off" }).reason, "unknown_model");
  assert.equal(piSdkModelCompatibility({ backendId: "anthropic", modelId: "claude-haiku-4-5",
    apiKind: "openai-responses", canonicalOrigin: "https://api.anthropic.com", thinkingLevel: "off" }).reason, "api_mismatch");
  assert.equal(piSdkModelCompatibility({ backendId: "anthropic", modelId: "claude-haiku-4-5",
    apiKind: "anthropic-messages", canonicalOrigin: "https://attacker.invalid", thinkingLevel: "off" }).reason, "origin_mismatch");
});
