import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_APPEARANCE_SETTINGS,
  applyAppearanceColorMode,
  applyAppearanceFonts,
  isAppearanceSettings,
  readColorMode,
  resolveColorTheme,
} from "./appearanceFonts.ts";

test("appearance settings validate the three font scopes and the UI size", () => {
  assert.equal(isAppearanceSettings(DEFAULT_APPEARANCE_SETTINGS), true);
  assert.equal(isAppearanceSettings({
    interfaceFont: "geist_mono",
    contentFont: "inter",
    codeFont: "jetbrains_mono",
    uiFontSize: 16,
    colorMode: "dark",
  }), true);
  assert.equal(isAppearanceSettings({
    interfaceFont: "unknown",
    contentFont: "follow_interface",
    codeFont: "system_monospace",
    uiFontSize: 14,
    colorMode: "system",
  }), false);
  assert.equal(isAppearanceSettings({ interfaceFont: "sora" }), false);
});

test("default fonts remove overrides while alternatives map to root data attributes", () => {
  const root: { dataset: { interfaceFont?: string; contentFont?: string; codeFont?: string; uiFontSize?: string; colorMode?: string } } = {
    dataset: {
      interfaceFont: "inter",
      contentFont: "geist",
      codeFont: "fira_code",
      uiFontSize: "16",
    },
  };

  applyAppearanceFonts(DEFAULT_APPEARANCE_SETTINGS, root);
  assert.deepEqual(root.dataset, {});

  applyAppearanceFonts({
    interfaceFont: "geist_mono",
    contentFont: "sora",
    codeFont: "jetbrains_mono",
    uiFontSize: 12,
    colorMode: "light",
  }, root);
  assert.deepEqual(root.dataset, {
    interfaceFont: "geist_mono",
    contentFont: "sora",
    codeFont: "jetbrains_mono",
    uiFontSize: "12",
  });
});

test("color mode resolves system preference and updates the document root", () => {
  assert.equal(resolveColorTheme("light", true), "light");
  assert.equal(resolveColorTheme("dark", false), "dark");
  assert.equal(resolveColorTheme("system", true), "dark");
  assert.equal(readColorMode("dark"), "dark");
  assert.equal(readColorMode("unexpected"), "system");

  const calls: Array<[string, boolean | undefined]> = [];
  const root = {
    dataset: {} as { colorMode?: string },
    classList: {
      toggle(token: string, force?: boolean) {
        calls.push([token, force]);
        return Boolean(force);
      },
    },
  };
  applyAppearanceColorMode({ colorMode: "system" }, root, true);
  assert.deepEqual(root.dataset, { colorMode: "system" });
  assert.deepEqual(calls, [["dark", true]]);
});
