import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const composer = readFileSync(new URL("./Composer.tsx", import.meta.url), "utf8");
const actions = readFileSync(new URL("./composer/ComposerActions.tsx", import.meta.url), "utf8");

test("Composer sends an explicit per-message memory policy and resets the exclusion after success", () => {
  assert.match(composer, /memoryPolicy:\s*memoryExcluded\s*\?\s*"exclude"\s*:\s*"eligible"/);
  assert.match(composer, /setMemoryExcluded\(false\)/);
  assert.match(actions, /excludeFromMemoryDescription/);
  assert.match(actions, /aria-checked=\{memoryExcluded\}/);
});
