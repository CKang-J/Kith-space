import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveLocalCredential } from "./localCredentialResolver.js";
import { makeTempDir, withProcessEnv, withRuntimeEnv, writeFixture } from "./testSupport.js";

// SECURITY NOTE: every fixture secret below is an obviously-fake placeholder
// ("sk-test-fixture"). Assertions only ever check `kind` / `source` / `reason` —
// never the resolved `value` — per the module's stated security boundary.

test("localCredentialResolver: Claude — literal token in settings.json resolves as secret with source", async () => {
  const { dir, cleanup } = makeTempDir("kith-cred-claude-literal-");
  const restoreEnv = withRuntimeEnv({ CLAUDE_CONFIG_DIR: dir });
  try {
    await writeFixture(
      path.join(dir, "settings.json"),
      JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "sk-test-fixture" } }),
    );

    const resolved = await resolveLocalCredential("claude", "claude-local");
    assert.equal(resolved.kind, "secret");
    if (resolved.kind === "secret") assert.equal(resolved.source, "settings.json 的 ANTHROPIC_AUTH_TOKEN");
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("localCredentialResolver: Claude — env var reference in settings.json resolves via process.env", async () => {
  const { dir, cleanup } = makeTempDir("kith-cred-claude-envref-");
  const restoreEnv = withRuntimeEnv({ CLAUDE_CONFIG_DIR: dir });
  const restoreProcessEnv = withProcessEnv({ MY_TOKEN_VAR: "sk-test-fixture" });
  try {
    await writeFixture(
      path.join(dir, "settings.json"),
      JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "${MY_TOKEN_VAR}" } }),
    );

    const resolved = await resolveLocalCredential("claude", "claude-local");
    assert.equal(resolved.kind, "secret");
    if (resolved.kind === "secret") assert.equal(resolved.source, "环境变量 MY_TOKEN_VAR");
  } finally {
    restoreProcessEnv();
    restoreEnv();
    cleanup();
  }
});

test("localCredentialResolver: Claude — no settings.json and no process env is keyless", async () => {
  const { dir, cleanup } = makeTempDir("kith-cred-claude-none-");
  const restoreEnv = withRuntimeEnv({ CLAUDE_CONFIG_DIR: dir });
  const restoreProcessEnv = withProcessEnv({ ANTHROPIC_AUTH_TOKEN: undefined, ANTHROPIC_API_KEY: undefined });
  try {
    const resolved = await resolveLocalCredential("claude", "claude-local");
    assert.equal(resolved.kind, "keyless");
    if (resolved.kind === "keyless") assert.match(resolved.reason, /没有找到/);
  } finally {
    restoreProcessEnv();
    restoreEnv();
    cleanup();
  }
});

