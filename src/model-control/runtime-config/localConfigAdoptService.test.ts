/**
 * localConfigAdoptService 的集成测试：真实 fixture 文件 → 适配器解析 → 落库。
 *
 * 不 mock 适配器：这条链路（读本机配置 → 建 provider connection → 建 model configuration）
 * 之前整段不通，只有端到端跑一遍才能证明向导拿到的 configurationId 真的能查到。
 *
 * KITH_SPACE_HOME 必须在任何动态 import 之前设好，否则应用库会初始化到真实用户目录。
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const home = mkdtempSync(path.join(os.tmpdir(), "kith-adopt-home-"));
process.env.KITH_SPACE_HOME = home;

const { closeAppDatabase } = await import("../../app-data/appDatabase.js");
const { providerCredentialPort } = await import("../../advisor-provider/credentialPort.js");
const { ModelControlError } = await import("../contracts.js");
const { ModelConfigurationService } = await import("../modelConfigurationService.js");
const { ModelProviderConnectionService } = await import("../modelProviderConnectionService.js");
const { LocalConfigAdoptService } = await import("./localConfigAdoptService.js");
const { makeTempDir, withProcessEnv, withRuntimeEnv, writeJsonFixture } = await import("./testSupport.js");

const providers = new ModelProviderConnectionService();
const configurations = new ModelConfigurationService(providers);
const service = new LocalConfigAdoptService(providers, configurations);

function activeProviders() {
  return providers.list().filter((item) => item.connection.status === "active");
}

function activeConfigurations() {
  return configurations.list().filter((item) => item.configuration.status === "active");
}

/** Pi fixture：models-store.json 提供模型清单，auth.json 提供 api_key。 */
async function writePiFixture(dir: string, options: {
  providerId: string;
  baseUrl: string;
  api?: string;
  modelId: string;
  /** 省略则不写 auth 条目（keyless）。oauth 条目可带 key 以外的字段。 */
  auth?: { type: string; key?: string; access?: string };
}): Promise<void> {
  await writeJsonFixture(path.join(dir, "models.json"), { providers: [] });
  await writeJsonFixture(path.join(dir, "models-store.json"), {
    [options.providerId]: {
      models: [{
        id: options.modelId,
        name: `${options.modelId} 展示名`,
        api: options.api ?? "openai-completions",
        baseUrl: options.baseUrl,
        contextWindow: 128000,
        maxTokens: 8192,
        reasoning: false,
        input: ["text"],
      }],
    },
  });
  await writeJsonFixture(
    path.join(dir, "auth.json"),
    options.auth ? { [options.providerId]: options.auth } : {},
  );
}

/** Pi 场景通用外壳：隔离目录 + PI_AGENT_DIR 覆盖，并清掉可能干扰凭据探测的进程环境。 */
async function withPiFixture<T>(
  prefix: string,
  options: Parameters<typeof writePiFixture>[1],
  body: (dir: string) => Promise<T>,
): Promise<T> {
  const { dir, cleanup } = makeTempDir(prefix);
  const restoreRuntimeEnv = withRuntimeEnv({ PI_AGENT_DIR: dir });
  const restoreProcessEnv = withProcessEnv({
    ANTHROPIC_API_KEY: undefined,
    ANTHROPIC_AUTH_TOKEN: undefined,
  });
  try {
    await writePiFixture(dir, options);
    return await body(dir);
  } finally {
    restoreProcessEnv();
    restoreRuntimeEnv();
    cleanup();
  }
}

test.after(() => {
  closeAppDatabase();
  rmSync(home, { recursive: true, force: true });
});

test("adopt: Pi happy path creates a configuration that is findable by id afterwards", async () => {
  await withPiFixture("kith-adopt-pi-happy-", {
    providerId: "adopt-happy",
    baseUrl: "https://api.happy.example.com/v1",
    modelId: "happy-model",
    auth: { type: "api_key", key: "sk-test-happy-fixture" },
  }, async () => {
    const result = await service.adopt({
      runtimeId: "pi",
      providerId: "adopt-happy",
      modelId: "happy-model",
    });

    assert.equal(result.reused, false);
    assert.ok(result.configurationId.length > 0);
    assert.ok(result.configurationRevision >= 1);
    assert.ok(result.providerConnectionId.length > 0);
    assert.equal(result.credentialNotice, undefined);

    // 向导保存时 AgentModelBindingService.resolve 会按 id 查这一行，必须真的存在。
    const found = configurations.list().find((item) => item.configuration.id === result.configurationId);
    assert.ok(found, "adopted configuration must be present in ModelConfigurationService.list()");
    assert.equal(found.revision.modelId, "happy-model");
    assert.equal(found.revision.providerConnectionId, result.providerConnectionId);
    assert.equal(found.configuration.currentRevision, result.configurationRevision);
    assert.equal(found.configuration.displayName, result.displayName);
    assert.equal(found.revision.contextWindow, 128000);
    assert.equal(found.revision.maxOutputTokens, 8192);

    const connection = providers.get(result.providerConnectionId);
    assert.equal(connection.revision.backendId, "adopt-happy");
    assert.equal(connection.revision.credentialSourceKind, "kith_secret");
    assert.equal(connection.revision.canonicalOrigin, "https://api.happy.example.com/v1");
  });
});

