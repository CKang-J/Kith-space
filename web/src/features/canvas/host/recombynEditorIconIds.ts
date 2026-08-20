export function normalizeRecombynEditorSpriteIds(source: string) {
  return source.replace(/id="icon-editor-([^"]+)"/g, (_match, fileName: string) =>
    `id="icon-editor-${fileName.replace(/-/g, "_")}"`,
  );
}
