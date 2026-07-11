import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

test("task persistence rollback, concurrency, transitions, and delivery linkage", () => {
  assert.ok(process.env.KITH_SPACE_HOME, "KITH_SPACE_HOME must point to the test runner's temporary directory");
  const home = path.join(process.env.KITH_SPACE_HOME, `task-module-${randomUUID()}`);
  mkdirSync(home, { recursive: true });
  const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
  const cases = fileURLToPath(new URL("./taskModule.cases.ts", import.meta.url));
  const result = spawnSync(process.execPath, [tsxCli, "--test", "--test-force-exit", cases], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    encoding: "utf8",
    env: {
      ...process.env,
      KITH_SPACE_HOME: home,
      KITH_SPACE_DESKTOP_TOKEN: process.env.KITH_SPACE_DESKTOP_TOKEN ?? "kith-space-task-module-desktop",
      KITH_SPACE_WORKER_TOKEN: process.env.KITH_SPACE_WORKER_TOKEN ?? "kith-space-task-module-worker",
    },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
