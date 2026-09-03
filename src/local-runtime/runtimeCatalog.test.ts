import assert from "node:assert/strict";
import test from "node:test";
import { runtimeAvailability, validateRuntimeModel } from "./runtimeCatalog.js";

test("runtime availability keeps the full catalog and sorts installed runtimes first", () => {
  const result = runtimeAvailability(["opencode", "codex"]);

  assert.deepEqual(result.slice(0, 2), [
    { id: "codex", label: "Codex", installed: true },
    { id: "opencode", label: "OpenCode", installed: true },
  ]);
  assert.deepEqual(
    result.filter((runtime) => !runtime.installed).map((runtime) => runtime.id),
    ["claude", "copilot", "kimi", "pi", "cursor", "hermes"],
  );
});

test("the built-in Pi Agent is always available without any installed CLI", () => {
  const result = runtimeAvailability([]);
  const builtin = result.find((runtime) => runtime.id === "pi-builtin");
  assert.equal(builtin?.installed, true);
  assert.equal(builtin?.builtIn, true);
  assert.equal(builtin?.label, "Pi Agent（内置）");
});

test("unknown worker capabilities do not leak into the supported runtime catalog", () => {
  const result = runtimeAvailability(["unknown-runtime" as any]);
  assert.equal(result.some((runtime) => runtime.id === ("unknown-runtime" as any)), false);
  assert.deepEqual(
    result.filter((runtime) => runtime.installed).map((runtime) => runtime.id),
    ["pi-builtin"],
  );
});

test("OpenCode creation requires an explicit provider/model", () => {
  assert.match(validateRuntimeModel("opencode", null) ?? "", /provider\/model/);
  assert.match(validateRuntimeModel("opencode", "default") ?? "", /provider\/model/);
  assert.match(validateRuntimeModel("opencode", "deepseek-chat") ?? "", /provider\/model/);
  assert.match(validateRuntimeModel("opencode", "/deepseek-chat") ?? "", /provider\/model/);
  assert.match(validateRuntimeModel("opencode", "deepseek/") ?? "", /provider\/model/);
  assert.equal(validateRuntimeModel("opencode", "deepseek/deepseek-chat"), null);
  assert.equal(validateRuntimeModel("claude", null), null);
});
