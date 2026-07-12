import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import Database from "better-sqlite3";
import {
  closeAllDatabases,
  closeSpaceDb,
  dbForSpace,
  registerSpace,
  schema,
  unregisterSpace,
} from "../../src/db/index.ts";
import { ensurePersonalApp } from "../../src/db/personalApp.ts";
import { getSpaceRecord } from "../../src/app-data/appDatabase.ts";
import { workspaceDbFile } from "../../src/paths.ts";
import { handleSpacesHumanScope } from "../../src/server/routes-api/spaces.ts";

type CapturedResponse = { status: number; body: any };

function responseCapture(): { response: CapturedResponse; res: any } {
  const response: CapturedResponse = { status: 0, body: undefined };
  return {
    response,
    res: {
      writeHead(status: number) { response.status = status; },
      end(body?: string) { response.body = body ? JSON.parse(body) : undefined; },
    },
  };
}

function jsonRequest(body?: unknown): any {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as any;
  req.headers = {};
  req.socket = { remoteAddress: "127.0.0.1" };
  return req;
}

async function request(method: string, pathname: string, humanId: string, body?: unknown) {
  const capture = responseCapture();
  const handled = await handleSpacesHumanScope({
    req: jsonRequest(body),
    res: capture.res,
    url: new URL(`http://localhost${pathname}`),
    method,
    p: pathname,
    humanId,
  });
  return { handled, ...capture.response };
}

function createDetachedSpace(rootPath: string, id: string, name: string, slug: string): void {
  registerSpace({ id, name, slug, rootPath });
  dbForSpace(id);
  closeSpaceDb(id);
  unregisterSpace(id);
}

const root = process.env.KITH_SPACE_ROOT_ROUTE_CASE_ROOT;
assert.ok(root, "KITH_SPACE_ROOT_ROUTE_CASE_ROOT is required");

