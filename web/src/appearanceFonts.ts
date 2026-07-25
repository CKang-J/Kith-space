export const INTERFACE_FONT_IDS = [
  "sora", "system_ui", "inter", "geist",
  "system_monospace", "jetbrains_mono", "fira_code", "geist_mono",
] as const;
export const CONTENT_FONT_IDS = ["follow_interface", "system_ui", "sora", "inter", "geist"] as const;
export const CODE_FONT_IDS = ["system_monospace", "jetbrains_mono", "fira_code", "geist_mono"] as const;

export type InterfaceFont = (typeof INTERFACE_FONT_IDS)[number];
export type ContentFont = (typeof CONTENT_FONT_IDS)[number];
export type CodeFont = (typeof CODE_FONT_IDS)[number];

export interface AppearanceSettings {
  interfaceFont: InterfaceFont;
  contentFont: ContentFont;
  codeFont: CodeFont;
}

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  interfaceFont: "sora",
  contentFont: "follow_interface",
  codeFont: "system_monospace",
};

const interfaceFonts = new Set<string>(INTERFACE_FONT_IDS);
const contentFonts = new Set<string>(CONTENT_FONT_IDS);
const codeFonts = new Set<string>(CODE_FONT_IDS);

export function isAppearanceSettings(value: unknown): value is AppearanceSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.interfaceFont === "string"
    && interfaceFonts.has(candidate.interfaceFont)
    && typeof candidate.contentFont === "string"
    && contentFonts.has(candidate.contentFont)
    && typeof candidate.codeFont === "string"
    && codeFonts.has(candidate.codeFont);
}

type AppearanceDataset = {
  interfaceFont?: string;
  contentFont?: string;
  codeFont?: string;
};

export function applyAppearanceFonts(
  settings: AppearanceSettings,
  root: { dataset: AppearanceDataset } = document.documentElement,
): void {
  if (settings.interfaceFont === DEFAULT_APPEARANCE_SETTINGS.interfaceFont) delete root.dataset.interfaceFont;
  else root.dataset.interfaceFont = settings.interfaceFont;

  if (settings.contentFont === DEFAULT_APPEARANCE_SETTINGS.contentFont) delete root.dataset.contentFont;
  else root.dataset.contentFont = settings.contentFont;

  if (settings.codeFont === DEFAULT_APPEARANCE_SETTINGS.codeFont) delete root.dataset.codeFont;
  else root.dataset.codeFont = settings.codeFont;
}
