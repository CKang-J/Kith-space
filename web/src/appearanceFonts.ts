export const INTERFACE_FONT_IDS = [
  "sora", "system_ui", "inter", "geist",
  "system_monospace", "jetbrains_mono", "fira_code", "geist_mono",
] as const;
export const CONTENT_FONT_IDS = ["follow_interface", "system_ui", "sora", "inter", "geist"] as const;
export const CODE_FONT_IDS = ["system_monospace", "jetbrains_mono", "fira_code", "geist_mono"] as const;
export const UI_FONT_SIZES = [12, 13, 14, 15, 16] as const;
export const COLOR_MODE_IDS = ["light", "dark", "system"] as const;
export const COLOR_MODE_STORAGE_KEY = "kith-space.color-mode";

export type InterfaceFont = (typeof INTERFACE_FONT_IDS)[number];
export type ContentFont = (typeof CONTENT_FONT_IDS)[number];
export type CodeFont = (typeof CODE_FONT_IDS)[number];
export type UiFontSize = (typeof UI_FONT_SIZES)[number];
export type ColorMode = (typeof COLOR_MODE_IDS)[number];

export interface AppearanceSettings {
  interfaceFont: InterfaceFont;
  contentFont: ContentFont;
  codeFont: CodeFont;
  uiFontSize: UiFontSize;
  colorMode: ColorMode;
}

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  interfaceFont: "sora",
  contentFont: "follow_interface",
  codeFont: "system_monospace",
  uiFontSize: 14,
  colorMode: "system",
};

const interfaceFonts = new Set<string>(INTERFACE_FONT_IDS);
const contentFonts = new Set<string>(CONTENT_FONT_IDS);
const codeFonts = new Set<string>(CODE_FONT_IDS);
const uiFontSizes = new Set<number>(UI_FONT_SIZES);
const colorModes = new Set<string>(COLOR_MODE_IDS);

export function isAppearanceSettings(value: unknown): value is AppearanceSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.interfaceFont === "string"
    && interfaceFonts.has(candidate.interfaceFont)
    && typeof candidate.contentFont === "string"
    && contentFonts.has(candidate.contentFont)
    && typeof candidate.codeFont === "string"
    && codeFonts.has(candidate.codeFont)
    && typeof candidate.uiFontSize === "number"
    && uiFontSizes.has(candidate.uiFontSize)
    && typeof candidate.colorMode === "string"
    && colorModes.has(candidate.colorMode);
}

type AppearanceDataset = {
  interfaceFont?: string;
  contentFont?: string;
  codeFont?: string;
  uiFontSize?: string;
  colorMode?: string;
};

type ColorModeRoot = {
  classList: Pick<DOMTokenList, "toggle">;
  dataset: AppearanceDataset;
};

export function resolveColorTheme(mode: ColorMode, systemPrefersDark: boolean): "light" | "dark" {
  return mode === "system" ? (systemPrefersDark ? "dark" : "light") : mode;
}

export function readColorMode(value: string | undefined): ColorMode {
  return value && colorModes.has(value) ? value as ColorMode : DEFAULT_APPEARANCE_SETTINGS.colorMode;
}

/** Keeps the persisted preference and the resolved `.dark` class in one place. */
export function applyAppearanceColorMode(
  settings: Pick<AppearanceSettings, "colorMode">,
  root: ColorModeRoot = document.documentElement,
  systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches,
): void {
  root.dataset.colorMode = settings.colorMode;
  root.classList.toggle("dark", resolveColorTheme(settings.colorMode, systemPrefersDark) === "dark");
  try {
    window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, settings.colorMode);
  } catch {
    // Privacy-restricted browser contexts still receive the live document theme.
  }
}

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

  if (settings.uiFontSize === DEFAULT_APPEARANCE_SETTINGS.uiFontSize) delete root.dataset.uiFontSize;
  else root.dataset.uiFontSize = String(settings.uiFontSize);
}
