import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeCliConfiguration } from "./cliConfigImportService.js";

test("CLI import snapshots use runtime-specific allowlists and never persist custom secret fields", () => {
  const sanitized = sanitizeCliConfiguration("opencode", JSON.stringify({
    model: "provider/model",
    small_model: "provider/small",
    harmlessName: "short-secret",
    headers: { "X-Custom": "also-secret" },
    endpoint: "https://user:password@example.test?token=secret",
  }));
  assert.deepEqual(sanitized, { model: "provider/model", smallModel: "provider/small" });
  assert.doesNotMatch(JSON.stringify(sanitized), /short-secret|also-secret|password|token/);
});
