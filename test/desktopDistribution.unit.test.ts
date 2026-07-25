import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const rootFile = (path: string) => new URL(`../${path}`, import.meta.url);
const packageJson = JSON.parse(readFileSync(rootFile("package.json"), "utf8")) as {
  scripts: Record<string, string>;
  build?: { appId?: string; productName?: string; npmRebuild?: boolean; win?: { target?: string[] } };
  devDependencies?: Record<string, string>;
};

test("repository exposes Desktop bundle and Windows installer commands only", () => {
  assert.equal(packageJson.scripts["desktop:bundle"], "pnpm run web:build && node scripts/build-desktop.mjs --production");
  assert.equal(packageJson.scripts["desktop:pack"], "node scripts/package-desktop.mjs --dir");
  assert.equal(packageJson.scripts["desktop:dist"], "node scripts/package-desktop.mjs --nsis");

  for (const retired of [
    "start:prod",
    "daemon:prod",
    "seed:prod",
    "prod:up",
    "prod:down",
    "pkg:daemon:build",
    "docs:build",
    "site:build",
  ]) {
    assert.equal(packageJson.scripts[retired], undefined, `${retired} must not remain executable`);
  }

  assert.equal(packageJson.build?.appId, "space.kith.desktop");
  assert.equal(packageJson.build?.productName, "Kith-space");
  assert.equal(packageJson.build?.npmRebuild, false);
  assert.deepEqual(packageJson.build?.win?.target, ["nsis"]);
  assert.equal(packageJson.devDependencies?.["@electron/rebuild"], "4.2.0");
});

test("Desktop packaging rebuilds native modules in an isolated staging project", () => {
  const script = readFileSync(rootFile("scripts/package-desktop.mjs"), "utf8");
  assert.match(script, /\["exec", "electron-builder", "--dir", "--win", "--x64"\]/);
  assert.match(script, /\["exec", "electron-builder", "--win", "nsis", "--x64"\]/);
  assert.match(script, /mkdtempSync/);
  assert.match(script, /"--projectDir"/);
  assert.match(script, /"web\/public\/favicon\.ico"/);
  assert.match(script, /"--package-import-method=copy"/);
  assert.doesNotMatch(script, /"install",\s*"--prod"/);
  assert.match(script, /electron-rebuild/);
  assert.match(script, /\], stagingRoot\);\s*\n\s*status = rebuildStatus/);
  assert.match(script, /"--which-module",\s*\n\s*"better-sqlite3"/);
  assert.match(script, /"--force"/);
  assert.doesNotMatch(script, /run\(\["rebuild", "better-sqlite3"\]\)/);
});

test("retired server, Docker, public Worker, and docs deployment assets are absent", () => {
  for (const path of [
    ".dockerignore",
    ".env.example",
    ".env.docker.example",
    "Dockerfile",
    "docker-compose.yml",
    "railway.json",
    ".github/workflows/publish-daemon.yml",
    ".github/workflows/docs-deploy.yml",
    "packages/daemon/package.json",
    "packages/daemon/README.md",
    "scripts/build-daemon-pkg.mjs",
    "scripts/docker-entrypoint.sh",
    "scripts/prod-up.sh",
    "scripts/prod-down.sh",
  ]) {
    assert.equal(existsSync(rootFile(path)), false, `${path} must stay removed`);
  }
});
