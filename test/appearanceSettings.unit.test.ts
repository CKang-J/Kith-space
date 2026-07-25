import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeAppDatabase } from "../src/app-data/appDatabase.ts";
import {
  AppearanceSettingsError,
  AppearanceSettingsService,
} from "../src/appearance-settings/index.ts";

let sandboxRoot = "";
let previousKithSpaceHome: string | undefined;

test.beforeEach(() => {
  closeAppDatabase();
  previousKithSpaceHome = process.env.KITH_SPACE_HOME;
  sandboxRoot = mkdtempSync(path.join(os.tmpdir(), "kith-space-appearance-settings-"));
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

test("appearance settings preserve the current typography combination by default", () => {
  assert.deepEqual(new AppearanceSettingsService().getSettings(), {
    interfaceFont: "sora",
    contentFont: "follow_interface",
    codeFont: "system_monospace",
  });
});

test("appearance settings update one scope without resetting the others", () => {
  const settings = new AppearanceSettingsService();

  assert.deepEqual(settings.updateSettings({ interfaceFont: "inter" }), {
    interfaceFont: "inter",
    contentFont: "follow_interface",
    codeFont: "system_monospace",
  });
  assert.deepEqual(settings.updateSettings({ contentFont: "geist", codeFont: "jetbrains_mono" }), {
    interfaceFont: "inter",
    contentFont: "geist",
    codeFont: "jetbrains_mono",
  });
  assert.deepEqual(new AppearanceSettingsService().getSettings(), {
    interfaceFont: "inter",
    contentFont: "geist",
    codeFont: "jetbrains_mono",
  });
  assert.deepEqual(settings.updateSettings({ interfaceFont: "fira_code" }), {
    interfaceFont: "fira_code",
    contentFont: "geist",
    codeFont: "jetbrains_mono",
  });
});

test("appearance settings reject malformed, unknown, and unsupported values", () => {
  const settings = new AppearanceSettingsService();
  const invalidInputs = [
    null,
    [],
    {},
    { interfaceFont: "comic_sans" },
    { contentFont: "system_monospace" },
    { codeFont: "sora" },
    { interfaceFont: "sora", extra: true },
  ];

  for (const input of invalidInputs) {
    assert.throws(
      () => settings.updateSettings(input),
      (error) => error instanceof AppearanceSettingsError,
    );
  }
  assert.deepEqual(settings.getSettings(), {
    interfaceFont: "sora",
    contentFont: "follow_interface",
    codeFont: "system_monospace",
  });
});
