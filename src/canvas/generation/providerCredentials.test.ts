import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  decryptApiKey,
  encryptApiKey,
  getMasterKey,
  resetProviderCredentialCache,
} from "./providerCredentials.js";

describe("providerCredentials", () => {
  it("round-trips API keys with a 0o600 master key", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kith-gen-creds-"));
    resetProviderCredentialCache();
    try {
      const key = await getMasterKey(dir);
      const encrypted = encryptApiKey("ark-test-key", key);
      assert.equal(encrypted.includes(":"), false);
      assert.equal(decryptApiKey(encrypted, key), "ark-test-key");
      const again = await getMasterKey(dir);
      assert.equal(again.equals(key), true);
    } finally {
      resetProviderCredentialCache();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
