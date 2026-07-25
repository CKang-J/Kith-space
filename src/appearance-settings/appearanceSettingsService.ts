import {
  readAppearanceSettings,
  writeAppearanceSettings,
  type StoredCodeFont,
  type StoredContentFont,
  type StoredInterfaceFont,
  type StoredUiFontSize,
} from "../app-data/appearanceSettingsData.js";

export type InterfaceFont = StoredInterfaceFont;
export type ContentFont = StoredContentFont;
export type CodeFont = StoredCodeFont;
export type UiFontSize = StoredUiFontSize;

export interface AppearanceSettings {
  interfaceFont: InterfaceFont;
  contentFont: ContentFont;
  codeFont: CodeFont;
  uiFontSize: UiFontSize;
}

export type AppearanceSettingsErrorCode =
  | "APPEARANCE_SETTINGS_BODY_INVALID"
  | "APPEARANCE_SETTINGS_FIELD_UNKNOWN"
  | "APPEARANCE_INTERFACE_FONT_INVALID"
  | "APPEARANCE_CONTENT_FONT_INVALID"
  | "APPEARANCE_CODE_FONT_INVALID"
  | "APPEARANCE_UI_FONT_SIZE_INVALID";

export class AppearanceSettingsError extends Error {
  constructor(public readonly code: AppearanceSettingsErrorCode, message: string) {
    super(message);
    this.name = "AppearanceSettingsError";
  }
}

const ALLOWED_FIELDS = new Set(["interfaceFont", "contentFont", "codeFont", "uiFontSize"]);
const INTERFACE_FONTS = new Set<InterfaceFont>([
  "sora", "system_ui", "inter", "geist",
  "system_monospace", "jetbrains_mono", "fira_code", "geist_mono",
]);
const CONTENT_FONTS = new Set<ContentFont>(["follow_interface", "system_ui", "sora", "inter", "geist"]);
const CODE_FONTS = new Set<CodeFont>(["system_monospace", "jetbrains_mono", "fira_code", "geist_mono"]);
const UI_FONT_SIZES = new Set<UiFontSize>([12, 13, 14, 15, 16]);

function requireUpdate(input: unknown): Partial<AppearanceSettings> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AppearanceSettingsError("APPEARANCE_SETTINGS_BODY_INVALID", "request body must be an object");
  }
  const body = input as Record<string, unknown>;
  const fields = Object.keys(body);
  if (fields.length === 0) {
    throw new AppearanceSettingsError("APPEARANCE_SETTINGS_BODY_INVALID", "at least one appearance setting is required");
  }
  const unknownField = fields.find((field) => !ALLOWED_FIELDS.has(field));
  if (unknownField) {
    throw new AppearanceSettingsError("APPEARANCE_SETTINGS_FIELD_UNKNOWN", `unknown appearance setting: ${unknownField}`);
  }

  const update: Partial<AppearanceSettings> = {};
  if (Object.prototype.hasOwnProperty.call(body, "interfaceFont")) {
    if (typeof body.interfaceFont !== "string" || !INTERFACE_FONTS.has(body.interfaceFont as InterfaceFont)) {
      throw new AppearanceSettingsError(
        "APPEARANCE_INTERFACE_FONT_INVALID",
        "interfaceFont is not a supported interface font",
      );
    }
    update.interfaceFont = body.interfaceFont as InterfaceFont;
  }
  if (Object.prototype.hasOwnProperty.call(body, "contentFont")) {
    if (typeof body.contentFont !== "string" || !CONTENT_FONTS.has(body.contentFont as ContentFont)) {
      throw new AppearanceSettingsError(
        "APPEARANCE_CONTENT_FONT_INVALID",
        "contentFont is not a supported content font",
      );
    }
    update.contentFont = body.contentFont as ContentFont;
  }
  if (Object.prototype.hasOwnProperty.call(body, "codeFont")) {
    if (typeof body.codeFont !== "string" || !CODE_FONTS.has(body.codeFont as CodeFont)) {
      throw new AppearanceSettingsError(
        "APPEARANCE_CODE_FONT_INVALID",
        "codeFont is not a supported code font",
      );
    }
    update.codeFont = body.codeFont as CodeFont;
  }
  if (Object.prototype.hasOwnProperty.call(body, "uiFontSize")) {
    if (typeof body.uiFontSize !== "number" || !UI_FONT_SIZES.has(body.uiFontSize as UiFontSize)) {
      throw new AppearanceSettingsError(
        "APPEARANCE_UI_FONT_SIZE_INVALID",
        "uiFontSize must be one of 12, 13, 14, 15, or 16",
      );
    }
    update.uiFontSize = body.uiFontSize as UiFontSize;
  }
  return update;
}

/** Installation-level typography preferences behind one validated persistence boundary. */
export class AppearanceSettingsService {
  getSettings(): AppearanceSettings {
    return readAppearanceSettings();
  }

  updateSettings(input: unknown): AppearanceSettings {
    const update = requireUpdate(input);
    const current = readAppearanceSettings();
    return writeAppearanceSettings({
      interfaceFont: update.interfaceFont ?? current.interfaceFont,
      contentFont: update.contentFont ?? current.contentFont,
      codeFont: update.codeFont ?? current.codeFont,
      uiFontSize: update.uiFontSize ?? current.uiFontSize,
    });
  }
}
