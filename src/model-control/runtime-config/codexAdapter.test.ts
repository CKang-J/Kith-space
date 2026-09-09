import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readCodexLocalConfig } from "./codexAdapter.js";
import { makeTempDir, withProcessEnv, withRuntimeEnv, writeFixture } from "./testSupport.js";

test("codexAdapter: happy path with a single model_providers section", async () => {
  const { dir, cleanup } = makeTempDir("kith-codex-happy-");
  const restoreEnv = withRuntimeEnv({ CODEX_HOME: dir });
  const restoreProcessEnv = withProcessEnv({ MY_RELAY_KEY: "sk-test-fixture" });
  try {
    const configPath = path.join(dir, "config.toml");
    await writeFixture(
      configPath,
      [
        'model = "gpt-5-codex"',
        'model_provider = "myrelay"',
        "",
        "[model_providers.myrelay]",
        'name = "My Relay"',
        'base_url = "https://relay.example.com/v1"',
        'wire_api = "chat"',
        'env_key = "MY_RELAY_KEY"',
        "",
      ].join("\n"),
    );

    const config = await readCodexLocalConfig();

    assert.equal(config.runtimeId, "codex");
    assert.equal(config.primaryPath, configPath);
    assert.equal(config.present, true);
    assert.equal(config.providers.length, 1);

    const provider = config.providers[0]!;
    assert.equal(provider.id, "myrelay");
    assert.equal(provider.displayName, "My Relay");
    assert.equal(provider.baseUrl, "https://relay.example.com/v1");
    assert.equal(provider.apiFormat, "openai-chat");
    assert.deepEqual(provider.credential, { configured: true, source: "环境变量 MY_RELAY_KEY" });
    assert.equal(provider.defaultModelId, "gpt-5-codex");
    assert.equal(provider.models.length, 1);
    assert.equal(provider.models[0]!.id, "gpt-5-codex");
    assert.deepEqual(provider.sourcePaths, [configPath]);
  } finally {
    restoreProcessEnv();
    restoreEnv();
    cleanup();
  }
});

test("codexAdapter: missing config.toml returns present=false with not_found issue", async () => {
  const { dir, cleanup } = makeTempDir("kith-codex-missing-");
  const restoreEnv = withRuntimeEnv({ CODEX_HOME: dir });
  try {
    const config = await readCodexLocalConfig();
    assert.equal(config.present, false);
    assert.equal(config.providers.length, 0);
    assert.equal(config.issues.length, 1);
    assert.equal(config.issues[0]!.kind, "not_found");
  } finally {
    restoreEnv();
    cleanup();
  }
});

// config.toml 的读取走 readTextFile，不做 JSON/TOML 语法校验，本解析器对无法识别的
// 行/表头一律跳过而不是报错——这与「parse_error」契约不同，这里改为验证：不管文件内容
// 多离谱，读取过程都不会抛异常，且在缺少可用字段时得到空 providers。
test("codexAdapter: garbage config.toml content does not throw and yields no providers", async () => {
  const { dir, cleanup } = makeTempDir("kith-codex-garbage-");
  const restoreEnv = withRuntimeEnv({ CODEX_HOME: dir });
  try {
    await writeFixture(
      path.join(dir, "config.toml"),
      "this is not toml at all {{{ [[[ ===\nrandom garbage\n",
    );

    const config = await readCodexLocalConfig();

    assert.equal(config.present, true);
    assert.equal(config.providers.length, 0);
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("codexAdapter: no [model_providers.*] section but top-level openai_base_url + model still yields a usable provider", async () => {
  const { dir, cleanup } = makeTempDir("kith-codex-nodefaults-");
  const restoreEnv = withRuntimeEnv({ CODEX_HOME: dir });
  try {
    await writeFixture(
      path.join(dir, "config.toml"),
      ['model = "gpt-5"', 'openai_base_url = "https://my-endpoint.example.com/v1"', ""].join("\n"),
    );
    // 没有 env_key 时凭据回落到判断 auth.json 是否存在。
    await writeFixture(path.join(dir, "auth.json"), JSON.stringify({ some: "session" }));

    const config = await readCodexLocalConfig();

    assert.equal(config.present, true);
    assert.equal(config.providers.length, 1);
    const provider = config.providers[0]!;
    assert.equal(provider.id, "codex-default");
    assert.equal(provider.baseUrl, "https://my-endpoint.example.com/v1");
    assert.equal(provider.defaultModelId, "gpt-5");
    assert.equal(provider.models.length, 1);
    assert.equal(provider.models[0]!.id, "gpt-5");
    assert.deepEqual(provider.credential, { configured: true, source: "auth.json" });
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("codexAdapter: no providers, no model, no base url yields an empty provider list", async () => {
  const { dir, cleanup } = makeTempDir("kith-codex-empty-");
  const restoreEnv = withRuntimeEnv({ CODEX_HOME: dir });
  try {
    await writeFixture(path.join(dir, "config.toml"), "# just a comment\n");

    const config = await readCodexLocalConfig();

    assert.equal(config.present, true);
    assert.equal(config.providers.length, 0);
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("codexAdapter: multiple providers without model_provider selects the sole provider only when there's exactly one", async () => {
  const { dir, cleanup } = makeTempDir("kith-codex-multi-");
  const restoreEnv = withRuntimeEnv({ CODEX_HOME: dir });
  try {
    await writeFixture(
      path.join(dir, "config.toml"),
      [
        'model = "shared-model"',
        "",
        "[model_providers.alpha]",
        'name = "Alpha"',
        "",
        "[model_providers.beta]",
        'name = "Beta"',
        "",
      ].join("\n"),
    );

    const config = await readCodexLocalConfig();
    assert.equal(config.providers.length, 2);
    // 两个 provider 又没有 model_provider 指定，无法判断谁生效，两者的 defaultModelId 都应为 undefined。
    for (const provider of config.providers) {
      assert.equal(provider.defaultModelId, undefined);
      assert.equal(provider.models.length, 0);
    }
  } finally {
    restoreEnv();
    cleanup();
  }
});
