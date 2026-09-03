import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const home = mkdtempSync(path.join(os.tmpdir(), "kith-pi-model-import-"));
process.env.KITH_SPACE_HOME = home;

const { closeAppDatabase } = await import("../app-data/appDatabase.js");
const { ModelProviderConnectionService } = await import("./modelProviderConnectionService.js");
const { ModelConfigurationService } = await import("./modelConfigurationService.js");
const { PiConfigModelImportService } = await import("./piConfigModelImportService.js");
const { providerCredentialPort } = await import("../advisor-provider/credentialPort.js");

const piRoot = mkdtempSync(path.join(os.tmpdir(), "kith-pi-cli-config-"));
const modelsPath = path.join(piRoot, "models.json");
const authPath = path.join(piRoot, "auth.json");

function writeConfig(models: unknown, auth: unknown = {}): void {
  writeFileSync(modelsPath, JSON.stringify(models), { encoding: "utf8" });
  writeFileSync(authPath, JSON.stringify(auth), { encoding: "utf8" });
}

const baseModels = {
  providers: {
    anthropic: {
      baseUrl: "https://api.anthropic.com",
      api: "anthropic-messages",
      models: [{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" }],
    },
    deepseek: {
      baseUrl: "https://api.deepseek.com",
      apiKey: "$DEEPSEEK_API_KEY",
      api: "openai-completions",
      models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
    },
    openai: {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-literal-key",
      api: "openai-responses",
      models: [{ id: "gpt-5.2", name: "GPT-5.2" }],
    },
    local: {
      baseUrl: "http://127.0.0.1:11434",
      api: "openai-completions",
      models: [{ id: "qwen3:8b", name: "Qwen3 8B" }],
    },
    mistral: {
      baseUrl: "https://api.mistral.ai",
      api: "mistral-conversations",
      models: [{ id: "mistral-large-latest", name: "Mistral Large" }],
    },
    dangerous: {
      baseUrl: "https://api.example.com",
      apiKey: "!security find-generic-password",
      api: "openai-completions",
      models: [{ id: "example-model", name: "Example" }],
    },
    compound: {
      baseUrl: "https://api.example.com",
      apiKey: "${KEY_PREFIX}_${KEY_SUFFIX}",
      api: "openai-completions",
      models: [{ id: "compound-model", name: "Compound" }],
    },
  },
};

test.after(() => {
  closeAppDatabase();
  rmSync(home, { recursive: true, force: true });
  rmSync(piRoot, { recursive: true, force: true });
});

test("Pi config import preview sanitizes providers, credentials, and unsupported APIs", () => {
  writeConfig(baseModels, {
    openai: { type: "api_key", key: "sk-auth-key" },
  });
  const service = new PiConfigModelImportService();
  const preview = service.preview(piRoot);

  const byId = new Map(preview.providers.map((provider) => [provider.backendId, provider]));
  assert.deepEqual([...byId.keys()].sort(), ["anthropic", "compound", "dangerous", "deepseek", "local", "openai"]);

  const anthropic = byId.get("anthropic")!;
  assert.equal(anthropic.apiKind, "anthropic-messages");
  assert.equal(anthropic.canonicalOrigin, "https://api.anthropic.com");
  assert.equal(anthropic.credential.kind, "keyless_local");
  assert.equal(anthropic.models[0]?.id, "claude-sonnet-4-6");

  const deepseek = byId.get("deepseek")!;
  assert.deepEqual(deepseek.credential, { kind: "env_ref", env: "DEEPSEEK_API_KEY", importable: Boolean(process.env.DEEPSEEK_API_KEY) });

  // auth.json api_key wins over the literal models.json key
  assert.equal(byId.get("openai")!.credential.kind, "pi_cli_auth");

  const local = byId.get("local")!;
  assert.equal(local.networkClass, "loopback");
  assert.equal(local.credential.kind, "keyless_local");

  // !command and compound interpolation are rejected; mistral's api is not importable
  assert.equal(byId.get("dangerous")!.credential.kind, "keyless_local");
  assert.equal(byId.get("compound")!.credential.kind, "keyless_local");
  assert.equal(byId.has("mistral"), false);
  assert.ok(preview.warnings.length >= 2);
  assert.equal(preview.hasCredentialSecrets, true);
});

test("Pi config import apply creates provider connections and model configurations in one transaction", () => {
  writeConfig(baseModels, {
    openai: { type: "api_key", key: "sk-auth-key" },
  });
  const providers = new ModelProviderConnectionService();
  const configurations = new ModelConfigurationService(providers);
  const service = new PiConfigModelImportService(providers, configurations);
  const preview = service.preview(piRoot);

  const resultPromise = service.apply(piRoot, preview.sourceMtimeDigest);
  return resultPromise.then((result) => {
    assert.equal(result.applied, 6);
    assert.deepEqual(result.skipped, []);

    const connections = providers.list().filter((item) => item.connection.status === "active");
    const byBackend = new Map(connections.map((item) => [item.revision.backendId, item]));
    assert.equal(connections.length, 6);
    assert.equal(byBackend.get("openai")!.revision.credentialSourceKind, "pi_cli_auth");
    assert.equal(byBackend.get("deepseek")!.revision.credentialSourceKind,
      process.env.DEEPSEEK_API_KEY ? "kith_secret" : "keyless_local");
    assert.equal(byBackend.get("anthropic")!.revision.credentialSourceKind, "keyless_local");
    assert.equal(byBackend.get("compound")!.revision.credentialSourceKind, "keyless_local");
    assert.equal(byBackend.get("openai")!.revision.sourceKind, "pi_import");

    const models = configurations.list().filter((item) => item.configuration.status === "active");
    assert.equal(models.length, 6);
    const openaiModel = models.find((item) => item.revision.modelId === "gpt-5.2");
    assert.equal(openaiModel?.revision.providerConnectionId, byBackend.get("openai")!.connection.id);
    assert.equal(openaiModel?.revision.runtimeCompatibilitySnapshot["pi-builtin"]?.supported, true);
  });
});

test("Pi config import refuses drift between preview and apply, and skips existing providers", () => {
  writeConfig(baseModels, {});
  const providers = new ModelProviderConnectionService();
  const configurations = new ModelConfigurationService(providers);
  const service = new PiConfigModelImportService(providers, configurations);
  const preview = service.preview(piRoot);

  // Mutate the source after preview: apply must fail closed.
  const mutated = JSON.parse(JSON.stringify(baseModels)) as any;
  mutated.providers.openai.models[0].id = "gpt-5.3";
  writeConfig(mutated, {});
  return assert.rejects(() => service.apply(piRoot, preview.sourceMtimeDigest), /changed after preview/)
    .then(() => {
      // Restore and apply; the providers created by the previous test are
      // skipped, and a second apply is a no-op with the same skips.
      writeConfig(baseModels, {});
      const fresh = service.preview(piRoot);
      return service.apply(piRoot, fresh.sourceMtimeDigest).then((first) => {
        assert.equal(first.applied, 0);
        assert.deepEqual(first.skipped.sort(), ["anthropic", "compound", "dangerous", "deepseek", "local", "openai"]);
        return service.apply(piRoot, fresh.sourceMtimeDigest).then((second) => {
          assert.equal(second.applied, 0);
          assert.deepEqual(second.skipped.sort(), ["anthropic", "compound", "dangerous", "deepseek", "local", "openai"]);
        });
      });
    });
});

test("Pi config import stores a kith secret for a literal API key when auth.json has no entry", () => {
  const literalModels = {
    providers: {
      "literal-provider": {
        baseUrl: "https://api.literal.example.com",
        apiKey: "sk-literal-only",
        api: "openai-completions",
        models: [{ id: "literal-model", name: "Literal Model" }],
      },
    },
  };
  writeConfig(literalModels, {});
  const providers = new ModelProviderConnectionService();
  const configurations = new ModelConfigurationService(providers);
  const service = new PiConfigModelImportService(providers, configurations);
  const preview = service.preview(piRoot);
  return service.apply(piRoot, preview.sourceMtimeDigest).then(() => {
    const literal = providers.list().find((item) => item.revision.backendId === "literal-provider")!;
    assert.equal(literal.revision.credentialSourceKind, "kith_secret");
    const identity = providerCredentialPort.identityForStoredRef(
      literal.revision.credentialRef!, "literal-provider", "kith_secret");
    assert.equal(identity, literal.revision.credentialIdentityDigest);
  });
});
