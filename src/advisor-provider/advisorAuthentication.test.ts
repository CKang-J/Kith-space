import assert from "node:assert/strict";
import test from "node:test";
import { advisorAuthenticationCapability } from "./advisorAuthentication.js";

test("authentication matrix disables keyless and ambient profile chains", () => {
  assert.equal(advisorAuthenticationCapability("pi_sdk", { backendId: "openai", apiKind: "openai-responses", credentialSourceKind: "keyless_local" }).supported, false);
  assert.equal(advisorAuthenticationCapability("pi_sdk", { backendId: "amazon-bedrock", apiKind: "bedrock-converse-stream", credentialSourceKind: "kith_secret" }).supported, false);
  assert.deepEqual(advisorAuthenticationCapability("pi_sdk", { backendId: "anthropic", apiKind: "anthropic-messages", credentialSourceKind: "env_ref" }), { supported: true, delivery: "explicit_value" });
  assert.equal(advisorAuthenticationCapability("claude_cli", { backendId: "openai", apiKind: "openai-responses", credentialSourceKind: "kith_secret" }).supported, false);
});
