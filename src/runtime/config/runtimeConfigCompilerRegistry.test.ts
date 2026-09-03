import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RuntimeConfigCompilerRegistry } from "./runtimeConfigCompilerRegistry.js";

const base = {
  runtimeVersion: "test", runtimeStateDir: "", modelId: "model-1", reasoning: "high",
  apiKind: "openai-responses", canonicalOrigin: "https://example.test/v1", networkClass: "public_cloud" as const,
  backendId: "openai", providerOptions: {}, compilerPolicyVersion: 1, compilerPolicyDigest: "policy",
};

test("five managed runtime compilers keep credentials child-only and Pi reports MCP unsupported", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-compilers-"));
  const registry = new RuntimeConfigCompilerRegistry();
  assert.deepEqual(registry.list().map((item) => item.runtimeId), ["claude", "codex", "opencode", "pi", "pi-builtin"]);
  const activation = { value: "secret-value", identityDigest: "identity" };
  const claude = await registry.get("claude").compile({
    ...base, runtimeId: "claude", runtimeStateDir: root, apiKind: "anthropic-messages",
  }, activation);
  assert.ok(claude.args.includes("--setting-sources"));
  assert.match(claude.env.HOME ?? "", /claude-home-/);
  await claude.cleanup();
  const codex = await registry.get("codex").compile({ ...base, runtimeId: "codex", runtimeStateDir: root }, activation);
  assert.equal(codex.env.KITH_CODEX_API_KEY, "secret-value");
  assert.doesNotMatch(readFileSync(codex.ephemeralFiles[0]!.path, "utf8"), /secret-value/);
  await codex.cleanup();
  const opencode = await registry.get("opencode").compile({
    ...base, runtimeId: "opencode", runtimeStateDir: root,
  }, activation);
  assert.equal(opencode.effectiveModelId, "kith/model-1");
  assert.match(opencode.env.OPENCODE_CONFIG_CONTENT ?? "", /"model":"kith\/model-1"/);
  assert.match(opencode.env.XDG_DATA_HOME ?? "", /opencode-agent-/);
  assert.equal(opencode.env.OPENCODE_DISABLE_DEFAULT_PLUGINS, "true");
  await opencode.cleanup();
  const pi = registry.get("pi");
  assert.equal(pi.describeCapabilities("test").mcpBootstrap, "unsupported");
  const compiledPi = await pi.compile({ ...base, runtimeId: "pi", runtimeStateDir: root }, activation);
  assert.ok(compiledPi.args.includes("--no-skills"));
  assert.ok(compiledPi.args.includes("--no-context-files"));
  assert.doesNotMatch(readFileSync(compiledPi.ephemeralFiles[0]!.path, "utf8"), /secret-value/);
  await compiledPi.cleanup();
  const piBuiltin = registry.get("pi-builtin");
  const capabilities = piBuiltin.describeCapabilities("test");
  assert.equal(capabilities.mcpBootstrap, "unsupported");
  assert.equal(capabilities.unmanagedCliNative, false);
  const compiledBuiltin = await piBuiltin.compile({
    ...base, runtimeId: "pi-builtin", runtimeStateDir: root,
  }, activation);
  assert.ok(compiledBuiltin.args.includes("--provider"));
  assert.ok(compiledBuiltin.args.includes("--thinking"));
  assert.equal(compiledBuiltin.env.PI_CODING_AGENT_DIR?.includes("pi-builtin-"), true);
  assert.equal(compiledBuiltin.env.PI_OFFLINE, "1");
  assert.equal(compiledBuiltin.env.PI_TELEMETRY, "0");
  assert.equal(compiledBuiltin.env.DO_NOT_TRACK, "1");
  assert.equal(compiledBuiltin.env.KITH_PI_API_KEY, "secret-value");
  const modelsJson = readFileSync(compiledBuiltin.ephemeralFiles.find((file) => file.path.endsWith("models.json"))!.path, "utf8");
  assert.match(modelsJson, /KITH_PI_API_KEY/);
  assert.doesNotMatch(modelsJson, /secret-value/);
  const settingsJson = readFileSync(compiledBuiltin.ephemeralFiles.find((file) => file.path.endsWith("settings.json"))!.path, "utf8");
  assert.equal(JSON.parse(settingsJson).defaultProjectTrust, "never");
  await compiledBuiltin.cleanup();
});

test("keyless local managed providers omit credential env without weakening activation identity", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-keyless-compilers-"));
  const registry = new RuntimeConfigCompilerRegistry();
  const activation = { value: null, identityDigest: "keyless-identity" };
  const pi = await registry.get("pi").compile({
    ...base,
    runtimeId: "pi",
    runtimeStateDir: root,
    canonicalOrigin: "http://127.0.0.1:11434",
    networkClass: "loopback",
  }, activation);
  assert.equal(pi.env.KITH_PI_API_KEY, undefined);
  assert.doesNotMatch(readFileSync(pi.ephemeralFiles[0]!.path, "utf8"), /apiKey/);
  await pi.cleanup();
});

test("Codex rejects non-Responses wire API with a specific compatibility reason", () => {
  const registry = new RuntimeConfigCompilerRegistry();
  assert.deepEqual(registry.get("codex").validate({
    ...base, runtimeId: "codex", apiKind: "anthropic-messages",
  }), { valid: false, reason: "wire_api_anthropic-messages_not_supported" });
});
