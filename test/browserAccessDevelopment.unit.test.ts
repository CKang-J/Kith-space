import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeAppDatabase } from "../src/app-data/appDatabase.ts";
import { AccessTokenService, BrowserAccessPolicy } from "../src/browser-access/index.ts";
import { configureDevelopmentBrowserAccess } from "../src/dev/browserAccessConfiguration.ts";

let sandboxRoot = "";
let previousKithSpaceHome: string | undefined;

test.beforeEach(() => {
  closeAppDatabase();
  previousKithSpaceHome = process.env.KITH_SPACE_HOME;
  sandboxRoot = mkdtempSync(path.join(os.tmpdir(), "kith-space-browser-access-dev-"));
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

test("enabling development browser access creates the missing token and persists the listener", async () => {
  const result = await configureDevelopmentBrowserAccess({ mode: "local", port: 8123 });

  assert.match(result.accessToken ?? "", /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(result.settings, {
    mode: "local",
    port: 8123,
    hasAccessToken: true,
    tokenRevision: 1,
  });
  assert.equal(await new AccessTokenService().verify(result.accessToken!), 1);
});

test("reconfiguring an initialized listener keeps the existing token unless rotation is requested", async () => {
  const first = await configureDevelopmentBrowserAccess({ mode: "local" });
  assert.ok(first.accessToken);

  const unchanged = await configureDevelopmentBrowserAccess({ mode: "lan", port: 9001 });
  assert.equal(unchanged.accessToken, undefined);
  assert.equal(unchanged.settings.tokenRevision, 1);
  assert.equal(await new AccessTokenService().verify(first.accessToken), 1);

  const rotated = await configureDevelopmentBrowserAccess({ mode: "lan", rotateToken: true });
  assert.ok(rotated.accessToken);
  assert.notEqual(rotated.accessToken, first.accessToken);
  assert.equal(rotated.settings.tokenRevision, 2);
  assert.equal(await new AccessTokenService().verify(first.accessToken), null);
  assert.equal(await new AccessTokenService().verify(rotated.accessToken), 2);
});

test("an explicitly blank token generates a replacement while a custom token is used verbatim", async () => {
  const generated = await configureDevelopmentBrowserAccess({ mode: "local", accessToken: "" });
  assert.match(generated.accessToken ?? "", /^[A-Za-z0-9_-]{43}$/);

  const customToken = "development-browser-access-token";
  const custom = await configureDevelopmentBrowserAccess({ mode: "local", accessToken: customToken });
  assert.equal(custom.accessToken, customToken);
  assert.equal(custom.settings.tokenRevision, 2);
  assert.equal(await new AccessTokenService().verify(customToken), 2);
});

test("disabled mode does not create a token unless token rotation is explicit", async () => {
  const disabled = await configureDevelopmentBrowserAccess({ mode: "off", port: 7444 });

  assert.equal(disabled.accessToken, undefined);
  assert.deepEqual(disabled.settings, {
    mode: "off",
    port: 7444,
    hasAccessToken: false,
    tokenRevision: 0,
  });
  assert.deepEqual(new BrowserAccessPolicy().getListenerPolicy(), {
    browserEnabled: false,
    host: "127.0.0.1",
    port: 7444,
  });
});

test("development command emits a rotated token once on stdout and keeps status on stderr", () => {
  const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
  const entry = path.resolve("src/dev/browserAccess.ts");
  const env = { ...process.env, KITH_SPACE_HOME: process.env.KITH_SPACE_HOME! };
  const first = spawnSync(
    process.execPath,
    [tsxCli, entry, "local", "--port", "8124", "--rotate-token"],
    { cwd: path.resolve("."), env, encoding: "utf8" },
  );

  assert.equal(first.status, 0, first.stderr);
  const token = first.stdout.trim();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(first.stderr, /mode=local listener=127\.0\.0\.1:8124/);
  assert.doesNotMatch(first.stderr, new RegExp(token));

  const second = spawnSync(
    process.execPath,
    [tsxCli, entry, "local", "--port", "8124"],
    { cwd: path.resolve("."), env, encoding: "utf8" },
  );
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout, "");

  const custom = spawnSync(
    process.execPath,
    [tsxCli, entry, "local", "--token", "development-browser-access-token"],
    { cwd: path.resolve("."), env, encoding: "utf8" },
  );
  assert.equal(custom.status, 0, custom.stderr);
  assert.equal(custom.stdout, "");
  assert.doesNotMatch(custom.stderr, /development-browser-access-token/);

  const blank = spawnSync(
    process.execPath,
    [tsxCli, entry, "local", "--token", ""],
    { cwd: path.resolve("."), env, encoding: "utf8" },
  );
  assert.equal(blank.status, 0, blank.stderr);
  assert.match(blank.stdout.trim(), /^[A-Za-z0-9_-]{43}$/);
});
