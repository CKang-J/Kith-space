import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_APPEARANCE_SETTINGS,
  applyAppearanceFonts,
  isAppearanceSettings,
} from "./appearanceFonts.ts";

test("appearance font settings validate the three supported scopes", () => {
  assert.equal(isAppearanceSettings(DEFAULT_APPEARANCE_SETTINGS), true);
  assert.equal(isAppearanceSettings({
    interfaceFont: "geist_mono",
    contentFont: "inter",
    codeFont: "jetbrains_mono",
  }), true);
  assert.equal(isAppearanceSettings({
    interfaceFont: "unknown",
    contentFont: "follow_interface",
    codeFont: "system_monospace",
  }), false);
  assert.equal(isAppearanceSettings({ interfaceFont: "sora" }), false);
});

test("default fonts remove overrides while alternatives map to root data attributes", () => {
  const root: { dataset: { interfaceFont?: string; contentFont?: string; codeFont?: string } } = {
    dataset: {
      interfaceFont: "inter",
      contentFont: "geist",
      codeFont: "fira_code",
    },
  };

  applyAppearanceFonts(DEFAULT_APPEARANCE_SETTINGS, root);
  assert.deepEqual(root.dataset, {});

  applyAppearanceFonts({
    interfaceFont: "geist_mono",
    contentFont: "sora",
    codeFont: "jetbrains_mono",
  }, root);
  assert.deepEqual(root.dataset, {
    interfaceFont: "geist_mono",
    contentFont: "sora",
    codeFont: "jetbrains_mono",
  });
});
