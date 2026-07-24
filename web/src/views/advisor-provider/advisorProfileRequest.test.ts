import assert from "node:assert/strict";
import test from "node:test";
import { buildAdvisorProfileRequest } from "./advisorProfileRequest.js";

test("bundled advisor profile requests preserve the selected backend and model identity", () => {
  const request = buildAdvisorProfileRequest({
    profileSource: "bundled_catalog",
    profile: {
      backendId: "anthropic",
      modelId: "claude-haiku-4-5",
      apiKind: "anthropic-messages",
      thinkingLevel: "off",
      canonicalOrigin: "https://api.anthropic.com",
      credentialSourceKind: "pi_cli_auth",
      credentialRef: "credential-ref",
      credentialValue: "",
      dataPolicyRevision: "pi-catalog-test",
      dataPolicyProvenance: "vendor_verified",
      networkClass: "public_cloud",
      allowedEgress: "https://api.anthropic.com",
    },
    bundledCatalog: { sourceSnapshotDigest: "catalog-digest" },
    importedCatalog: { credential: { credentialIdentityDigest: "credential-digest" } },
  });

  assert.equal(request.backendId, "anthropic");
  assert.equal(request.modelId, "claude-haiku-4-5");
  assert.equal(request.sourceSnapshotDigest, "catalog-digest");
  assert.ok("credentialRef" in request);
  assert.equal(request.credentialRef, "credential-ref");
  assert.ok("credentialIdentityDigest" in request);
  assert.equal(request.credentialIdentityDigest, "credential-digest");
});
