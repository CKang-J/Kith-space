import assert from "node:assert/strict";
import test from "node:test";
import { selectInstalledRuntime, type RuntimeAvailability } from "./runtimeAvailability.js";

const runtimes: RuntimeAvailability[] = [
  { id: "codex", label: "Codex", installed: true },
  { id: "opencode", label: "OpenCode", installed: true },
  { id: "claude", label: "Claude Code", installed: false },
];

test("runtime selection keeps an installed choice", () => {
  assert.equal(selectInstalledRuntime("opencode", runtimes), "opencode");
});

test("runtime selection falls back to the first installed runtime", () => {
  assert.equal(selectInstalledRuntime("claude", runtimes), "codex");
  assert.equal(selectInstalledRuntime("", runtimes), "codex");
});

test("runtime selection is empty when none are installed", () => {
  assert.equal(selectInstalledRuntime("", [{ id: "claude", label: "Claude Code", installed: false }]), "");
});
