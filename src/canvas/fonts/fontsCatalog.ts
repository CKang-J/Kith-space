/**
 * Canvas font catalog transplanted from Recombyn
 * `reference/recombyn/apps/api/seeds/fonts_seed.json`.
 * Face files load from jsDelivr CDN via @font-face (not bundled Fontsource).
 */

import catalogJson from "./fontsCatalog.json" with { type: "json" };

export type CanvasFontFaceFormat = "woff2" | "woff" | "truetype" | "opentype";

export type CanvasFontChild = {
  family: string;
  displayName: string;
  url?: string;
  format?: CanvasFontFaceFormat;
  weight?: number;
};

export type CanvasFontFamily = {
  family: string;
  displayName: string;
  url?: string;
  format?: CanvasFontFaceFormat;
  children: CanvasFontChild[];
};

export const CANVAS_FONT_CATALOG: CanvasFontFamily[] = catalogJson as CanvasFontFamily[];

export const CANVAS_AVAILABLE_FONTS: string[] = CANVAS_FONT_CATALOG.map((font) => font.family);

/** Family names with Chinese/display labels for scene_summary contextText. */
export function canvasAvailableFontLabels(families: readonly string[] = CANVAS_AVAILABLE_FONTS): string[] {
  const labels = new Map(
    CANVAS_FONT_CATALOG.map((font) => [
      font.family,
      font.displayName && font.displayName !== font.family
        ? `${font.family} (${font.displayName})`
        : font.family,
    ]),
  );
  return families.map((family) => labels.get(family) ?? family);
}
