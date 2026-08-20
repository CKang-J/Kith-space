import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";
import { normalizeRecombynEditorSpriteIds } from "./recombynEditorIconIds";

test("sprite ids use the same underscore convention as Recombyn Icon hrefs", () => {
  assert.match(
    normalizeRecombynEditorSpriteIds('<symbol id="icon-editor-align-left" />'),
    /id="icon-editor-align_left"/,
  );
});

test("Kith host supplies every Recombyn editor SVG symbol used by the migrated UI", () => {
  const sprite = readFileSync(
    "web/src/features/canvas/manifests/recombyn-editor-icon-sprite.svg",
    "utf8",
  );
  const referenced = new Set<string>();
  const collect = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = `${directory}/${entry}`;
      if (statSync(path).isDirectory()) collect(path);
      else if (/\.tsx?$/.test(entry)) {
        for (const icon of readFileSync(path, "utf8").match(/['"](editor-[a-z0-9-]+)['"]/g) ?? []) {
          referenced.add(icon.slice(1, -1));
        }
      }
    }
  };
  collect("web/src/features/canvas/upstream/apps/web/src/components/editor");
  collect("web/src/features/canvas/upstream/apps/web/src/components/rcb/selection");

  // These literals are DOM hooks/panel names, not `<Icon>` references.
  for (const nonIcon of ["editor-tools", "editor-help", "editor-agent"]) referenced.delete(nonIcon);
  const missing = [...referenced].filter((name) => {
    const separator = name.indexOf("-");
    const id = `icon-${name.slice(0, separator)}-${name.slice(separator + 1).replace(/-/g, "_")}`;
    return !sprite.includes(`id="${id}"`);
  });
  assert.deepEqual(missing, []);
});
