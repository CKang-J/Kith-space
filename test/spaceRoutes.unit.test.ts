import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("canonical /api/spaces uses app.db for list, create, update, remove, and unread summary", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-space-routes-"));
  const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
  try {
    const result = spawnSync(process.execPath, [tsxCli, "test/cases/spaceRoutes.case.ts"], {
      cwd: path.resolve(fileURLToPath(new URL("..", import.meta.url))),
      env: {
        ...process.env,
        KITH_SPACE_DESKTOP_TOKEN: "kith-space-route-case-desktop-token",
        KITH_SPACE_WORKER_TOKEN: "kith-space-route-case-worker-token",
        KITH_SPACE_HOME: path.join(root, "app-home"),
        KITH_SPACE_ROUTE_CASE_ROOT: root,
      },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
