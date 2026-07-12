import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("Space catalog marks Home and only opens ready roots", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-space-open-routes-"));
  const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
  try {
    const result = spawnSync(process.execPath, [tsxCli, "test/cases/spaceOpenRoutes.case.ts"], {
      cwd: path.resolve(fileURLToPath(new URL("..", import.meta.url))),
      env: {
        ...process.env,
        KITH_SPACE_HOME: path.join(root, "app-home"),
        KITH_SPACE_SPACES_DIR: path.join(root, "default-spaces"),
        KITH_SPACE_OPEN_ROUTE_CASE_ROOT: root,
      },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
