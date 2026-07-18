import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeModuleDependencies } from "../scripts/p-a9/module-dependency-guard.mjs";

test("module dependency guard rejects a new domain to transport import", () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-space-dependency-guard-"));
  try {
    mkdirSync(path.join(root, "src", "messages"), { recursive: true });
    mkdirSync(path.join(root, "src", "server"), { recursive: true });
    writeFileSync(path.join(root, "src", "messages", "posting.ts"), 'import { send } from "../server/core.js";\n');
    writeFileSync(path.join(root, "src", "server", "core.ts"), "export const send = () => {};\n");

    const result = analyzeModuleDependencies(root);
    assert.deepEqual(result.violations, [{
      from: "src/messages/posting.ts",
      specifier: "../server/core.js",
      to: "src/server/core.ts",
    }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("current domain dependencies contain no transport imports", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const result = analyzeModuleDependencies(root);

  assert.deepEqual(result.violations, []);
});