test("localCredentialResolver: Pi — oauth entries in auth.json are keyless (not reusable as API key)", async () => {
  const { dir, cleanup } = makeTempDir("kith-cred-pi-oauth-");
  const restoreEnv = withRuntimeEnv({ PI_AGENT_DIR: dir });
  try {
    await writeFixture(
      path.join(dir, "auth.json"),
      JSON.stringify({ myprovider: { type: "oauth", key: "sk-test-fixture" } }),
    );

    const resolved = await resolveLocalCredential("pi", "myprovider");
    assert.equal(resolved.kind, "keyless");
    if (resolved.kind === "keyless") assert.match(resolved.reason, /OAuth/);
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("localCredentialResolver: Pi — api_key entry in auth.json resolves as secret", async () => {
  const { dir, cleanup } = makeTempDir("kith-cred-pi-apikey-");
  const restoreEnv = withRuntimeEnv({ PI_AGENT_DIR: dir });
  try {
    await writeFixture(
      path.join(dir, "auth.json"),
      JSON.stringify({ myprovider: { type: "api_key", key: "sk-test-fixture" } }),
    );

    const resolved = await resolveLocalCredential("pi", "myprovider");
    assert.equal(resolved.kind, "secret");
    if (resolved.kind === "secret") assert.equal(resolved.source, "auth.json 的 myprovider");
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("localCredentialResolver: Pi — falls back to models.json inline apiKey when auth.json has no entry", async () => {
  const { dir, cleanup } = makeTempDir("kith-cred-pi-inline-");
  const restoreEnv = withRuntimeEnv({ PI_AGENT_DIR: dir });
  try {
    await writeFixture(
      path.join(dir, "models.json"),
      JSON.stringify({ providers: [{ id: "myprovider", apiKey: "sk-test-fixture" }] }),
    );

    const resolved = await resolveLocalCredential("pi", "myprovider");
    assert.equal(resolved.kind, "secret");
    if (resolved.kind === "secret") assert.equal(resolved.source, "models.json 的 myprovider.apiKey");
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("localCredentialResolver: Pi — unknown provider with no auth.json/models.json entry is keyless", async () => {
  const { dir, cleanup } = makeTempDir("kith-cred-pi-unknown-");
  const restoreEnv = withRuntimeEnv({ PI_AGENT_DIR: dir });
  try {
    const resolved = await resolveLocalCredential("pi", "nonexistent");
    assert.equal(resolved.kind, "keyless");
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("localCredentialResolver: Codex — env_key in config.toml resolves via process.env", async () => {
  const { dir, cleanup } = makeTempDir("kith-cred-codex-envkey-");
  const restoreEnv = withRuntimeEnv({ CODEX_HOME: dir });
  const restoreProcessEnv = withProcessEnv({ MY_RELAY_KEY: "sk-test-fixture" });
  try {
    await writeFixture(
      path.join(dir, "config.toml"),
      ['[model_providers.myrelay]', 'env_key = "MY_RELAY_KEY"', ""].join("\n"),
    );

    const resolved = await resolveLocalCredential("codex", "myrelay");
    assert.equal(resolved.kind, "secret");
    if (resolved.kind === "secret") assert.equal(resolved.source, "环境变量 MY_RELAY_KEY");
  } finally {
    restoreProcessEnv();
    restoreEnv();
    cleanup();
  }
});

test("localCredentialResolver: Codex — no env_key but auth.json exists is keyless (oauth session, not reusable)", async () => {
  const { dir, cleanup } = makeTempDir("kith-cred-codex-auth-");
  const restoreEnv = withRuntimeEnv({ CODEX_HOME: dir });
  try {
    await writeFixture(path.join(dir, "auth.json"), JSON.stringify({ session: "whatever" }));

    const resolved = await resolveLocalCredential("codex", "myrelay");
    assert.equal(resolved.kind, "keyless");
    if (resolved.kind === "keyless") assert.match(resolved.reason, /登录会话/);
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("localCredentialResolver: Codex — nothing at all is keyless", async () => {
  const { dir, cleanup } = makeTempDir("kith-cred-codex-none-");
  const restoreEnv = withRuntimeEnv({ CODEX_HOME: dir });
  try {
    const resolved = await resolveLocalCredential("codex", "myrelay");
    assert.equal(resolved.kind, "keyless");
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("localCredentialResolver: OpenCode — options.apiKey resolves as secret", async () => {
  const { dir, cleanup } = makeTempDir("kith-cred-opencode-");
  const configPath = path.join(dir, "opencode.json");
  const restoreEnv = withRuntimeEnv({ OPENCODE_CONFIG: configPath });
  try {
    await writeFixture(
      configPath,
      JSON.stringify({ provider: { myprovider: { options: { apiKey: "sk-test-fixture" } } } }),
    );

    const resolved = await resolveLocalCredential("opencode", "myprovider");
    assert.equal(resolved.kind, "secret");
    if (resolved.kind === "secret") assert.equal(resolved.source, "opencode.json 的 provider.myprovider.options.apiKey");
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("localCredentialResolver: OpenCode — missing config file is keyless", async () => {
  const { dir, cleanup } = makeTempDir("kith-cred-opencode-missing-");
  const configPath = path.join(dir, "opencode.json");
  const restoreEnv = withRuntimeEnv({ OPENCODE_CONFIG: configPath });
  try {
    const resolved = await resolveLocalCredential("opencode", "myprovider");
    assert.equal(resolved.kind, "keyless");
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("localCredentialResolver: rejects command-style (!command) credentials", async () => {
  const { dir, cleanup } = makeTempDir("kith-cred-command-");
  const restoreEnv = withRuntimeEnv({ CLAUDE_CONFIG_DIR: dir });
  try {
    await writeFixture(
      path.join(dir, "settings.json"),
      JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "!/usr/bin/get-secret" } }),
    );

    const resolved = await resolveLocalCredential("claude", "claude-local");
    assert.equal(resolved.kind, "keyless");
    if (resolved.kind === "keyless") assert.match(resolved.reason, /命令式凭据/);
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("localCredentialResolver: rejects dangerous environment variable names like PATH", async () => {
  const { dir, cleanup } = makeTempDir("kith-cred-dangerous-");
  const restoreEnv = withRuntimeEnv({ CLAUDE_CONFIG_DIR: dir });
  try {
    await writeFixture(
      path.join(dir, "settings.json"),
      JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "${PATH}" } }),
    );

    const resolved = await resolveLocalCredential("claude", "claude-local");
    assert.equal(resolved.kind, "keyless");
    if (resolved.kind === "keyless") assert.match(resolved.reason, /拒绝/);
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("localCredentialResolver: rejects compound ${VAR} interpolation mixed with literal text", async () => {
  const { dir, cleanup } = makeTempDir("kith-cred-compound-");
  const restoreEnv = withRuntimeEnv({ CLAUDE_CONFIG_DIR: dir });
  try {
    await writeFixture(
      path.join(dir, "settings.json"),
      JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "prefix-${SOME_VAR}-suffix" } }),
    );

    const resolved = await resolveLocalCredential("claude", "claude-local");
    assert.equal(resolved.kind, "keyless");
    if (resolved.kind === "keyless") assert.match(resolved.reason, /复合环境变量插值/);
  } finally {
    restoreEnv();
    cleanup();
  }
});
