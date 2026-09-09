import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readClaudeLocalConfig } from "./claudeAdapter.js";
import { makeTempDir, withProcessEnv, withRuntimeEnv, writeFixture } from "./testSupport.js";

test("claudeAdapter: happy path reads base url, tiers, credential and context limits", async () => {
  const { dir, cleanup } = makeTempDir("kith-claude-happy-");
  const restoreEnv = withRuntimeEnv({ CLAUDE_CONFIG_DIR: dir });
  try {
    const settingsPath = path.join(dir, "settings.json");
    await writeFixture(
      settingsPath,
      JSON.stringify({
        model: "fable",
        env: {
          ANTHROPIC_BASE_URL: "https://relay.example.com",
          ANTHROPIC_AUTH_TOKEN: "sk-test-fixture",
          ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-x",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-x",
          ANTHROPIC_DEFAULT_FABLE_MODEL: "claude-fable-x",
          ANTHROPIC_DEFAULT_FABLE_MODEL_NAME: "Fable 展示名",
          CLAUDE_CODE_MAX_CONTEXT_TOKENS: "200000",
          CLAUDE_CODE_MAX_OUTPUT_TOKENS: "8192",
        },
      }),
    );

    const config = await readClaudeLocalConfig();

    assert.equal(config.runtimeId, "claude");
    assert.equal(config.primaryPath, settingsPath);
    assert.equal(config.present, true);
    assert.equal(config.providers.length, 1);

    const provider = config.providers[0]!;
    assert.equal(provider.id, "claude-local");
    assert.equal(provider.displayName, "relay.example.com");
    assert.equal(provider.baseUrl, "https://relay.example.com");
    assert.deepEqual(provider.credential, { configured: true, source: "settings.json 的 ANTHROPIC_AUTH_TOKEN" });
    assert.equal(provider.sourcePaths.length, 1);
    assert.equal(provider.sourcePaths[0], settingsPath);

    assert.equal(provider.models.length, 3);
    const fable = provider.models.find((m) => m.id === "claude-fable-x");
    assert.ok(fable);
    assert.equal(fable.displayName, "Fable 展示名");
    assert.equal(fable.tierLabel, "Fable（最强）");
    assert.equal(fable.contextWindow, 200000);
    assert.equal(fable.maxOutputTokens, 8192);

    // 顶层 model="fable" 应解析为该档位映射的具体模型 id。
    assert.equal(provider.defaultModelId, "claude-fable-x");
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("claudeAdapter: missing settings.json returns present=false with not_found issue", async () => {
  const { dir, cleanup } = makeTempDir("kith-claude-missing-");
  const restoreEnv = withRuntimeEnv({ CLAUDE_CONFIG_DIR: dir });
  try {
    const config = await readClaudeLocalConfig();
    assert.equal(config.present, false);
    assert.equal(config.providers.length, 0);
    assert.equal(config.issues.length, 1);
    assert.equal(config.issues[0]!.kind, "not_found");
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("claudeAdapter: malformed JSON produces parse_error issue instead of throwing", async () => {
  const { dir, cleanup } = makeTempDir("kith-claude-malformed-");
  const restoreEnv = withRuntimeEnv({ CLAUDE_CONFIG_DIR: dir });
  try {
    await writeFixture(path.join(dir, "settings.json"), "{ not valid json");

    const config = await readClaudeLocalConfig();

    assert.equal(config.present, false);
    assert.equal(config.providers.length, 0);
    assert.equal(config.issues.length, 1);
    assert.equal(config.issues[0]!.kind, "parse_error");
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("claudeAdapter: multiple tiers pointing at the same model id dedupe into one model", async () => {
  const { dir, cleanup } = makeTempDir("kith-claude-dedupe-");
  const restoreEnv = withRuntimeEnv({ CLAUDE_CONFIG_DIR: dir });
  try {
    await writeFixture(
      path.join(dir, "settings.json"),
      JSON.stringify({
        env: {
          ANTHROPIC_DEFAULT_SONNET_MODEL: "shared-model",
          ANTHROPIC_DEFAULT_OPUS_MODEL: "shared-model",
          ANTHROPIC_DEFAULT_FABLE_MODEL: "shared-model",
        },
      }),
    );

    const config = await readClaudeLocalConfig();
    const provider = config.providers[0]!;

    assert.equal(provider.models.length, 1);
    const model = provider.models[0]!;
    assert.equal(model.id, "shared-model");
    assert.equal(model.tierLabel, "Sonnet（均衡） / Opus（强力） / Fable（最强）");
    // 第一个匹配到的档位决定 tier 字段。
    assert.equal(model.tier, "sonnet");
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("claudeAdapter: no tier env vars at all yields empty models with a notice issue", async () => {
  const { dir, cleanup } = makeTempDir("kith-claude-notiers-");
  const restoreEnv = withRuntimeEnv({ CLAUDE_CONFIG_DIR: dir });
  try {
    await writeFixture(path.join(dir, "settings.json"), JSON.stringify({ env: {} }));

    const config = await readClaudeLocalConfig();

    assert.equal(config.present, true);
    const provider = config.providers[0]!;
    assert.equal(provider.models.length, 0);
    assert.equal(config.issues.length, 1);
    assert.equal(config.issues[0]!.kind, "notice");
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("claudeAdapter: falls back to process env credential when settings.json has none", async () => {
  const { dir, cleanup } = makeTempDir("kith-claude-envcred-");
  const restoreEnv = withRuntimeEnv({ CLAUDE_CONFIG_DIR: dir });
  const restoreProcessEnv = withProcessEnv({ ANTHROPIC_API_KEY: "sk-test-fixture" });
  try {
    await writeFixture(path.join(dir, "settings.json"), JSON.stringify({ env: {} }));

    const config = await readClaudeLocalConfig();
    const provider = config.providers[0]!;

    assert.deepEqual(provider.credential, { configured: true, source: "环境变量 ANTHROPIC_API_KEY" });
  } finally {
    restoreProcessEnv();
    restoreEnv();
    cleanup();
  }
});

test("claudeAdapter: no base url and no credential defaults to official display name and unconfigured credential", async () => {
  const { dir, cleanup } = makeTempDir("kith-claude-official-");
  const restoreEnv = withRuntimeEnv({ CLAUDE_CONFIG_DIR: dir });
  const restoreProcessEnv = withProcessEnv({ ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined });
  try {
    await writeFixture(path.join(dir, "settings.json"), JSON.stringify({ env: {} }));

    const config = await readClaudeLocalConfig();
    const provider = config.providers[0]!;

    assert.equal(provider.displayName, "Anthropic 官方");
    assert.equal(provider.baseUrl, "https://api.anthropic.com");
    assert.deepEqual(provider.credential, { configured: false });
  } finally {
    restoreProcessEnv();
    restoreEnv();
    cleanup();
  }
});
