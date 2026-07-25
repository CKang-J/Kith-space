import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("..", import.meta.url));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const packageJson = JSON.parse(readFileSync(path.join(sourceRoot, "package.json"), "utf8"));
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

function run(args, cwd = sourceRoot) {
  const result = spawnSync(pnpm, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY ?? "false" },
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function copyIntoStaging(stagingRoot, relativePath) {
  const source = path.join(sourceRoot, relativePath);
  if (!existsSync(source)) throw new Error(`Desktop packaging input is missing: ${relativePath}`);
  const target = path.join(stagingRoot, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

const bundleStatus = run(["run", "desktop:bundle"]);
if (bundleStatus !== 0) process.exit(bundleStatus);

const stagingRoot = mkdtempSync(path.join(tmpdir(), "kith-desktop-package-"));
let status = 1;
try {
  for (const relativePath of [
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "web/package.json",
    "web/public/favicon.ico",
    "desktop/dist",
    "web/dist",
    "drizzle",
    "LICENSE",
    "NOTICE",
    "THIRD_PARTY_LICENSES.md",
  ]) {
    copyIntoStaging(stagingRoot, relativePath);
  }
  const stagedPackage = {
    ...packageJson,
    build: {
      ...packageJson.build,
      directories: {
        ...packageJson.build?.directories,
        output: path.join(sourceRoot, "dist", "desktop"),
      },
    },
  };
  writeFileSync(path.join(stagingRoot, "package.json"), `${JSON.stringify(stagedPackage, null, 2)}\n`);

  const installStatus = run([
    "install",
    "--frozen-lockfile",
    "--prefer-offline",
    "--package-import-method=copy",
  ], stagingRoot);
  if (installStatus !== 0) {
    status = installStatus;
  } else {
    const rebuildStatus = run([
      "exec",
      "electron-rebuild",
      "--version",
      electronVersion,
      "--module-dir",
      stagingRoot,
      "--which-module",
      "better-sqlite3",
      "--force",
      "--arch",
      "x64",
    ], stagingRoot);
    status = rebuildStatus === 0
      ? run([...builderArgs, "--projectDir", stagingRoot], stagingRoot)
      : rebuildStatus;
  }
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}

process.exit(status);
