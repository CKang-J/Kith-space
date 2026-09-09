import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { clearClaudeTiers, patchClaudeConfig } from "./claudeWriter.js";
import { makeTempDir, readJsonFixture, withRuntimeEnv, writeFixture } from "./testSupport.js";

function baseSettings() {
  return {
    permissions: { allow: ["Bash(git:*)"], deny: [] },
    enabledPlugins: ["some-plugin"],
    env: {
      ANTHROPIC_BASE_URL: "https://existing.example.com",
      SOME_UNRELATED_VAR: "keep-me",
    },
  };
}

test("claudeWriter.patchClaudeConfig: merges — unrelated keys survive byte-for-byte", async () => {
  const { dir, cleanup } = makeTempDir("kith-claudewriter-merge-");
  const restoreEnv = withRuntimeEnv({ CLAUDE_CONFIG_DIR: dir });
  try {
    const settingsPath = path.join(dir, "settings.json");
    await writeFixture(settingsPath, JSON.stringify(baseSettings()));

    await patchClaudeConfig({
      tiers: { sonnet: { modelId: "new-sonnet-model" } },
    });

    const written = (await readJsonFixture(settingsPath)) as Record<string, unknown>;
    assert.deepEqual(written.permissions, { allow: ["Bash(git:*)"], deny: [] });
    assert.deepEqual(written.enabledPlugins, ["some-plugin"]);

    const env = written.env as Record<string, unknown>;
    assert.equal(env.SOME_UNRELATED_VAR, "keep-me");
    assert.equal(env.ANTHROPIC_BASE_URL, "https://existing.example.com");
    assert.equal(env.ANTHROPIC_DEFAULT_SONNET_MODEL, "new-sonnet-model");
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("claudeWriter.patchClaudeConfig: undefined leaves field untouched", async () => {
  const { dir, cleanup } = makeTempDir("kith-claudewriter-undefined-");
  const restoreEnv = withRuntimeEnv({ CLAUDE_CONFIG_DIR: dir });
  try {
    const settingsPath = path.join(dir, "settings.json");
    await writeFixture(settingsPath, JSON.stringify(baseSettings()));

    const result = await patchClaudeConfig({ baseUrl: undefined, authToken: undefined });

    assert.deepEqual(result.changedKeys, []);
    const written = (await readJsonFixture(settingsPath)) as Record<string, unknown>;
    const env = written.env as Record<string, unknown>;
    assert.equal(env.ANTHROPIC_BASE_URL, "https://existing.example.com");
    assert.equal("ANTHROPIC_AUTH_TOKEN" in env, false);
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("claudeWriter.patchClaudeConfig: null deletes the key, empty string also deletes", async () => {
  const { dir, cleanup } = makeTempDir("kith-claudewriter-null-");
  const restoreEnv = withRuntimeEnv({ CLAUDE_CONFIG_DIR: dir });
  try {
    const settingsPath = path.join(dir, "settings.json");
    await writeFixture(
      settingsPath,
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: "https://existing.example.com",
          ANTHROPIC_AUTH_TOKEN: "sk-test-fixture",
          ANTHROPIC_DEFAULT_HAIKU_MODEL: "haiku-x",
        },
      }),
    );

    await patchClaudeConfig({
      baseUrl: null,
      tiers: { haiku: { modelId: "" } },
    });

    const written = (await readJsonFixture(settingsPath)) as Record<string, unknown>;
    const env = written.env as Record<string, unknown>;
    assert.equal("ANTHROPIC_BASE_URL" in env, false);
    assert.equal("ANTHROPIC_DEFAULT_HAIKU_MODEL" in env, false);
    // 未传 authToken（undefined），保持不变。
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, "sk-test-fixture");
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("claudeWriter.patchClaudeConfig: string value writes the field", async () => {
  const { dir, cleanup } = makeTempDir("kith-claudewriter-string-");
  const restoreEnv = withRuntimeEnv({ CLAUDE_CONFIG_DIR: dir });
  try {
    const settingsPath = path.join(dir, "settings.json");
    await writeFixture(settingsPath, JSON.stringify({}));

    const result = await patchClaudeConfig({ baseUrl: "https://new.example.com", selectedModel: "fable" });

    assert.ok(result.changedKeys.includes("ANTHROPIC_BASE_URL"));
    assert.ok(result.changedKeys.includes("model"));
    const written = (await readJsonFixture(settingsPath)) as Record<string, unknown>;
    assert.equal((written.env as Record<string, unknown>).ANTHROPIC_BASE_URL, "https://new.example.com");
    assert.equal(written.model, "fable");
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("claudeWriter.patchClaudeConfig: refuses to write when file exists but is unparseable", async () => {
  const { dir, cleanup } = makeTempDir("kith-claudewriter-refuse-");
  const restoreEnv = withRuntimeEnv({ CLAUDE_CONFIG_DIR: dir });
  try {
    const settingsPath = path.join(dir, "settings.json");
    await writeFixture(settingsPath, "{ this is not json");

    await assert.rejects(
      () => patchClaudeConfig({ baseUrl: "https://new.example.com" }),
      /为避免覆盖用户数据，已中止写入/,
    );

    // 文件必须保持原样，一个字节都不能变。
    const raw = await import("node:fs/promises").then((fs) => fs.readFile(settingsPath, "utf-8"));
    assert.equal(raw, "{ this is not json");
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("claudeWriter.patchClaudeConfig: writes successfully when file does not exist yet", async () => {
  const { dir, cleanup } = makeTempDir("kith-claudewriter-nofile-");
  const restoreEnv = withRuntimeEnv({ CLAUDE_CONFIG_DIR: dir });
  try {
    const settingsPath = path.join(dir, "settings.json");
    const result = await patchClaudeConfig({ baseUrl: "https://new.example.com" });
    assert.equal(result.path, settingsPath);
    const written = (await readJsonFixture(settingsPath)) as Record<string, unknown>;
    assert.equal((written.env as Record<string, unknown>).ANTHROPIC_BASE_URL, "https://new.example.com");
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("claudeWriter.clearClaudeTiers: clears all four tier keys and their _NAME variants, keeps other env vars", async () => {
  const { dir, cleanup } = makeTempDir("kith-claudewriter-cleartiers-");
  const restoreEnv = withRuntimeEnv({ CLAUDE_CONFIG_DIR: dir });
  try {
    const settingsPath = path.join(dir, "settings.json");
    await writeFixture(
      settingsPath,
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: "https://existing.example.com",
          ANTHROPIC_DEFAULT_HAIKU_MODEL: "haiku-x",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "sonnet-x",
          ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "Sonnet 展示名",
          ANTHROPIC_DEFAULT_OPUS_MODEL: "opus-x",
          ANTHROPIC_DEFAULT_FABLE_MODEL: "fable-x",
        },
      }),
    );

    await clearClaudeTiers();

    const written = (await readJsonFixture(settingsPath)) as Record<string, unknown>;
    const env = written.env as Record<string, unknown>;
    assert.equal(env.ANTHROPIC_BASE_URL, "https://existing.example.com");
    for (const key of [
      "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      "ANTHROPIC_DEFAULT_SONNET_MODEL",
      "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
      "ANTHROPIC_DEFAULT_OPUS_MODEL",
      "ANTHROPIC_DEFAULT_FABLE_MODEL",
    ]) {
      assert.equal(key in env, false, `${key} should have been cleared`);
    }
  } finally {
    restoreEnv();
    cleanup();
  }
});