test("adopt: second identical call reuses the same configuration and creates no duplicate rows", async () => {
  await withPiFixture("kith-adopt-pi-idempotent-", {
    providerId: "adopt-idempotent",
    baseUrl: "https://api.idempotent.example.com/v1",
    modelId: "idempotent-model",
    auth: { type: "api_key", key: "sk-test-idempotent-fixture" },
  }, async () => {
    const providersBefore = activeProviders().length;
    const configurationsBefore = activeConfigurations().length;

    const first = await service.adopt({
      runtimeId: "pi",
      providerId: "adopt-idempotent",
      modelId: "idempotent-model",
    });
    assert.equal(first.reused, false);
    assert.equal(activeProviders().length, providersBefore + 1);
    assert.equal(activeConfigurations().length, configurationsBefore + 1);

    const second = await service.adopt({
      runtimeId: "pi",
      providerId: "adopt-idempotent",
      modelId: "idempotent-model",
    });
    assert.equal(second.reused, true);
    assert.equal(second.configurationId, first.configurationId);
    assert.equal(second.providerConnectionId, first.providerConnectionId);
    assert.equal(second.configurationRevision, first.configurationRevision);

    // 关键：复用而非追加，计数必须与第一次之后完全一致。
    assert.equal(activeProviders().length, providersBefore + 1);
    assert.equal(activeConfigurations().length, configurationsBefore + 1);
  });
});

test("adopt: same provider id at a different baseUrl is a distinct execution identity", async () => {
  const providerId = "adopt-moving-endpoint";
  const modelId = "moving-model";

  const first = await withPiFixture("kith-adopt-pi-origin-a-", {
    providerId,
    baseUrl: "https://api.origin-a.example.com/v1",
    modelId,
    auth: { type: "api_key", key: "sk-test-origin-a-fixture" },
  }, async () => service.adopt({ runtimeId: "pi", providerId, modelId }));

  const second = await withPiFixture("kith-adopt-pi-origin-b-", {
    providerId,
    baseUrl: "https://api.origin-b.example.com/v1",
    modelId,
    auth: { type: "api_key", key: "sk-test-origin-b-fixture" },
  }, async () => service.adopt({ runtimeId: "pi", providerId, modelId }));

  assert.equal(first.reused, false);
  assert.equal(second.reused, false);
  assert.notEqual(second.providerConnectionId, first.providerConnectionId);
  assert.notEqual(second.configurationId, first.configurationId);

  assert.equal(
    providers.get(first.providerConnectionId).revision.canonicalOrigin,
    "https://api.origin-a.example.com/v1",
  );
  assert.equal(
    providers.get(second.providerConnectionId).revision.canonicalOrigin,
    "https://api.origin-b.example.com/v1",
  );
});

test("adopt: keyless provider still succeeds and reports a credentialNotice", async () => {
  // auth.json 里没有该供应商，models.json 也没有内联 apiKey。
  await withPiFixture("kith-adopt-pi-keyless-", {
    providerId: "adopt-keyless",
    baseUrl: "https://api.keyless.example.com/v1",
    modelId: "keyless-model",
  }, async () => {
    const result = await service.adopt({
      runtimeId: "pi",
      providerId: "adopt-keyless",
      modelId: "keyless-model",
    });

    assert.equal(result.reused, false);
    assert.equal(typeof result.credentialNotice, "string");
    assert.ok((result.credentialNotice ?? "").length > 0);
    assert.equal(providers.get(result.providerConnectionId).revision.credentialSourceKind, "keyless_local");
    // 采纳仍然成功：配置真的落库了，不是「返回了 notice 但什么都没建」。
    assert.ok(configurations.list().some((item) => item.configuration.id === result.configurationId));
  });
});

