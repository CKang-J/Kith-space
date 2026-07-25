import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("CI verifies the shared source and production bundle on all desktop host platforms", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(workflow, /matrix:/);
  for (const runner of ["ubuntu-latest", "windows-latest", "macos-latest"]) {
    assert.match(workflow, new RegExp(runner));
  }
  assert.match(workflow, /pnpm test --unit/);
  assert.match(workflow, /pnpm test --integration/);
  assert.match(workflow, /pnpm run desktop:bundle/);
});

test("unsigned Windows packaging explicitly disables signing credential discovery", () => {
  const workflow = readFileSync(new URL("../.github/workflows/desktop-release.yml", import.meta.url), "utf8");
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY:\s*["']?false["']?/);
});
