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

test("Composer accepts marked Canvas crops on the left Chat fly-land", () => {
  assert.match(composer, /data-fly-land=\{`kith-chat:\$\{channelId\}`\}/);
  assert.match(composer, /KITH_COMPOSER_ATTACH_FILE_EVENT/);
  assert.match(composer, /addFilesRef\.current\(\[detail\.file\]\)/);
});
