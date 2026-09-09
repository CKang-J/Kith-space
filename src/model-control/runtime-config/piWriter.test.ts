import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { deletePiProvider, setPiDefaultModel, writePiProvider } from "./piWriter.js";
import { makeTempDir, readJsonFixture, withRuntimeEnv, writeFixture } from "./testSupport.js";

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

test("piWriter.writePiProvider: adds a new provider, preserves sibling providers and unrelated settings fields", async () => {
  const { dir, cleanup } = makeTempDir("kith-piwriter-write-");
  const restoreEnv = withRuntimeEnv({ PI_AGENT_DIR: dir });
  try {
    const modelsPath = path.join(dir, "models.json");
    const authPath = path.join(dir, "auth.json");
    const settingsPath = path.join(dir, "settings.json");

    await writeFixture(
      modelsPath,
      JSON.stringify({
        providers: [{ id: "existing-provider", name: "Existing", models: [{ id: "existing-model" }] }],
      }),
    );
    await writeFixture(authPath, JSON.stringify({ "existing-provider": { type: "api_key", key: "sk-existing" } }));
    await writeFixture(settingsPath, JSON.stringify({ theme: "dark", packages: ["a", "b"] }));

    const touched = await writePiProvider({
      id: "new-provider",
      name: "New Provider",
      baseUrl: "https://new.example.com",
      api: "openai-completions",
      apiKey: "sk-test-fixture",
      models: [{ id: "new-model", name: "New Model", contextWindow: 128000 }],
    });

    assert.deepEqual(touched, [modelsPath, authPath]);

    const models = (await readJsonFixture(modelsPath)) as { providers: Array<Record<string, unknown>> };
    assert.equal(models.providers.length, 2);
    const existing = models.providers.find((p) => p.id === "existing-provider");
    assert.ok(existing);
    assert.equal(existing.name, "Existing");
    const created = models.providers.find((p) => p.id === "new-provider");
    assert.ok(created);
    assert.equal(created.name, "New Provider");
    assert.equal(created.baseUrl, "https://new.example.com");

    const auth = (await readJsonFixture(authPath)) as Record<string, { type: string }>;
    assert.equal(auth["existing-provider"]!.type, "api_key");
    assert.ok("new-provider" in auth);

    // settings.json 完全没被这次写操作触碰。
    const settings = (await readJsonFixture(settingsPath)) as Record<string, unknown>;
    assert.equal(settings.theme, "dark");
    assert.deepEqual(settings.packages, ["a", "b"]);
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("piWriter.writePiProvider: overwrites same-id provider fields but preserves fields not resubmitted", async () => {
  const { dir, cleanup } = makeTempDir("kith-piwriter-overwrite-");
  const restoreEnv = withRuntimeEnv({ PI_AGENT_DIR: dir });
  try {
    const modelsPath = path.join(dir, "models.json");
    await writeFixture(
      modelsPath,
      JSON.stringify({
        providers: [
          { id: "p1", name: "Old Name", compat: "some-pi-internal-field", models: [{ id: "old-model" }] },
        ],
      }),
    );

    await writePiProvider({ id: "p1", name: "New Name", models: [{ id: "new-model" }] });

    const models = (await readJsonFixture(modelsPath)) as { providers: Array<Record<string, unknown>> };
    assert.equal(models.providers.length, 1);
    const provider = models.providers[0]!;
    assert.equal(provider.name, "New Name");
    // compat 字段是 writePiProvider 没有提交的字段，应该保留（entry 与旧记录做了 spread 合并）。
    assert.equal(provider.compat, "some-pi-internal-field");
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("piWriter.writePiProvider: without apiKey does not touch auth.json at all", async () => {
  const { dir, cleanup } = makeTempDir("kith-piwriter-noauth-");
  const restoreEnv = withRuntimeEnv({ PI_AGENT_DIR: dir });
  try {
    const authPath = path.join(dir, "auth.json");
    await writeFixture(authPath, JSON.stringify({ "other-provider": { type: "api_key", key: "sk-other" } }));

    const touched = await writePiProvider({ id: "no-key-provider", models: [] });

    assert.deepEqual(touched, [path.join(dir, "models.json")]);
    const auth = (await readJsonFixture(authPath)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(auth), ["other-provider"]);
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("piWriter.deletePiProvider: removes provider from models.json, removes credential from auth.json, leaves settings.json alone", async () => {
  const { dir, cleanup } = makeTempDir("kith-piwriter-delete-");
  const restoreEnv = withRuntimeEnv({ PI_AGENT_DIR: dir });
  try {
    const modelsPath = path.join(dir, "models.json");
    const authPath = path.join(dir, "auth.json");
    const settingsPath = path.join(dir, "settings.json");

    await writeFixture(
      modelsPath,
      JSON.stringify({
        providers: [
          { id: "keep-me", models: [] },
          { id: "delete-me", models: [{ id: "m" }] },
        ],
      }),
    );
    await writeFixture(
      authPath,
      JSON.stringify({ "keep-me": { type: "api_key", key: "sk-keep" }, "delete-me": { type: "api_key", key: "sk-delete" } }),
    );
    await writeFixture(settingsPath, JSON.stringify({ defaultProvider: "keep-me", defaultModel: "m2" }));

    const touched = await deletePiProvider("delete-me");

    assert.deepEqual(touched, [modelsPath, authPath]);

    const models = (await readJsonFixture(modelsPath)) as { providers: Array<Record<string, unknown>> };
    assert.equal(models.providers.length, 1);
    assert.equal(models.providers[0]!.id, "keep-me");

    const auth = (await readJsonFixture(authPath)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(auth), ["keep-me"]);

    const settings = (await readJsonFixture(settingsPath)) as Record<string, unknown>;
    assert.equal(settings.defaultProvider, "keep-me");
    assert.equal(settings.defaultModel, "m2");
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("piWriter.deletePiProvider: deleting a provider absent from auth.json does not touch auth.json", async () => {
  const { dir, cleanup } = makeTempDir("kith-piwriter-delete-noauth-");
  const restoreEnv = withRuntimeEnv({ PI_AGENT_DIR: dir });
  try {
    const modelsPath = path.join(dir, "models.json");
    const authPath = path.join(dir, "auth.json");
    await writeFixture(modelsPath, JSON.stringify({ providers: [{ id: "solo-provider", models: [] }] }));
    await writeFixture(authPath, JSON.stringify({ "someone-else": { type: "api_key", key: "sk-x" } }));

    const touched = await deletePiProvider("solo-provider");

    assert.deepEqual(touched, [modelsPath]);
    assert.equal(await fileExists(authPath), true);
    const auth = (await readJsonFixture(authPath)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(auth), ["someone-else"]);
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("piWriter.setPiDefaultModel: sets defaultProvider/defaultModel, preserves unrelated settings fields, leaves other files alone", async () => {
  const { dir, cleanup } = makeTempDir("kith-piwriter-setdefault-");
  const restoreEnv = withRuntimeEnv({ PI_AGENT_DIR: dir });
  try {
    const settingsPath = path.join(dir, "settings.json");
    const modelsPath = path.join(dir, "models.json");
    const authPath = path.join(dir, "auth.json");

    await writeFixture(settingsPath, JSON.stringify({ theme: "dark", defaultProvider: "old", defaultModel: "old-model" }));
    await writeFixture(modelsPath, JSON.stringify({ providers: [{ id: "old", models: [] }] }));
    await writeFixture(authPath, JSON.stringify({ old: { type: "api_key", key: "sk-old" } }));

    const touchedPath = await setPiDefaultModel("new-provider", "new-model");

    assert.equal(touchedPath, settingsPath);
    const settings = (await readJsonFixture(settingsPath)) as Record<string, unknown>;
    assert.equal(settings.theme, "dark");
    assert.equal(settings.defaultProvider, "new-provider");
    assert.equal(settings.defaultModel, "new-model");

    // models.json / auth.json 完全没被触碰。
    const models = (await readJsonFixture(modelsPath)) as { providers: Array<Record<string, unknown>> };
    assert.equal(models.providers.length, 1);
    assert.equal(models.providers[0]!.id, "old");
    const auth = (await readJsonFixture(authPath)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(auth), ["old"]);
  } finally {
    restoreEnv();
    cleanup();
  }
});

test("piWriter.writePiProvider: throws instead of overwriting when models.json exists but is unparseable", async () => {
  const { dir, cleanup } = makeTempDir("kith-piwriter-refuse-");
  const restoreEnv = withRuntimeEnv({ PI_AGENT_DIR: dir });
  try {
    const modelsPath = path.join(dir, "models.json");
    await writeFixture(modelsPath, "{ not valid json");

    await assert.rejects(() => writePiProvider({ id: "x", models: [] }));

    // 文件内容必须原样保留，未被破坏性覆盖。
    const raw = await fs.readFile(modelsPath, "utf-8");
    assert.equal(raw, "{ not valid json");
  } finally {
    restoreEnv();
    cleanup();
  }
});
