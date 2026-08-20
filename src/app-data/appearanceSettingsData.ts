import { appDataConnection } from "./appDatabase.js";

export type StoredCodeFont = "system_monospace" | "jetbrains_mono" | "fira_code" | "geist_mono";
export type StoredSansFont = "sora" | "system_ui" | "inter" | "geist";
export type StoredInterfaceFont = StoredSansFont | StoredCodeFont;
export type StoredContentFont = "follow_interface" | StoredSansFont;
export type StoredUiFontSize = 12 | 13 | 14 | 15 | 16;
export type StoredColorMode = "light" | "dark" | "system";

export interface AppearanceSettingsRecord {
  interfaceFont: StoredInterfaceFont;
  contentFont: StoredContentFont;
  codeFont: StoredCodeFont;
  uiFontSize: StoredUiFontSize;
  colorMode: StoredColorMode;
}

type AppearanceSettingsRow = {
  interface_font: StoredInterfaceFont;
  content_font: StoredContentFont;
  code_font: StoredCodeFont;
  ui_font_size: StoredUiFontSize;
  color_mode: StoredColorMode;
};

function mapSettings(row: AppearanceSettingsRow): AppearanceSettingsRecord {
  return {
    interfaceFont: row.interface_font,
    contentFont: row.content_font,
    codeFont: row.code_font,
    uiFontSize: row.ui_font_size,
    colorMode: row.color_mode,
  };
}

export function readAppearanceSettings(): AppearanceSettingsRecord {
  const row = appDataConnection().prepare(`
    SELECT interface_font, content_font, code_font, ui_font_size, color_mode
    FROM appearance_settings
    WHERE singleton_key = 1
  `).get() as AppearanceSettingsRow;
  return mapSettings(row);
}

export function writeAppearanceSettings(input: AppearanceSettingsRecord): AppearanceSettingsRecord {
  appDataConnection().prepare(`
    UPDATE appearance_settings
    SET interface_font = @interfaceFont,
        content_font = @contentFont,
        code_font = @codeFont,
        ui_font_size = @uiFontSize,
        color_mode = @colorMode
    WHERE singleton_key = 1
  `).run(input);
  return readAppearanceSettings();
}
