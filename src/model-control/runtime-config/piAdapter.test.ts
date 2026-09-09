import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readPiLocalConfig } from "./piAdapter.js";
import { makeTempDir, withRuntimeEnv, writeFixture } from "./testSupport.js";

test("piAdapter: happy path — models from models-store.json, empty models.json, auth-driven credential", async () => {
  const { dir, cleanup } = makeTempDir("kith-pi-happy-");
  const restoreEnv = withRuntimeEnv({ PI_AGENT_DIR: dir });
  try {
    await writeFixture(path.join(dir, "models.json"), JSON.stringify({ providers: [] }));
    await writeFixture(
      path.join(dir, "models-store.json"),
      JSON.stringify({
        anthropic: {
          models: [
            {
              id: "claude-3-5-sonnet",
              name: "Claude 3.5 Sonnet",
              api: "anthropic-messages",
              baseUrl: "https://api.anthropic.com",
              contextWindow: 200000,
              maxTokens: 8192,
              reasoning: false,
              input: ["text", "image"],
            },
          ],
        },
      }),
    );
    await writeFixture(
      path.join(dir, "auth.json"),
      JSON.stringify({ anthropic: { type: "api_key", key: "sk-test-fixture" } }),
    );
    await writeFixture(
      path.join(dir, "settings.json"),
      JSON.stringify({ defaultProvider: "anthropic", defaultModel: "claude-3-5-sonnet" }),
    );

    const config = await readPiLocalConfig();

    assert.equal(config.runtimeId, "pi");
    assert.equal(config.present, true);
    assert.equal(config.providers.length, 1);

    const provider = config.providers[0]!;
    assert.equal(provider.id, "anthropic");
    assert.equal(provider.apiFormat, "anthropic-messages");
    assert.equal(provider.baseUrl, "https://api.anthropic.com");
    assert.deepEqual(provider.credential, { configured: true, source: "auth.json（api_key）" });
    assert.equal(provider.defaultModelId, "claude-3-5-sonnet");
    assert.deepEqual(provider.sourcePaths, [path.join(dir, "models-store.json"), path.join(dir, "auth.json")]);

    assert.equal(provider.models.length, 1);
    const model = provider.models[0]!;
    assert.equal(model.id, "claude-3-5-sonnet");
    assert.equal(model.displayName, "Claude 3.5 Sonnet");
    assert.equal(model.contextWindow, 200000);
    assert.equal(model.maxOutputTokens, 8192);
    assert.deepEqual(model.inputCapabilities, ["text", "image"]);
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("piAdapter: all four files missing returns present=false with not_found issue", async () => {
  const { dir, cleanup } = makeTempDir("kith-pi-missing-");
  const restoreEnv = withRuntimeEnv({ PI_AGENT_DIR: dir });
  try {
    const config = await readPiLocalConfig();
    assert.equal(config.present, false);
    assert.equal(config.providers.length, 0);
    assert.equal(config.issues.length, 1);
    assert.equal(config.issues[0]!.kind, "not_found");
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("piAdapter: malformed models-store.json produces parse_error issue, not a throw", async () => {
  const { dir, cleanup } = makeTempDir("kith-pi-malformed-");
  const restoreEnv = withRuntimeEnv({ PI_AGENT_DIR: dir });
  try {
    await writeFixture(path.join(dir, "models-store.json"), "{ not valid json");

    const config = await readPiLocalConfig();

    // models-store.json 损坏，但整体没有全部四个文件缺失，所以 present 取决于是否解析出 provider。
    assert.equal(config.providers.length, 0);
    const parseIssue = config.issues.find((issue) => issue.kind === "parse_error");
    assert.ok(parseIssue);
    assert.equal(parseIssue.path, path.join(dir, "models-store.json"));
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("piAdapter: models.json custom provider overrides store entry with same id", async () => {
  const { dir, cleanup } = makeTempDir("kith-pi-override-");
  const restoreEnv = withRuntimeEnv({ PI_AGENT_DIR: dir });
  try {
    await writeFixture(
      path.join(dir, "models-store.json"),
      JSON.stringify({
        myprovider: { models: [{ id: "old-model" }] },
      }),
    );
    await writeFixture(
      path.join(dir, "models.json"),
      JSON.stringify({
        providers: [
          {
            id: "myprovider",
            name: "My Provider",
            baseUrl: "https://custom.example.com",
            api: "openai-completions",
            apiKey: "sk-test-fixture",
            models: [{ id: "custom-model" }],
          },
        ],
      }),
    );

    const config = await readPiLocalConfig();
    assert.equal(config.providers.length, 1);
    const provider = config.providers[0]!;
    assert.equal(provider.displayName, "My Provider");
    assert.equal(provider.baseUrl, "https://custom.example.com");
    assert.equal(provider.models.length, 1);
    assert.equal(provider.models[0]!.id, "custom-model");
    assert.deepEqual(provider.credential, { configured: true, source: "models.json 内联密钥" });
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("piAdapter: provider present in auth.json but absent from models-store.json still surfaces with empty models and an issue", async () => {
  const { dir, cleanup } = makeTempDir("kith-pi-authonly-");
  const restoreEnv = withRuntimeEnv({ PI_AGENT_DIR: dir });
  try {
    await writeFixture(
      path.join(dir, "auth.json"),
      JSON.stringify({ freshprovider: { type: "api_key", key: "sk-test-fixture" } }),
    );

    const config = await readPiLocalConfig();

    assert.equal(config.present, true);
    assert.equal(config.providers.length, 1);
    const provider = config.providers[0]!;
    assert.equal(provider.id, "freshprovider");
    assert.equal(provider.models.length, 0);
    assert.deepEqual(provider.credential, { configured: true, source: "auth.json（api_key）" });

    const issue = config.issues.find((i) => i.kind === "notice");
    assert.ok(issue);
    assert.match(issue.message, /freshprovider/);
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("piAdapter: default provider sorts first", async () => {
  const { dir, cleanup } = makeTempDir("kith-pi-sort-");
  const restoreEnv = withRuntimeEnv({ PI_AGENT_DIR: dir });
  try {
    await writeFixture(
      path.join(dir, "models-store.json"),
      JSON.stringify({
        zprovider: { models: [{ id: "z-model" }] },
        aprovider: { models: [{ id: "a-model" }] },
      }),
    );
    await writeFixture(
      path.join(dir, "settings.json"),
      JSON.stringify({ defaultProvider: "zprovider", defaultModel: "z-model" }),
    );

    const config = await readPiLocalConfig();
    assert.equal(config.providers[0]!.id, "zprovider");
    assert.equal(config.providers[1]!.id, "aprovider");
  } finally {
    restoreEnv();
    cleanup();
  }
});
