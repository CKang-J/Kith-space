type ThemeClassList = Pick<DOMTokenList, "contains">;

/** Kith owns the resolved color mode through the document's `.dark` class. */
export function resolveKithCanvasTheme(classList: ThemeClassList): "light" | "dark" {
  return classList.contains("dark") ? "dark" : "light";
}
