import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_APPEARANCE_SETTINGS,
  applyAppearanceFonts,
  isAppearanceSettings,
} from "./appearanceFonts.ts";

test("appearance settings validate the three font scopes and the UI size", () => {
  assert.equal(isAppearanceSettings(DEFAULT_APPEARANCE_SETTINGS), true);
  assert.equal(isAppearanceSettings({
    interfaceFont: "geist_mono",
    contentFont: "inter",
    codeFont: "jetbrains_mono",
    uiFontSize: 16,
  }), true);
  assert.equal(isAppearanceSettings({
    interfaceFont: "unknown",
    contentFont: "follow_interface",
    codeFont: "system_monospace",
    uiFontSize: 14,
  }), false);
  assert.equal(isAppearanceSettings({ interfaceFont: "sora" }), false);
});

test("default fonts remove overrides while alternatives map to root data attributes", () => {
  const root: { dataset: { interfaceFont?: string; contentFont?: string; codeFont?: string; uiFontSize?: string } } = {
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
  }, root);
  assert.deepEqual(root.dataset, {
    interfaceFont: "geist_mono",
    contentFont: "sora",
    codeFont: "jetbrains_mono",
    uiFontSize: "12",
  });
});
