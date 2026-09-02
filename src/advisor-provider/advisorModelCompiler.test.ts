import assert from "node:assert/strict";
import test from "node:test";
import { compileAdvisorModel } from "./advisorModelCompiler.js";

const base = {
  sourceKind: "manual" as const,
  sourceSnapshotDigest: "catalog",
  descriptorTrust: "manual" as const,
  backendId: "anthropic",
  modelId: "claude-sonnet-4-5",
  apiKind: "anthropic-messages" as const,
  thinkingLevel: "high" as const,
  canonicalOrigin: "https://api.anthropic.com",
  credentialSourceKind: "kith_secret" as const,
  credentialIdentityDigest: "credential",
  providerSchemaVersion: 1,
  dataPolicyRevision: "anthropic-2026-01",
  dataPolicyProvenance: "vendor_verified" as const,
  networkClass: "public_cloud" as const,
  allowedEgress: ["https://api.anthropic.com"],
  modelMetadata: { supportedThinking: ["off", "low", "medium", "high"] },
};

test("AdvisorModelCompiler accepts an exact allowlisted public provider profile", () => {
  const result = compileAdvisorModel(base);
  assert.equal(result.providerFactoryId, "anthropic");
  assert.equal(result.apiKind, "anthropic-messages");
  assert.equal(result.canonicalOrigin, "https://api.anthropic.com");
  assert.deepEqual(result.allowedEgress, ["https://api.anthropic.com"]);
});

test("AdvisorModelCompiler rejects unknown APIs, dynamic providers, and silent thinking downgrade", () => {
  assert.throws(() => compileAdvisorModel({ ...base, apiKind: "compat" as never }), /provider_model_incompatible/);
  assert.throws(() => compileAdvisorModel({ ...base, backendId: "dynamic-hook" }), /provider_model_incompatible/);
  assert.throws(() => compileAdvisorModel({ ...base, thinkingLevel: "max" }), /provider_model_incompatible/);
});

test("AdvisorModelCompiler rejects credential-bearing URLs and unsafe public HTTP", () => {
  assert.throws(() => compileAdvisorModel({ ...base, canonicalOrigin: "https://secret@example.com/v1" }), /provider_model_incompatible/);
  assert.throws(() => compileAdvisorModel({ ...base, canonicalOrigin: "https://example.com/v1?api_key=secret" }), /provider_model_incompatible/);
  assert.throws(() => compileAdvisorModel({ ...base, canonicalOrigin: "http://api.anthropic.com" }), /provider_model_incompatible/);
});

test("AdvisorModelCompiler permits explicit HTTP loopback but not a mismatched network class", () => {
  const local = compileAdvisorModel({
    ...base,
    backendId: "openai",
    modelId: "local-model",
    apiKind: "openai-responses",
    canonicalOrigin: "http://127.0.0.1:11434",
    networkClass: "loopback",
    credentialSourceKind: "keyless_local",
    dataPolicyRevision: "local-only-v1",
    dataPolicyProvenance: "human_asserted",
    allowedEgress: ["http://127.0.0.1:11434"],
  });
  assert.equal(local.canonicalOrigin, "http://127.0.0.1:11434");
  assert.throws(() => compileAdvisorModel({ ...base, canonicalOrigin: "https://127.0.0.1:8443" }), /provider_model_incompatible/);
});

test("AdvisorModelCompiler accepts bounded OpenAI-compatible base paths and rejects unsafe ones", () => {
  const withPath = compileAdvisorModel({
    ...base,
    backendId: "openai",
    modelId: "deepseek-v4-flash",
    apiKind: "openai-responses",
    canonicalOrigin: "https://api.deepseek.com/v1",
    allowedEgress: ["https://api.deepseek.com/v1"],
  });
  assert.equal(withPath.canonicalOrigin, "https://api.deepseek.com/v1");
  assert.deepEqual(withPath.allowedEgress, ["https://api.deepseek.com/v1"]);
  // Trailing slash is normalized away; the origin-only shape stays unchanged.
  assert.equal(compileAdvisorModel({ ...base, canonicalOrigin: "https://api.anthropic.com/", allowedEgress: ["https://api.anthropic.com"] }).canonicalOrigin, "https://api.anthropic.com");
  // The base path must be allowlisted together with the origin.
  assert.throws(() => compileAdvisorModel({
    ...base, backendId: "openai", modelId: "deepseek-v4-flash", apiKind: "openai-responses",
    canonicalOrigin: "https://api.deepseek.com/v1", allowedEgress: ["https://api.deepseek.com"],
  }), /provider_model_incompatible/);
  for (const bad of ["https://api.example.com/..", "https://api.example.com//v1", "https://api.example.com/v1;x", "https://api.example.com/ä"]) {
    assert.throws(() => compileAdvisorModel({
      ...base, backendId: "openai", modelId: "m", apiKind: "openai-completions",
      canonicalOrigin: bad, allowedEgress: [bad],
    }), /provider_model_incompatible/, bad);
  }
});
