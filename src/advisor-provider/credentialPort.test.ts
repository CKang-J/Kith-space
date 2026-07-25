import assert from "node:assert/strict";
import { chmodSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { kithSpaceHome } from "../paths.js";
import { ProviderCredentialPort } from "./credentialPort.js";

test("credential activation is single-use, run/generation/snapshot bound, and never stores a secret in the handle", () => {
  const port = new ProviderCredentialPort();
  const stored = port.storeKithSecret("anthropic", "top-secret-api-key");
  assert.equal(stored.credentialIdentityDigest.includes("top-secret"), false);
  const handle = port.issue({
    audience: "advisor",
    credentialRef: stored.credentialRef,
    credentialSourceKind: "kith_secret",
    backendId: "anthropic",
    apiKind: "anthropic-messages",
    expectedCredentialIdentityDigest: stored.credentialIdentityDigest,
    runId: "run-1",
    providerEpoch: 4,
    workerGeneration: 8,
    executionSnapshotDigest: "snapshot",
    expiresAt: Date.now() + 10_000,
  });
  assert.equal(handle.includes("top-secret"), false);
  assert.throws(() => port.redeem(handle, { runId: "other", providerEpoch: 4, workerGeneration: 8, executionSnapshotDigest: "snapshot" }), /provider_auth_required/);
  const validHandle = port.issue({
    audience: "advisor",
    credentialRef: stored.credentialRef,
    credentialSourceKind: "kith_secret",
    backendId: "anthropic",
    apiKind: "anthropic-messages",
    expectedCredentialIdentityDigest: stored.credentialIdentityDigest,
    runId: "run-1",
    providerEpoch: 4,
    workerGeneration: 8,
    executionSnapshotDigest: "snapshot",
    expiresAt: Date.now() + 10_000,
  });
  const credential = port.redeem(validHandle, { runId: "run-1", providerEpoch: 4, workerGeneration: 8, executionSnapshotDigest: "snapshot" });
  assert.equal(credential.value, "top-secret-api-key");
  assert.throws(() => port.redeem(validHandle, { runId: "run-1", providerEpoch: 4, workerGeneration: 8, executionSnapshotDigest: "snapshot" }), /provider_auth_required/);
  const persisted = readFileSync(path.join(kithSpaceHome(), "secrets", "advisor-credentials.json"), "utf8");
  assert.equal(persisted.includes("top-secret-api-key"), false);
  assert.equal(persisted.includes(validHandle), false);
});

test("credential store applies platform file permission semantics", () => {
  const port = new ProviderCredentialPort();
  const stored = port.storeKithSecret("anthropic", "permission-test-secret");
  const file = path.join(kithSpaceHome(), "secrets", "advisor-credentials.json");
  chmodSync(file, 0o644);
  if (process.platform === "win32") {
    assert.equal(
      port.identityForStoredRef(stored.credentialRef, "anthropic", "kith_secret"),
      stored.credentialIdentityDigest,
    );
  } else {
    assert.throws(() => port.identityForStoredRef(stored.credentialRef, "anthropic", "kith_secret"), /provider_auth_required/);
  }
  chmodSync(file, 0o600);
});