try {
  const { human } = await ensurePersonalApp({ name: "Ada", homeRootPath: path.join(root, "home") });

  const defaultCreated = await request("POST", "/api/spaces", human.id, { name: "Default Notes" });
  assert.equal(defaultCreated.status, 201);
  assert.equal(defaultCreated.body.status, "ready");
  assert.equal(defaultCreated.body.rootError, undefined);
  assert.equal(defaultCreated.body.rootPath, path.join(root, "default-spaces", "default-notes"));

  mkdirSync(path.join(root, "default-spaces", "blocked-default"), { recursive: true });
  const blockedDefault = await request("POST", "/api/spaces", human.id, { name: "Blocked Default" });
  assert.equal(blockedDefault.status, 409);
  assert.equal(blockedDefault.body.code, "SPACE_ROOT_ATTACH_REQUIRED");

  const ordinaryRoot = path.join(root, "ordinary-project");
  mkdirSync(ordinaryRoot, { recursive: true });
  writeFileSync(path.join(ordinaryRoot, "README.md"), "keep me", "utf8");
  const ordinaryAttached = await request("POST", "/api/spaces", human.id, {
    name: "Ordinary Project",
    rootPath: ordinaryRoot,
  });
  assert.equal(ordinaryAttached.status, 201);
  assert.equal(ordinaryAttached.body.status, "ready");
  assert.equal(ordinaryAttached.body.rootPath, ordinaryRoot);
  assert.equal(existsSync(path.join(ordinaryRoot, "README.md")), true);

  const attachWithoutPath = await request("POST", "/api/spaces", human.id, {
    name: "Missing attach path",
    mode: "attach",
  });
  assert.equal(attachWithoutPath.status, 400);
  assert.equal(attachWithoutPath.body.code, "SPACE_ROOT_PATH_REQUIRED");

  const fileRoot = path.join(root, "not-a-directory.txt");
  writeFileSync(fileRoot, "file", "utf8");
  const nonDirectory = await request("POST", "/api/spaces", human.id, {
    name: "Not a directory",
    rootPath: fileRoot,
  });
  assert.equal(nonDirectory.status, 400);
  assert.equal(nonDirectory.body.code, "SPACE_ROOT_NOT_DIRECTORY");

  const emptyKithRoot = path.join(root, "empty-kith");
  mkdirSync(path.join(emptyKithRoot, ".kith"), { recursive: true });
  const emptyKith = await request("POST", "/api/spaces", human.id, {
    name: "Empty Kith",
    rootPath: emptyKithRoot,
  });
  assert.equal(emptyKith.status, 400);
  assert.equal(emptyKith.body.code, "SPACE_ROOT_DB_MISSING");

  const linkedKithTarget = path.join(root, "linked-kith-target");
  const linkedKithRoot = path.join(root, "linked-kith-root");
  mkdirSync(linkedKithTarget, { recursive: true });
  mkdirSync(linkedKithRoot, { recursive: true });
  symlinkSync(linkedKithTarget, path.join(linkedKithRoot, ".kith"), "junction");
  const linkedKith = await request("POST", "/api/spaces", human.id, {
    name: "Linked Kith",
    rootPath: linkedKithRoot,
  });
  assert.equal(linkedKith.status, 400);
  assert.equal(linkedKith.body.code, "SPACE_ROOT_SYMLINK_UNSUPPORTED");

  const linkedDbTarget = path.join(root, "linked-db-target");
  const linkedDbRoot = path.join(root, "linked-db-root");
  mkdirSync(linkedDbTarget, { recursive: true });
  mkdirSync(path.join(linkedDbRoot, ".kith"), { recursive: true });
  symlinkSync(linkedDbTarget, workspaceDbFile(linkedDbRoot), "junction");
  const linkedDb = await request("POST", "/api/spaces", human.id, {
    name: "Linked DB",
    rootPath: linkedDbRoot,
  });
  assert.equal(linkedDb.status, 400);
  assert.equal(linkedDb.body.code, "SPACE_ROOT_SYMLINK_UNSUPPORTED");

  const existingRoot = path.join(root, "existing-source");
  const existingId = "space-existing-stable-id";
  createDetachedSpace(existingRoot, existingId, "Existing Space", "existing-space");
  const sameSlugRoot = path.join(root, "same-slug-source");
  const sameSlugId = "space-same-slug-stable-id";
  createDetachedSpace(sameSlugRoot, sameSlugId, "Same Slug Space", "existing-space");
  const existingAttached = await request("POST", "/api/spaces", human.id, {
    name: "Existing Space",
    rootPath: existingRoot,
  });
  assert.equal(existingAttached.status, 201);
  assert.equal(existingAttached.body.id, existingId);
  assert.equal(existingAttached.body.status, "ready");

  const sameSlugAttached = await request("POST", "/api/spaces", human.id, {
    rootPath: sameSlugRoot,
  });
  assert.equal(sameSlugAttached.status, 201);
  assert.equal(sameSlugAttached.body.id, sameSlugId);
  assert.equal(sameSlugAttached.body.slug, "existing-space-2");

  const duplicatePath = await request("POST", "/api/spaces", human.id, {
    name: "Duplicate path",
    rootPath: existingRoot,
  });
  assert.equal(duplicatePath.status, 409);
  assert.equal(duplicatePath.body.code, "SPACE_ROOT_ALREADY_REGISTERED");

  const duplicateIdRoot = path.join(root, "duplicate-id");
  mkdirSync(path.join(duplicateIdRoot, ".kith"), { recursive: true });
  dbForSpace(existingId).$client.pragma("wal_checkpoint(TRUNCATE)");
  copyFileSync(workspaceDbFile(existingRoot), workspaceDbFile(duplicateIdRoot));
  const duplicateId = await request("POST", "/api/spaces", human.id, {
    name: "Duplicate identity",
    rootPath: duplicateIdRoot,
  });
  assert.equal(duplicateId.status, 409);
  assert.equal(duplicateId.body.code, "SPACE_ID_ALREADY_REGISTERED");

  const corruptRoot = path.join(root, "corrupt-space");
  mkdirSync(path.join(corruptRoot, ".kith"), { recursive: true });
  writeFileSync(workspaceDbFile(corruptRoot), "not a sqlite database", "utf8");
  const corrupt = await request("POST", "/api/spaces", human.id, {
    name: "Corrupt",
    rootPath: corruptRoot,
  });
  assert.equal(corrupt.status, 400);
  assert.equal(corrupt.body.code, "SPACE_ROOT_DB_INVALID");

  const incompatibleRoot = path.join(root, "incompatible-space");
  mkdirSync(path.join(incompatibleRoot, ".kith"), { recursive: true });
  copyFileSync(workspaceDbFile(existingRoot), workspaceDbFile(incompatibleRoot));
  const incompatibleSqlite = new Database(workspaceDbFile(incompatibleRoot));
  incompatibleSqlite.pragma("user_version = 999");
  incompatibleSqlite.close();
  const incompatible = await request("POST", "/api/spaces", human.id, {
    name: "Incompatible",
    rootPath: incompatibleRoot,
  });
  assert.equal(incompatible.status, 400);
  assert.equal(incompatible.body.code, "SPACE_ROOT_DB_INCOMPATIBLE");

  const malformedRoot = path.join(root, "malformed-space");
  mkdirSync(path.join(malformedRoot, ".kith"), { recursive: true });
  copyFileSync(workspaceDbFile(existingRoot), workspaceDbFile(malformedRoot));
  const malformedSqlite = new Database(workspaceDbFile(malformedRoot));
  malformedSqlite.exec("DROP TABLE agents; CREATE TABLE agents (dummy TEXT)");
  malformedSqlite.close();
  const malformed = await request("POST", "/api/spaces", human.id, {
    name: "Malformed",
    rootPath: malformedRoot,
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.code, "SPACE_ROOT_DB_INCOMPATIBLE");

  const otherRoot = path.join(root, "other-identity");
  createDetachedSpace(otherRoot, "space-other-id", "Other", "other");
  const mismatch = await request(
    "POST",
    `/api/spaces/${existingId}/relocate`,
    human.id,
    { rootPath: otherRoot },
  );
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.code, "SPACE_ID_MISMATCH");
  assert.equal(getSpaceRecord(existingId)?.rootPath, existingRoot);

  const invalidRelocationRoot = path.join(root, "invalid-relocation");
  mkdirSync(path.join(invalidRelocationRoot, ".kith"), { recursive: true });
  dbForSpace(existingId).$client.pragma("wal_checkpoint(TRUNCATE)");
  copyFileSync(workspaceDbFile(existingRoot), workspaceDbFile(invalidRelocationRoot));
  const invalidRelocationSqlite = new Database(workspaceDbFile(invalidRelocationRoot));
  invalidRelocationSqlite.exec("ALTER TABLE agents DROP COLUMN introduced_at; PRAGMA user_version = 2");
  invalidRelocationSqlite.close();
  const invalidRelocation = await request(
    "POST",
    `/api/spaces/${existingId}/relocate`,
    human.id,
    { rootPath: invalidRelocationRoot },
  );
  assert.equal(invalidRelocation.status, 400);
  assert.equal(invalidRelocation.body.code, "SPACE_RELOCATION_FAILED");
  assert.equal(getSpaceRecord(existingId)?.rootPath, existingRoot);
  assert.ok(dbForSpace(existingId), "failed relocation must leave the original registry usable");

  const relocatedRoot = path.join(root, "existing-relocated");
  mkdirSync(path.join(relocatedRoot, ".kith"), { recursive: true });
  dbForSpace(existingId).$client.pragma("wal_checkpoint(TRUNCATE)");
  copyFileSync(workspaceDbFile(existingRoot), workspaceDbFile(relocatedRoot));
  const relocated = await request(
    "POST",
    `/api/spaces/${existingId}/relocate`,
    human.id,
    { rootPath: relocatedRoot },
  );
  assert.equal(relocated.status, 200);
  assert.equal(relocated.body.id, existingId);
  assert.equal(relocated.body.rootPath, relocatedRoot);
  assert.equal(relocated.body.status, "ready");
  assert.equal(getSpaceRecord(existingId)?.rootPath, relocatedRoot);

  closeSpaceDb(existingId);
  const movedAgainRoot = path.join(root, "moved-without-relocation");
  renameSync(relocatedRoot, movedAgainRoot);
  assert.throws(
    () => dbForSpace(existingId),
    (error: any) => error?.code === "SPACE_ROOT_MISSING",
  );
  assert.equal(existsSync(relocatedRoot), false, "opening a missing Space must not recreate its old root");
  const list = await request("GET", "/api/spaces", human.id);
  assert.equal(list.status, 200);
  const missing = list.body.find((space: any) => space.id === existingId);
  assert.equal(missing.status, "missing");
  assert.equal(missing.rootPath, relocatedRoot);
  assert.equal(missing.code, "SPACE_ROOT_MISSING");
  assert.match(missing.rootError, /relocat/i);

  closeSpaceDb(defaultCreated.body.id);
  const defaultDbPath = workspaceDbFile(defaultCreated.body.rootPath);
  renameSync(defaultDbPath, `${defaultDbPath}.backup`);
  assert.throws(
    () => dbForSpace(defaultCreated.body.id),
    (error: any) => error?.code === "SPACE_ROOT_DB_MISSING",
  );
  assert.equal(existsSync(defaultDbPath), false, "opening a Space with a missing database must not recreate it");
  const listWithMissingDb = await request("GET", "/api/spaces", human.id);
  const missingDb = listWithMissingDb.body.find((space: any) => space.id === defaultCreated.body.id);
  assert.equal(missingDb.status, "error");
  assert.equal(missingDb.code, "SPACE_ROOT_DB_MISSING");

  const brokenRegisteredRoot = path.join(root, "broken-registered");
  mkdirSync(path.join(brokenRegisteredRoot, ".kith"), { recursive: true });
  writeFileSync(workspaceDbFile(brokenRegisteredRoot), "broken sqlite", "utf8");
  registerSpace({
    id: "space-broken-registered",
    name: "Broken registered",
    slug: "broken-registered",
    rootPath: brokenRegisteredRoot,
  });
  const listWithBroken = await request("GET", "/api/spaces", human.id);
  assert.equal(listWithBroken.status, 200);
  const broken = listWithBroken.body.find((space: any) => space.id === "space-broken-registered");
  assert.equal(broken.status, "error");
  assert.equal(broken.code, "SPACE_ROOT_DB_INVALID");
  assert.match(broken.rootError, /repair/i);
} finally {
  closeAllDatabases();
}
