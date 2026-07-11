import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
const envModule = pathToFileURL(path.resolve("src/env.ts")).href;
const viteConfig = path.resolve("web/vite.config.ts");

function probe(managed: boolean): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kith-space-desktop-env-"));
  try {
    writeFileSync(path.join(dir, ".env"), "KITH_DESKTOP_ENV_PROBE=loaded\n", "utf8");
    const script = path.join(dir, "probe.mts");
    writeFileSync(script, `await import(${JSON.stringify(envModule)}); process.stdout.write(process.env.KITH_DESKTOP_ENV_PROBE ?? "missing");\n`, "utf8");
    const env = { ...process.env };
    delete env.KITH_DESKTOP_ENV_PROBE;
    if (managed) env.KITH_SPACE_DESKTOP_MANAGED = "1";
    else delete env.KITH_SPACE_DESKTOP_MANAGED;
    const result = spawnSync(process.execPath, [tsxCli, script], { cwd: dir, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("split-process development still loads .env", () => {
  assert.equal(probe(false), "loaded");
});

test("Desktop-managed children ignore repository .env files", () => {
  assert.equal(probe(true), "missing");
});

test("Desktop-managed Vite cannot reload credentials from the repository environment", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(viteConfig, "utf8"));
  assert.match(source, /KITH_SPACE_DESKTOP_MANAGED !== "1"/);
  assert.match(source, /loadEnvFile\?\.\("\.\.\/\.env"\)/);
});
