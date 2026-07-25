import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { commandBelongsToRoot } from "../scripts/cross-platform-process.mjs";

const packageJson = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

test("shared development lifecycle commands do not require a platform shell", () => {
  for (const name of ["stop", "wt:add", "wt:rm", "dev:e2e:up", "dev:e2e:down"]) {
    const command = packageJson.scripts[name];
    assert.match(command, /^node scripts\/[a-z0-9-]+\.mjs$/);
    assert.doesNotMatch(command, /\b(?:bash|pkill|lsof|powershell)\b/i);
  }
});

test("development stop matching does not include sibling repositories with the same prefix", () => {
  const root = path.resolve("D:/work/repo");
  assert.equal(commandBelongsToRoot(`node "${root}/src/server/index.ts"`, root, "win32"), true);
  assert.equal(commandBelongsToRoot(`node "${root}-copy/src/server/index.ts"`, root, "win32"), false);
  assert.equal(commandBelongsToRoot('node "/work/Repo/src/server/index.ts"', "/work/Repo", "linux"), true);
  assert.equal(commandBelongsToRoot('node "/work/repo/src/server/index.ts"', "/work/Repo", "linux"), false);
});
