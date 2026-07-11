import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeAppDatabase } from "../src/app-data/appDatabase.ts";
import {
  DesktopSettingsError,
  DesktopSettingsService,
} from "../src/desktop-settings/index.ts";

let sandboxRoot = "";
let previousKithSpaceHome: string | undefined;

test.beforeEach(() => {
  closeAppDatabase();
  previousKithSpaceHome = process.env.KITH_SPACE_HOME;
  sandboxRoot = mkdtempSync(path.join(os.tmpdir(), "kith-space-desktop-settings-"));
  process.env.KITH_SPACE_HOME = sandboxRoot;
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

test("Desktop settings default to tray close behavior with launch-at-login disabled", () => {
  const settings = new DesktopSettingsService().getSettings();

  assert.deepEqual(settings, {
    closeBehavior: "tray",
    launchAtLogin: false,
  });
});

test("Desktop settings update one field without resetting the other", () => {
  const settings = new DesktopSettingsService();

  assert.deepEqual(settings.updateSettings({ launchAtLogin: true }), {
    closeBehavior: "tray",
    launchAtLogin: true,
  });
  assert.deepEqual(settings.updateSettings({ closeBehavior: "quit" }), {
    closeBehavior: "quit",
    launchAtLogin: true,
  });
  assert.deepEqual(settings.updateSettings({ launchAtLogin: false }), {
    closeBehavior: "quit",
    launchAtLogin: false,
  });
  assert.deepEqual(new DesktopSettingsService().getSettings(), {
    closeBehavior: "quit",
    launchAtLogin: false,
  });
});

test("Desktop settings reject malformed, empty, unknown, and mistyped updates", () => {
  const settings = new DesktopSettingsService();
  const invalidInputs = [
    null,
    [],
    {},
    { closeBehavior: "hide" },
    { launchAtLogin: 1 },
    { closeBehavior: "tray", extra: true },
  ];

  for (const input of invalidInputs) {
    assert.throws(
      () => settings.updateSettings(input),
      (error) => error instanceof DesktopSettingsError,
    );
  }
  assert.deepEqual(settings.getSettings(), {
    closeBehavior: "tray",
    launchAtLogin: false,
  });
});
