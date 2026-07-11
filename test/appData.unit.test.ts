import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeAllDatabases, dbFor, schema } from "../src/db/index.ts";
import { ensurePersonalApp } from "../src/db/personalApp.ts";
import {
  closeAppDatabase,
  getHumanProfile,
  getSpaceRecord,
  getSpaceRecordBySlug,
  initializeHumanProfile,
  listSpaceRecords,
  registerSpace,
  updateHumanProfile,
} from "../src/app-data/appDatabase.ts";
import { appDbFile, workspaceDbFile } from "../src/paths.ts";

let sandboxRoot = "";
let appHome = "";
let previousKithSpaceHome: string | undefined;

test.beforeEach(() => {
  closeAllDatabases();
  closeAppDatabase();
  previousKithSpaceHome = process.env.KITH_SPACE_HOME;
  sandboxRoot = mkdtempSync(path.join(os.tmpdir(), "kith-space-app-data-"));
  appHome = path.join(sandboxRoot, "app-home");
  process.env.KITH_SPACE_HOME = appHome;
});

test.afterEach(() => {
  try {
    closeAllDatabases();
    closeAppDatabase();
  } finally {
    if (previousKithSpaceHome === undefined) delete process.env.KITH_SPACE_HOME;
    else process.env.KITH_SPACE_HOME = previousKithSpaceHome;
    rmSync(sandboxRoot, { recursive: true, force: true });
  }
});

test("appDbFile resolves app.db inside the isolated Kith-space home", () => {
  assert.equal(appDbFile(), path.join(appHome, "app.db"));
});

test("Human initialization requires a trimmed name and permits empty optional profile fields", () => {
  assert.throws(
    () => initializeHumanProfile({ name: "   " }),
    /human name/i,
  );
  assert.equal(getHumanProfile(), undefined);

  const created = initializeHumanProfile({
    name: "  Ada  ",
    email: "",
    description: "   ",
  });

  assert.equal(created.name, "Ada");
  assert.equal(created.email, null);
  assert.equal(created.description, null);
  assert.ok(created.id);
  assert.deepEqual(getHumanProfile(), created);
  assert.throws(
    () => initializeHumanProfile({ name: "Grace" }),
    /human profile already initialized/i,
  );
  assert.deepEqual(getHumanProfile(), created);
});

test("Human profile updates name, email, and description through the singleton API", () => {
  const created = initializeHumanProfile({ name: "Ada" });

  const updated = updateHumanProfile({
    name: "  Ada Lovelace  ",
    email: "ada@example.test",
    description: "Works with the local agent team",
  });

  assert.equal(updated.id, created.id);
  assert.equal(updated.name, "Ada Lovelace");
  assert.equal(updated.email, "ada@example.test");
  assert.equal(updated.description, "Works with the local agent team");
  assert.deepEqual(getHumanProfile(), updated);
});

test("Space registry persists slug, root path, and last-opened time through its public lookups", () => {
  const firstOpenedAt = new Date("2026-07-11T08:00:00.000Z");
  const secondOpenedAt = new Date("2026-07-11T09:00:00.000Z");
  const firstRoot = path.join(sandboxRoot, "spaces", "home");
  const secondRoot = path.join(sandboxRoot, "spaces", "writing");

  const home = registerSpace({
    id: "space-home",
    slug: "home",
    name: "Home",
    rootPath: firstRoot,
    lastOpenedAt: firstOpenedAt,
  });
  const writing = registerSpace({
    id: "space-writing",
    slug: "writing",
    name: "Writing",
    rootPath: secondRoot,
    lastOpenedAt: secondOpenedAt,
  });

  assert.deepEqual(home, {
    id: "space-home",
    slug: "home",
    name: "Home",
    rootPath: firstRoot,
    lastOpenedAt: firstOpenedAt,
  });
  assert.deepEqual(getSpaceRecord("space-home"), home);
  assert.deepEqual(getSpaceRecordBySlug("home"), home);
  assert.deepEqual(getSpaceRecordBySlug("writing"), writing);
  const listed = new Map(listSpaceRecords().map((space) => [space.id, space]));
  assert.equal(listed.size, 2);
  assert.deepEqual(listed.get(home.id), home);
  assert.deepEqual(listed.get(writing.id), writing);
});

test("ensurePersonalApp creates one Human and one initialized Home Space idempotently", async () => {
  const homeRootPath = path.join(sandboxRoot, "spaces", "home");

  await ensurePersonalApp({
    name: "  Ada  ",
    email: "ada@example.test",
    description: "Local Human",
    homeRootPath,
  });

  const firstHuman = getHumanProfile();
  const firstHome = getSpaceRecordBySlug("home");
  assert.ok(firstHuman);
  assert.equal(firstHuman.name, "Ada");
  assert.equal(firstHuman.email, "ada@example.test");
  assert.equal(firstHuman.description, "Local Human");
  assert.ok(firstHome);
  assert.equal(firstHome.slug, "home");
  assert.equal(firstHome.name, "Home");
  assert.equal(firstHome.rootPath, homeRootPath);
  assert.equal(listSpaceRecords().length, 1);
  assert.ok(existsSync(workspaceDbFile(homeRootPath)));

  const homeDb = dbFor(firstHome.id);
  const channelsBefore = await homeDb.select().from(schema.channels);
  assert.deepEqual(channelsBefore.map((channel) => channel.name), ["all"]);

  await ensurePersonalApp({
    name: "  Ada  ",
    email: "ada@example.test",
    description: "Local Human",
    homeRootPath,
  });

  assert.deepEqual(getHumanProfile(), firstHuman);
  assert.deepEqual(getSpaceRecordBySlug("home"), firstHome);
  assert.equal(listSpaceRecords().length, 1);
  const channelsAfter = await dbFor(firstHome.id).select().from(schema.channels);
  assert.deepEqual(channelsAfter.map((channel) => channel.name), ["all"]);
});