test("adopt: oauth-only Pi provider is treated as keyless with an explanatory notice", async () => {
  await withPiFixture("kith-adopt-pi-oauth-", {
    providerId: "adopt-oauth",
    baseUrl: "https://api.oauth.example.com/v1",
    modelId: "oauth-model",
    auth: { type: "oauth", access: "token-not-a-key" },
  }, async () => {
    const result = await service.adopt({
      runtimeId: "pi",
      providerId: "adopt-oauth",
      modelId: "oauth-model",
    });

    assert.equal(result.reused, false);
    assert.match(result.credentialNotice ?? "", /OAuth/);
    assert.equal(providers.get(result.providerConnectionId).revision.credentialSourceKind, "keyless_local");
  });
});

test("adopt: unknown provider id throws model_provider_not_found", async () => {
  await withPiFixture("kith-adopt-pi-noprovider-", {
    providerId: "adopt-present",
    baseUrl: "https://api.present.example.com/v1",
    modelId: "present-model",
  }, async () => {
    await assert.rejects(
      () => service.adopt({ runtimeId: "pi", providerId: "adopt-absent", modelId: "present-model" }),
      (error: unknown) => {
        assert.ok(error instanceof ModelControlError);
        assert.equal(error.code, "model_provider_not_found");
        // 与「地址非法」共用同一个 code，靠 message 区分，否则本用例可能名不副实。
        assert.match(error.message, /没有供应商/);
        return true;
      },
    );
  });
});

test("adopt: known provider but unknown model id throws model_configuration_not_found", async () => {
  await withPiFixture("kith-adopt-pi-nomodel-", {
    providerId: "adopt-has-provider",
    baseUrl: "https://api.hasprovider.example.com/v1",
    modelId: "real-model",
  }, async () => {
    await assert.rejects(
      () => service.adopt({ runtimeId: "pi", providerId: "adopt-has-provider", modelId: "ghost-model" }),
      (error: unknown) => {
        assert.ok(error instanceof ModelControlError);
        assert.equal(error.code, "model_configuration_not_found");
        return true;
      },
    );
  });
});

test("adopt: baseUrl that canonicalAdvisorOrigin rejects throws model_provider_not_found", async () => {
  // canonicalAdvisorOrigin 拒绝三类：非绝对 URL、带 query/fragment/凭据、非 loopback 的 http。
  const cases: ReadonlyArray<{ label: string; baseUrl: string }> = [
    { label: "relative", baseUrl: "api.example.com/v1" },
    { label: "query", baseUrl: "https://api.example.com/v1?token=abc" },
    { label: "plain-http-public", baseUrl: "http://api.example.com/v1" },
  ];

  for (const item of cases) {
    const providerId = `adopt-badurl-${item.label}`;
    await withPiFixture(`kith-adopt-pi-badurl-${item.label}-`, {
      providerId,
      baseUrl: item.baseUrl,
      modelId: "bad-url-model",
    }, async () => {
      await assert.rejects(
        () => service.adopt({ runtimeId: "pi", providerId, modelId: "bad-url-model" }),
        (error: unknown) => {
          assert.ok(error instanceof ModelControlError, `${item.label} should raise ModelControlError`);
          assert.equal(error.code, "model_provider_not_found", `${item.label} code`);
          return true;
        },
      );
    });
  }
});

test("adopt: Claude settings.json tier model resolves apiKind to anthropic-messages", async () => {
  const { dir, cleanup } = makeTempDir("kith-adopt-claude-");
  const restoreRuntimeEnv = withRuntimeEnv({ CLAUDE_CONFIG_DIR: dir });
  const restoreProcessEnv = withProcessEnv({
    ANTHROPIC_API_KEY: undefined,
    ANTHROPIC_AUTH_TOKEN: undefined,
  });
  try {
    await writeJsonFixture(path.join(dir, "settings.json"), {
      model: "sonnet",
      env: {
        ANTHROPIC_BASE_URL: "https://relay.claude.example.com",
        ANTHROPIC_AUTH_TOKEN: "sk-test-claude-fixture",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "relay-sonnet",
        ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "Relay Sonnet",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "relay-opus",
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: 200000,
      },
    });

    const result = await service.adopt({
      runtimeId: "claude",
      providerId: "claude-local",
      modelId: "relay-sonnet",
    });

    assert.equal(result.reused, false);
    const connection = providers.get(result.providerConnectionId);
    assert.equal(connection.revision.apiKind, "anthropic-messages");
    assert.equal(connection.revision.canonicalOrigin, "https://relay.claude.example.com");
    assert.equal(connection.revision.networkClass, "public_cloud");
    assert.equal(connection.revision.sourceKind, "claude_import");
    assert.equal(connection.revision.credentialSourceKind, "kith_secret");

    const found = configurations.list().find((item) => item.configuration.id === result.configurationId);
    assert.ok(found);
    assert.equal(found.revision.modelId, "relay-sonnet");
    assert.equal(found.revision.contextWindow, 200000);
  } finally {
    restoreProcessEnv();
    restoreRuntimeEnv();
    cleanup();
  }
});

