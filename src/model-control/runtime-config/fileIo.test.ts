import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  asNumber,
  asRecord,
  asString,
  backupFile,
  readJsonFile,
  readTextFile,
  writeFileAtomic,
} from "./fileIo.js";
import { makeTempDir, writeFixture } from "./testSupport.js";

test("readTextFile: not_found for missing file", async () => {
  const { dir, cleanup } = makeTempDir("kith-fileio-notfound-");
  try {
    const result = await readTextFile(path.join(dir, "absent.txt"));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.issue.kind, "not_found");
  } finally {
    cleanup();
  }
});

test("readJsonFile: parse_error for invalid JSON, not a throw", async () => {
  const { dir, cleanup } = makeTempDir("kith-fileio-parseerr-");
  try {
    const target = path.join(dir, "bad.json");
    await writeFixture(target, "{ not valid json");
    const result = await readJsonFile(target);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.issue.kind, "parse_error");
  } finally {
    cleanup();
  }
});

test("readTextFile: not_found when target is a directory, not a file", async () => {
  const { dir, cleanup } = makeTempDir("kith-fileio-isdir-");
  try {
    const subdir = path.join(dir, "iamadir");
    await fs.mkdir(subdir);
    const result = await readTextFile(subdir);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.issue.kind, "not_found");
  } finally {
    cleanup();
  }
});

test("writeFileAtomic: creates a new file with fallbackMode when none exists", async () => {
  const { dir, cleanup } = makeTempDir("kith-fileio-create-");
  try {
    const target = path.join(dir, "new.json");
    await writeFileAtomic(target, "{}\n", 0o600);
    const stat = await fs.stat(target);
    assert.equal(stat.mode & 0o777, 0o600);
    assert.equal(await fs.readFile(target, "utf-8"), "{}\n");
  } finally {
    cleanup();
  }
});

test("writeFileAtomic: preserves existing file permissions instead of falling back to default mode", async () => {
  const { dir, cleanup } = makeTempDir("kith-fileio-permpreserve-");
  try {
    const target = path.join(dir, "secret.json");
    await writeFixture(target, JSON.stringify({ old: true }));
    await fs.chmod(target, 0o644);

    // fallbackMode passed here is 0o600, but since the file already exists with 0o644,
    // the writer must preserve 0o644, not silently tighten or loosen it.
    await writeFileAtomic(target, JSON.stringify({ new: true }), 0o600);

    const stat = await fs.stat(target);
    assert.equal(stat.mode & 0o777, 0o644);
    assert.deepEqual(JSON.parse(await fs.readFile(target, "utf-8")), { new: true });
  } finally {
    cleanup();
  }
});

test("writeFileAtomic: leaves the target unmodified when the write is interrupted (no partial file)", async () => {
  const { dir, cleanup } = makeTempDir("kith-fileio-atomic-");
  try {
    const target = path.join(dir, "settings.json");
    await writeFixture(target, JSON.stringify({ original: true }));

    await writeFileAtomic(target, JSON.stringify({ updated: true }));

    // No leftover .tmp-* files after a successful write.
    const entries = await fs.readdir(dir);
    const tmpFiles = entries.filter((name) => name.includes(".tmp-"));
    assert.deepEqual(tmpFiles, []);
    assert.deepEqual(JSON.parse(await fs.readFile(target, "utf-8")), { updated: true });
  } finally {
    cleanup();
  }
});

test("backupFile: creates a timestamped .bak copy with identical content when target exists", async () => {
  const { dir, cleanup } = makeTempDir("kith-fileio-backup-");
  try {
    const target = path.join(dir, "settings.json");
    const original = JSON.stringify({ hello: "world" });
    await writeFixture(target, original);

    const backupPath = await backupFile(target);

    assert.ok(backupPath);
    assert.match(backupPath!, /\.bak-/);
    assert.equal(await fs.readFile(backupPath!, "utf-8"), original);
  } finally {
    cleanup();
  }
});

test("backupFile: returns undefined when target does not exist (nothing to back up)", async () => {
  const { dir, cleanup } = makeTempDir("kith-fileio-backup-missing-");
  try {
    const result = await backupFile(path.join(dir, "absent.json"));
    assert.equal(result, undefined);
  } finally {
    cleanup();
  }
});

test("writeFileAtomic: automatically backs up the previous version before overwriting", async () => {
  const { dir, cleanup } = makeTempDir("kith-fileio-autobackup-");
  try {
    const target = path.join(dir, "settings.json");
    await writeFixture(target, JSON.stringify({ version: 1 }));

    await writeFileAtomic(target, JSON.stringify({ version: 2 }));

    const entries = await fs.readdir(dir);
    const backups = entries.filter((name) => name.includes(".bak-"));
    assert.equal(backups.length, 1);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, backups[0]!), "utf-8")), { version: 1 });
  } finally {
    cleanup();
  }
});

test("asRecord: returns {} for arrays, null, primitives; passes through plain objects", () => {
  assert.deepEqual(asRecord(null), {});
  assert.deepEqual(asRecord(undefined), {});
  assert.deepEqual(asRecord([1, 2, 3]), {});
  assert.deepEqual(asRecord("string"), {});
  assert.deepEqual(asRecord({ a: 1 }), { a: 1 });
});

test("asString: rejects empty/whitespace-only strings and non-strings", () => {
  assert.equal(asString("hello"), "hello");
  assert.equal(asString(""), undefined);
  assert.equal(asString("   "), undefined);
  assert.equal(asString(42), undefined);
  assert.equal(asString(null), undefined);
});

test("asNumber: accepts numeric strings and numbers, rejects NaN/non-numeric", () => {
  assert.equal(asNumber(42), 42);
  assert.equal(asNumber("200000"), 200000);
  assert.equal(asNumber("not a number"), undefined);
  assert.equal(asNumber(Number.NaN), undefined);
  assert.equal(asNumber(undefined), undefined);
});
