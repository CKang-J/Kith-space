import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { closeAppDatabase } from "../src/app-data/appDatabase.ts";
import {
  AccessTokenService,
  BrowserAccessPolicy,
  BrowserSessionService,
} from "../src/browser-access/index.ts";
import { appDbFile } from "../src/paths.ts";

let sandboxRoot = "";
let previousKithSpaceHome: string | undefined;

test.beforeEach(() => {
  closeAppDatabase();
  previousKithSpaceHome = process.env.KITH_SPACE_HOME;
  sandboxRoot = mkdtempSync(path.join(os.tmpdir(), "kith-space-browser-access-"));
  process.env.KITH_SPACE_HOME = path.join(sandboxRoot, "app-home");
});

test.afterEach(() => {
  try {
    closeAppDatabase();
  } finally {
    if (previousKithSpaceHome === undefined) delete process.env.KITH_SPACE_HOME;
    else process.env.KITH_SPACE_HOME = previousKithSpaceHome;
    rmSync(sandboxRoot, { recursive: true, force: true });
  }
});

test("browser access defaults to disabled loopback on port 7777", () => {
  const policy = new BrowserAccessPolicy();

  assert.deepEqual(policy.getSettings(), {
    mode: "off",
    port: 7777,
    hasAccessToken: false,
    tokenRevision: 0,
  });
  assert.deepEqual(policy.getListenerPolicy(), {
    browserEnabled: false,
    host: "127.0.0.1",
    port: 7777,
  });
});

test("browser access policy persists settings and maps listener hosts", () => {
  const policy = new BrowserAccessPolicy();

  assert.deepEqual(policy.updateSettings({ mode: "local", port: 8123 }), {
    mode: "local",
    port: 8123,
    hasAccessToken: false,
    tokenRevision: 0,
  });
  assert.deepEqual(policy.getListenerPolicy(), {
    browserEnabled: true,
    host: "127.0.0.1",
    port: 8123,
  });

  closeAppDatabase();
  assert.deepEqual(new BrowserAccessPolicy().getSettings(), {
    mode: "local",
    port: 8123,
    hasAccessToken: false,
    tokenRevision: 0,
  });

  policy.updateSettings({ mode: "lan" });
  assert.deepEqual(policy.getListenerPolicy(), {
    browserEnabled: true,
    host: "0.0.0.0",
    port: 8123,
  });
});

test("browser access policy rejects invalid modes and ports", () => {
  const policy = new BrowserAccessPolicy();

  assert.throws(() => policy.updateSettings({ mode: "public" as never }), /mode/i);
  for (const port of [0, 65536, 7777.5, Number.NaN, "7777" as never]) {
    assert.throws(() => policy.updateSettings({ port }), /port/i);
  }
  assert.deepEqual(policy.getSettings(), {
    mode: "off",
    port: 7777,
    hasAccessToken: false,
    tokenRevision: 0,
  });
});

test("access tokens can be generated or user-specified without storing plaintext", async () => {
  const tokens = new AccessTokenService();
  const generated = await tokens.rotate("   ");

  assert.match(generated.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(generated.revision, 1);
  assert.equal(await tokens.verify(generated.token), 1);
  assert.equal(await tokens.verify("wrong-token"), null);

  const customToken = "this-is-a-private-browser-token";
  const custom = await tokens.rotate(customToken);
  assert.equal(custom.token, customToken);
  assert.equal(custom.revision, 2);
  assert.equal(await tokens.verify(customToken), 2);
  assert.equal(await tokens.verify(generated.token), null);

  await assert.rejects(() => tokens.rotate("too-short"), /16.*256/i);
  await assert.rejects(() => tokens.rotate("x".repeat(257)), /16.*256/i);

  closeAppDatabase();
  const sqlite = new Database(appDbFile(), { readonly: true });
  try {
    const row = sqlite.prepare(`
      SELECT access_token_hash, token_revision FROM browser_access_settings WHERE singleton_key = 1
    `).get() as { access_token_hash: string; token_revision: number };
    assert.match(row.access_token_hash, /^scrypt\$/);
    assert.doesNotMatch(row.access_token_hash, new RegExp(customToken));
    assert.equal(row.token_revision, 2);
  } finally {
    sqlite.close();
  }
});

test("browser sessions require the access token and persist only a SHA-256 token hash", async () => {
  const tokens = new AccessTokenService();
  const sessions = new BrowserSessionService(tokens);
  const access = await tokens.rotate("this-is-the-access-token");

  assert.equal(await sessions.create("wrong-token"), undefined);
  const created = await sessions.create(access.token);
  assert.ok(created);
  assert.match(created.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(sessions.count(), 1);
  assert.ok(sessions.authenticate(created.token));
  assert.equal(sessions.authenticate("wrong-session"), undefined);
  assert.equal(sessions.touch(created.token), true);

  closeAppDatabase();
  const sqlite = new Database(appDbFile(), { readonly: true });
  try {
    const row = sqlite.prepare(`
      SELECT token_hash, token_revision, created_at, last_seen_at FROM browser_sessions
    `).get() as {
      token_hash: string;
      token_revision: number;
      created_at: number;
      last_seen_at: number;
    };
    assert.equal(row.token_hash, createHash("sha256").update(created.token).digest("hex"));
    assert.notEqual(row.token_hash, created.token);
    assert.equal(row.token_revision, access.revision);
    assert.ok(row.last_seen_at >= row.created_at);
  } finally {
    sqlite.close();
  }
});

test("browser sessions survive database reopen and support single or bulk revocation", async () => {
  const tokens = new AccessTokenService();
  const sessions = new BrowserSessionService(tokens);
  const access = await tokens.rotate("this-is-the-access-token");
  const first = await sessions.create(access.token);
  const second = await sessions.create(access.token);
  assert.ok(first);
  assert.ok(second);

  closeAppDatabase();
  const reopenedTokens = new AccessTokenService();
  const reopenedSessions = new BrowserSessionService(reopenedTokens);
  assert.equal(await reopenedTokens.verify(access.token), access.revision);
  assert.ok(reopenedSessions.authenticate(first.token));
  assert.equal(reopenedSessions.count(), 2);

  assert.equal(reopenedSessions.revoke(first.token), true);
  assert.equal(reopenedSessions.revoke(first.token), false);
  assert.equal(reopenedSessions.authenticate(first.token), undefined);
  assert.ok(reopenedSessions.authenticate(second.token));
  assert.equal(reopenedSessions.revokeAll(), 1);
  assert.equal(reopenedSessions.count(), 0);
});

test("rotating the access token invalidates every existing browser session", async () => {
  const tokens = new AccessTokenService();
  const sessions = new BrowserSessionService(tokens);
  const oldAccess = await tokens.rotate("this-is-the-old-access-token");
  const first = await sessions.create(oldAccess.token);
  const second = await sessions.create(oldAccess.token);
  assert.ok(first);
  assert.ok(second);
  assert.equal(sessions.count(), 2);

  const nextAccess = await tokens.rotate("this-is-the-new-access-token");

  assert.equal(nextAccess.revision, oldAccess.revision + 1);
  assert.equal(await tokens.verify(oldAccess.token), null);
  assert.equal(await tokens.verify(nextAccess.token), nextAccess.revision);
  assert.equal(sessions.authenticate(first.token), undefined);
  assert.equal(sessions.authenticate(second.token), undefined);
  assert.equal(sessions.count(), 0);
});
