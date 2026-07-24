import assert from "node:assert/strict";
import test from "node:test";
import { containsSecretShapedKey } from "./modelSettings.js";

test("model settings free-form records reject nested secret-shaped keys", () => {
  assert.equal(containsSecretShapedKey({
    transport: {
      headers: [{ name: "x-mode", value: "strict" }],
      retry: { maxAttempts: 2 },
    },
  }), false);
  assert.equal(containsSecretShapedKey({ headers: { authorization: "Bearer value" } }), true);
  assert.equal(containsSecretShapedKey({ nested: [{ api_key: "value" }] }), true);
  assert.equal(containsSecretShapedKey({ credentialIdentityDigest: "should use the typed field" }), true);
});
