import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readOpenCodeLocalConfig } from "./openCodeAdapter.js";
import { makeTempDir, withRuntimeEnv, writeFixture } from "./testSupport.js";

test("openCodeAdapter: happy path reads providers, models and default model id", async () => {
  const { dir, cleanup } = makeTempDir("kith-opencode-happy-");
  const configPath = path.join(dir, "opencode.json");
  const restoreEnv = withRuntimeEnv({ OPENCODE_CONFIG: configPath });
  try {
    await writeFixture(
      configPath,
      JSON.stringify({
        model: "myprovider/gpt-x",
        provider: {
          myprovider: {
            name: "My Provider",
            npm: "@ai-sdk/openai-compatible",
            options: { baseURL: "https://api.example.com", apiKey: "sk-test-fixture" },
            models: {
              "gpt-x": {
                name: "GPT X",
                limit: { context: 128000, output: 4096 },
                modalities: { input: ["text", "image"] },
              },
            },
          },
        },
      }),
    );

    const config = await readOpenCodeLocalConfig();

    assert.equal(config.runtimeId, "opencode");
    assert.equal(config.primaryPath, configPath);
    assert.equal(config.present, true);
    assert.equal(config.providers.length, 1);

    const provider = config.providers[0]!;
    assert.equal(provider.id, "myprovider");
    assert.equal(provider.displayName, "My Provider");
    assert.equal(provider.apiFormat, "openai-completions");
    assert.equal(provider.baseUrl, "https://api.example.com");
    assert.deepEqual(provider.credential, { configured: true, source: "opencode.json" });
    assert.equal(provider.defaultModelId, "gpt-x");
    assert.deepEqual(provider.sourcePaths, [configPath]);

    assert.equal(provider.models.length, 1);
    const model = provider.models[0]!;
    assert.equal(model.id, "gpt-x");
    assert.equal(model.displayName, "GPT X");
    assert.equal(model.contextWindow, 128000);
    assert.equal(model.maxOutputTokens, 4096);
    assert.deepEqual(model.inputCapabilities, ["text", "image"]);
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("openCodeAdapter: missing opencode.json returns present=false with not_found issue", async () => {
  const { dir, cleanup } = makeTempDir("kith-opencode-missing-");
  const configPath = path.join(dir, "opencode.json");
  const restoreEnv = withRuntimeEnv({ OPENCODE_CONFIG: configPath });
  try {
    const config = await readOpenCodeLocalConfig();
    assert.equal(config.present, false);
    assert.equal(config.providers.length, 0);
    assert.equal(config.issues.length, 1);
    assert.equal(config.issues[0]!.kind, "not_found");
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("openCodeAdapter: malformed JSON produces parse_error issue instead of throwing", async () => {
  const { dir, cleanup } = makeTempDir("kith-opencode-malformed-");
  const configPath = path.join(dir, "opencode.json");
  const restoreEnv = withRuntimeEnv({ OPENCODE_CONFIG: configPath });
  try {
    await writeFixture(configPath, "{ not valid json");

    const config = await readOpenCodeLocalConfig();

    assert.equal(config.present, false);
    assert.equal(config.providers.length, 0);
    assert.equal(config.issues.length, 1);
    assert.equal(config.issues[0]!.kind, "parse_error");
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("openCodeAdapter: no provider dict yields empty provider list without throwing", async () => {
  const { dir, cleanup } = makeTempDir("kith-opencode-empty-");
  const configPath = path.join(dir, "opencode.json");
  const restoreEnv = withRuntimeEnv({ OPENCODE_CONFIG: configPath });
  try {
    await writeFixture(configPath, JSON.stringify({}));

    const config = await readOpenCodeLocalConfig();
    assert.equal(config.present, true);
    assert.equal(config.providers.length, 0);
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("openCodeAdapter: default model spec without provider prefix does not attribute to any provider", async () => {
  const { dir, cleanup } = makeTempDir("kith-opencode-noprefix-");
  const configPath = path.join(dir, "opencode.json");
  const restoreEnv = withRuntimeEnv({ OPENCODE_CONFIG: configPath });
  try {
    await writeFixture(
      configPath,
      JSON.stringify({
        model: "gpt-x",
        provider: { myprovider: { models: { "gpt-x": {} } } },
      }),
    );

    const config = await readOpenCodeLocalConfig();
    const provider = config.providers[0]!;
    assert.equal(provider.defaultModelId, undefined);
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("openCodeAdapter: provider with no apiKey reports credential not configured", async () => {
  const { dir, cleanup } = makeTempDir("kith-opencode-nocred-");
  const configPath = path.join(dir, "opencode.json");
  const restoreEnv = withRuntimeEnv({ OPENCODE_CONFIG: configPath });
  try {
    await writeFixture(
      configPath,
      JSON.stringify({ provider: { myprovider: { models: {} } } }),
    );

    const config = await readOpenCodeLocalConfig();
    const provider = config.providers[0]!;
    assert.deepEqual(provider.credential, { configured: false, source: "opencode.json" });
    assert.equal(provider.models.length, 0);
  } finally {
    restoreEnv();
    cleanup();
  }
});