/**
 * Claude 的 apiFormat 与 Claude 的兜底值恰好都是 anthropic-messages，
 * 所以上一个用例证明不了「apiFormat→apiKind 的映射真的被用到了」。
 * 这里用 Pi（兜底 openai-completions）配 anthropic-messages，让映射值与兜底值不同。
 */
test("adopt: apiFormat is mapped, not silently replaced by the runtime fallback", async () => {
  await withPiFixture("kith-adopt-pi-apikind-", {
    providerId: "adopt-apikind",
    baseUrl: "https://api.apikind.example.com",
    api: "anthropic-messages",
    modelId: "apikind-model",
    auth: { type: "api_key", key: "sk-test-apikind-fixture" },
  }, async () => {
    const result = await service.adopt({
      runtimeId: "pi",
      providerId: "adopt-apikind",
      modelId: "apikind-model",
    });
    // Pi 的兜底是 openai-completions；出现 anthropic-messages 只能来自映射表。
    assert.equal(providers.get(result.providerConnectionId).revision.apiKind, "anthropic-messages");
  });

  // openai-chat 是 Kith 侧没有的名字，必须被折叠成 openai-completions。
  await withPiFixture("kith-adopt-pi-apikind-chat-", {
    providerId: "adopt-apikind-chat",
    baseUrl: "https://api.apikind-chat.example.com",
    api: "openai-chat",
    modelId: "apikind-chat-model",
    auth: { type: "api_key", key: "sk-test-apikind-chat-fixture" },
  }, async () => {
    const result = await service.adopt({
      runtimeId: "pi",
      providerId: "adopt-apikind-chat",
      modelId: "apikind-chat-model",
    });
    assert.equal(providers.get(result.providerConnectionId).revision.apiKind, "openai-completions");
  });
});

test("adopt: loopback baseUrl yields networkClass loopback", async () => {
  await withPiFixture("kith-adopt-pi-loopback-", {
    providerId: "adopt-ollama",
    baseUrl: "http://127.0.0.1:11434",
    modelId: "qwen3:8b",
  }, async () => {
    const result = await service.adopt({
      runtimeId: "pi",
      providerId: "adopt-ollama",
      modelId: "qwen3:8b",
    });

    const connection = providers.get(result.providerConnectionId);
    assert.equal(connection.revision.networkClass, "loopback");
    assert.equal(connection.revision.canonicalOrigin, "http://127.0.0.1:11434");
    assert.deepEqual([...connection.revision.allowedEgress], ["http://127.0.0.1:11434"]);
  });
});

test("adopt: no plaintext credential leaks into the returned result", async () => {
  const sentinelKey = "sk-test-SENTINEL-do-not-leak";
  await withPiFixture("kith-adopt-pi-sentinel-", {
    providerId: "adopt-sentinel",
    baseUrl: "https://api.sentinel.example.com/v1",
    modelId: "sentinel-model",
    auth: { type: "api_key", key: sentinelKey },
  }, async () => {
    const result = await service.adopt({
      runtimeId: "pi",
      providerId: "adopt-sentinel",
      modelId: "sentinel-model",
    });

    assert.ok(!JSON.stringify(result).includes("SENTINEL"), "result must not carry credential plaintext");

    // 证明明文确实被采纳并加密落库了，否则上面的断言可能只是因为凭据根本没被读到而通过。
    const connection = providers.get(result.providerConnectionId);
    assert.equal(connection.revision.credentialSourceKind, "kith_secret");
    assert.ok(connection.revision.credentialRef);
    assert.equal(
      providerCredentialPort.identityForStoredRef(
        connection.revision.credentialRef,
        "adopt-sentinel",
        "kith_secret",
      ),
      connection.revision.credentialIdentityDigest,
    );
  });
});
