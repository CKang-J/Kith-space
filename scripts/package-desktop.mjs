import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const electronVersion = packageJson.devDependencies?.electron;
const [mode, ...unexpected] = process.argv.slice(2);
if (unexpected.length) {
  console.error(`unexpected package arguments: ${unexpected.join(" ")}`);
  process.exit(2);
}
const builderArgs = mode === "--dir"
  ? ["exec", "electron-builder", "--dir", "--win", "--x64"]
  : mode === "--nsis"
    ? ["exec", "electron-builder", "--win", "nsis", "--x64"]
    : null;

if (!builderArgs) {
  console.error("usage: node scripts/package-desktop.mjs --dir|--nsis");
  process.exit(2);
}
if (typeof electronVersion !== "string" || !electronVersion) {
  console.error("package.json devDependencies.electron is required for Desktop packaging");
  process.exit(2);
}

function run(args) {
  const result = spawnSync(pnpm, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const bundleStatus = run(["run", "desktop:bundle"]);
if (bundleStatus !== 0) process.exit(bundleStatus);

let builderStatus = 1;
let electronRebuildStatus = 1;
let rebuildStatus = 1;
try {
  // electron-builder's automatic scan does not force-rebuild pnpm's physical store entry.
  // Build the native module explicitly so the copied Desktop artifact has Electron's ABI.
  electronRebuildStatus = run([
    "exec",
    "electron-rebuild",
    "--version",
    electronVersion,
    "--module-dir",
    ".",
    "--which-module",
    "better-sqlite3",
    "--force",
    "--arch",
    "x64",
  ]);
  if (electronRebuildStatus === 0) builderStatus = run(builderArgs);
} finally {
  // Restore the developer/test Node ABI even when native rebuild or packaging fails midway.
  rebuildStatus = run(["rebuild", "better-sqlite3"]);
}

process.exit(
  electronRebuildStatus !== 0
    ? electronRebuildStatus
    : builderStatus !== 0
      ? builderStatus
      : rebuildStatus,
);
