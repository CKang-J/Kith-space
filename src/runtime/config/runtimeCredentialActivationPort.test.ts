import assert from "node:assert/strict";
import test from "node:test";
import {
  RuntimeCredentialActivationError,
  RuntimeCredentialActivationPort,
} from "./runtimeCredentialActivationPort.js";

function descriptor(overrides: Record<string, unknown> = {}) {
  return {
    activationId: "activation-1",
    runtimeSessionId: "session-1",
    sessionGeneration: 2,
    workerGeneration: 3,
    runtimeId: "pi" as const,
    providerRevision: 4,
    modelConfigurationRevision: 5,
    runtimeProfileRevision: 6,
    runtimeConfigurationEpoch: 7,
    effectiveConfigDigest: "d".repeat(64),
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    ...overrides,
  };
}

test("runtime credential activation is single-use and bound to every execution identity", () => {
  const port = new RuntimeCredentialActivationPort();
  const input = descriptor();
  port.issue(input, { value: "top-secret", type: "api_key", identityDigest: "i".repeat(64) });
  const redeemed = port.redeem(input);
  assert.equal(redeemed.value, "top-secret");
  assert.throws(() => port.redeem(input), (error: unknown) =>
    error instanceof RuntimeCredentialActivationError && error.code === "activation_unavailable");

  port.issue({ ...input, activationId: "activation-2" }, { value: "second", type: "api_key", identityDigest: "j".repeat(64) });
  assert.throws(() => port.redeem({ ...input, activationId: "activation-2", workerGeneration: 4 }), (error: unknown) =>
    error instanceof RuntimeCredentialActivationError && error.code === "activation_binding_mismatch");
});

test("expired and revoked activations fail closed without revealing the credential", () => {
  const port = new RuntimeCredentialActivationPort();
  const expired = descriptor({ activationId: "expired", expiresAt: new Date(Date.now() - 1).toISOString() });
  assert.throws(() => port.issue(expired, { value: "expired-secret", type: "api_key", identityDigest: "e".repeat(64) }),
    (error: unknown) => error instanceof RuntimeCredentialActivationError && error.code === "activation_expired");
  const active = descriptor({ activationId: "revoked" });
  port.issue(active, { value: "revoked-secret", type: "api_key", identityDigest: "r".repeat(64) });
  assert.equal(port.revoke("revoked"), true);
  assert.throws(() => port.redeem(active), /activation_unavailable/);
});
