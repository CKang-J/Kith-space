import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PiCliConfigImporter } from "./piCliConfigImporter.js";

function fixture(t: test.TestContext) {
  const dir = path.join(os.tmpdir(), `kith-pi-import-${process.pid}-${Date.now()}-${Math.random()}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  t.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
  return dir;
}

test("Pi CLI importer never executes command expressions and redacts literal secrets", (t) => {
  const root = fixture(t);
  const sentinel = path.join(root, "executed");
  writeFileSync(path.join(root, "settings.json"), JSON.stringify({ defaultProvider: "anthropic", defaultModel: "safe" }), { mode: 0o600 });
  writeFileSync(path.join(root, "models.json"), JSON.stringify({ providers: {
    anthropic: { api: "anthropic-messages", baseUrl: "https://api.anthropic.com", apiKey: `!touch ${sentinel}`, models: [{ id: "safe" }] },
    openai: { api: "openai-responses", baseUrl: "https://api.openai.com", apiKey: "literal-secret", models: [{ id: "gpt" }] },
  } }), { mode: 0o600 });
  const result = new PiCliConfigImporter().import(root);
  assert.equal(result.descriptors.find((item) => item.backendId === "anthropic")?.advisorExecutable, false);
  assert.ok(result.warnings.some((warning) => warning.code === "credential_command_unsupported"));
  assert.ok(result.warnings.some((warning) => warning.code === "literal_secret_present"));
  assert.equal(readFileSync(path.join(root, "models.json"), "utf8").includes("literal-secret"), true);
  assert.equal(existsSync(sentinel), false);
  assert.equal(JSON.stringify(result).includes("literal-secret"), false);
});

test("Pi CLI importer accepts one allowlisted env reference and rejects dangerous or compound env", (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, "models.json"), JSON.stringify({ providers: {
    openai: { api: "openai-responses", baseUrl: "https://api.openai.com", apiKey: "$OPENAI_API_KEY", models: [{ id: "gpt" }] },
    anthropic: { api: "anthropic-messages", baseUrl: "https://api.anthropic.com", apiKey: "$GITHUB_TOKEN", models: [{ id: "claude" }] },
    google: { api: "google-generative-ai", baseUrl: "https://generativelanguage.googleapis.com", apiKey: "prefix-${GOOGLE_API_KEY}", models: [{ id: "gemini" }] },
  } }), { mode: 0o600 });
  const result = new PiCliConfigImporter().import(root);
  assert.equal(result.descriptors.find((item) => item.backendId === "openai")?.credentialSourceKind, "env_ref");
  assert.equal(result.descriptors.find((item) => item.backendId === "anthropic")?.credentialSourceKind, "unsupported");
  assert.equal(result.descriptors.find((item) => item.backendId === "google")?.credentialSourceKind, "unsupported");
  assert.ok(result.warnings.some((warning) => warning.code === "dangerous_env_rejected"));
  assert.ok(result.warnings.some((warning) => warning.code === "compound_env_unsupported"));
});

test("Pi CLI source identity binds verified file content even when size and mtime are restored", (t) => {
  const root = fixture(t);
  const authPath = path.join(root, "auth.json");
  const first = JSON.stringify({ anthropic: { type: "api_key", key: "token-aaaa" } });
  const second = JSON.stringify({ anthropic: { type: "api_key", key: "token-bbbb" } });
  assert.equal(first.length, second.length);
  writeFileSync(authPath, first, { mode: 0o600 });
  const stat = statSync(authPath);
  const importer = new PiCliConfigImporter(undefined, Buffer.alloc(32, 7));
  const before = importer.import(root, { includeAuthProvider: "anthropic" });
  writeFileSync(authPath, second, { mode: 0o600 });
  utimesSync(authPath, stat.atime, stat.mtime);
  const after = importer.import(root, { includeAuthProvider: "anthropic" });
  assert.notEqual(after.secretSourceIdentity, before.secretSourceIdentity);
  assert.equal(JSON.stringify(after).includes("token-bbbb"), false);
});

test("Pi CLI importer rejects symlinked files and oversized input", (t) => {
  const root = fixture(t);
  const outside = path.join(root, "outside.json");
  writeFileSync(outside, "{}", { mode: 0o600 });
  symlinkSync(outside, path.join(root, "models.json"));
  assert.throws(() => new PiCliConfigImporter().import(root), /config_file_untrusted/);
});

test("Pi CLI importer does not refresh expired OAuth or write auth.json", (t) => {
  const root = fixture(t);
  const authPath = path.join(root, "auth.json");
  const before = JSON.stringify({ anthropic: { type: "oauth", access: "access-token", refresh: "refresh-token", expires: 1 } });
  writeFileSync(authPath, before, { mode: 0o600 });
  const result = new PiCliConfigImporter().import(root, { includeAuthProvider: "anthropic" });
  assert.ok(result.warnings.some((warning) => warning.code === "oauth_expired"));
  assert.equal(readFileSync(authPath, "utf8"), before);
  assert.equal(JSON.stringify(result).includes("access-token"), false);
  assert.equal(JSON.stringify(result).includes("refresh-token"), false);
});

test("Pi CLI importer reports a requested auth provider only when a usable frozen credential exists", (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, "auth.json"), JSON.stringify({ deepseek: { type: "api_key", key: "test-only-key" } }), { mode: 0o600 });
  const missing = new PiCliConfigImporter().import(root, { includeAuthProvider: "anthropic" });
  const available = new PiCliConfigImporter().import(root, { includeAuthProvider: "deepseek" });
  assert.equal(missing.selectedCredentialAvailable, false);
  assert.equal(available.selectedCredentialAvailable, true);
  assert.equal(JSON.stringify(missing).includes("test-only-key"), false);
  assert.equal(JSON.stringify(available).includes("test-only-key"), false);
});

test("Pi CLI importer never advertises command, env, empty, or malformed frozen auth as usable", (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, "auth.json"), JSON.stringify({
    command: "!security find-generic-password",
    env: "$OPENAI_API_KEY",
    empty: "",
    objectEnv: { type: "api_key", key: "$OPENAI_API_KEY" },
    emptyObject: { type: "api_key", key: "" },
  }), { mode: 0o600 });
  for (const provider of ["command", "env", "empty", "objectEnv", "emptyObject"]) {
    const result = new PiCliConfigImporter().import(root, { includeAuthProvider: provider, includeCredential: true });
    assert.equal(result.selectedCredentialAvailable, false, provider);
    assert.equal(result.activationCredential, undefined, provider);
  }
});
