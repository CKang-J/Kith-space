import assert from "node:assert/strict";
import test from "node:test";
import { PI_ADVISOR_MAX_INPUT_BYTES, validatePiAdvisorHelperInput } from "./piAdvisorHelperInput.js";

const base = {
  schemaVersion: 1 as const, backendId: "deepseek", modelId: "model", apiKind: "openai-completions", thinkingLevel: "off",
  credential: { type: "api_key" as const, value: "x" }, systemInstruction: "schema", transcript: "evidence",
  canonicalOrigin: "https://api.deepseek.com", allowedEgress: ["https://api.deepseek.com"], pinnedAddresses: ["203.0.113.7"],
};

test("Pi helper envelope leaves room for every individually legal field", () => {
  const legal = { ...base, credential: { type: "api_key" as const, value: "x".repeat(64 * 1024) } };
  assert.ok(Buffer.byteLength(JSON.stringify(legal)) < PI_ADVISOR_MAX_INPUT_BYTES);
  assert.equal(validatePiAdvisorHelperInput(legal, new Set(["deepseek"])).credential.value?.length, 64 * 1024);
  // OpenAI-compatible base paths are carried through to the dynamic provider.
  const withPath = validatePiAdvisorHelperInput({ ...base, canonicalOrigin: "https://gateway.example.com/v1", allowedEgress: ["https://gateway.example.com/v1"] }, new Set(["deepseek"]));
  assert.equal(withPath.canonicalOrigin, "https://gateway.example.com/v1");
});

test("Pi helper accepts safe OpenAI-compatible backend ids outside the bundled factory set", () => {
  assert.equal(validatePiAdvisorHelperInput({ ...base, backendId: "custom" }, new Set(["deepseek"])).backendId, "custom");
  assert.equal(validatePiAdvisorHelperInput({ ...base, backendId: "openai-style-2" }, new Set(["deepseek"])).backendId, "openai-style-2");
  assert.throws(() => validatePiAdvisorHelperInput({ ...base, backendId: "not safe!" }, new Set(["deepseek"])), /provider_request_invalid/);
  assert.throws(() => validatePiAdvisorHelperInput({ ...base, backendId: "" }, new Set(["deepseek"])), /provider_request_invalid/);
  assert.throws(() => validatePiAdvisorHelperInput({ ...base, backendId: "x".repeat(65) }, new Set(["deepseek"])), /provider_request_invalid/);
});

test("Pi helper rejects oversized individual fields and unbounded lists", () => {
  assert.throws(() => validatePiAdvisorHelperInput({ ...base, credential: { type: "api_key", value: "x".repeat(64 * 1024 + 1) } }, new Set(["deepseek"])), /provider_request_invalid/);
  assert.throws(() => validatePiAdvisorHelperInput({ ...base, allowedEgress: Array(17).fill("https://api.deepseek.com") }, new Set(["deepseek"])), /provider_request_invalid/);
});
