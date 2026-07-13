import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listHostDirectories } from "./hostDirectoryBrowser.js";

test("host directory browser lists directories only and exposes safe navigation metadata", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-space-host-directories-"));
  try {
    mkdirSync(path.join(root, "Beta"));
    mkdirSync(path.join(root, "alpha"));
    writeFileSync(path.join(root, "notes.txt"), "not a directory");

    const result = await listHostDirectories(root);

    assert.equal(result.path, path.resolve(root));
    assert.equal(result.parentPath, path.dirname(path.resolve(root)));
    assert.deepEqual(result.entries.map((entry) => entry.name), ["alpha", "Beta"]);
    assert.ok(result.entries.every((entry) => path.isAbsolute(entry.path)));
    assert.ok(result.roots.length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("host directory browser rejects relative and non-directory paths", async () => {
  await assert.rejects(() => listHostDirectories("relative/path"), /absolute/i);

  const root = mkdtempSync(path.join(os.tmpdir(), "kith-space-host-directories-"));
  try {
    const file = path.join(root, "file.txt");
    writeFileSync(file, "file");
    await assert.rejects(() => listHostDirectories(file), /directory/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
