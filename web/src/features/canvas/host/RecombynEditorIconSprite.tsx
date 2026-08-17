import sprite from "@/features/canvas/manifests/recombyn-editor-icon-sprite.svg?raw";
import { normalizeRecombynEditorSpriteIds } from "./recombynEditorIconIds";

/** Inject the generated sprite before Recombyn resolves its original `<use href="#icon-…">`. */
export function RecombynEditorIconSprite() {
  return (
    <div
      aria-hidden="true"
      className="hidden"
      data-recombyn-editor-icon-sprite
      dangerouslySetInnerHTML={{ __html: normalizeRecombynEditorSpriteIds(sprite) }}
    />
  );
}
