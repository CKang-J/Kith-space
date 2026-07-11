import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("only the canonical app.db Human is authorized", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-human-authority-"));
  const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
  try {
    const result = spawnSync(process.execPath, [tsxCli, "test/cases/humanAuthority.case.ts"], {
      cwd: path.resolve(fileURLToPath(new URL("..", import.meta.url))),
      env: {
        ...process.env,
        KITH_SPACE_HOME: path.join(root, "app-home"),
        KITH_SPACE_HUMAN_AUTHORITY_CASE_ROOT: root,
      },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
