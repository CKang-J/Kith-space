import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("Space root API creates, attaches, relocates, rejects conflicts, and degrades missing roots", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-space-root-routes-"));
  const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
  try {
    const result = spawnSync(process.execPath, [tsxCli, "test/cases/spaceRootRoutes.case.ts"], {
      cwd: path.resolve(fileURLToPath(new URL("..", import.meta.url))),
      env: {
        ...process.env,
        KITH_SPACE_DESKTOP_TOKEN: "kith-space-root-route-desktop-token",
        KITH_SPACE_WORKER_TOKEN: "kith-space-root-route-worker-token",
        KITH_SPACE_HOME: path.join(root, "app-home"),
        KITH_SPACE_SPACES_DIR: path.join(root, "default-spaces"),
        KITH_SPACE_ROOT_ROUTE_CASE_ROOT: root,
      },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
