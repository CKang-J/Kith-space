import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceDirectory = path.resolve(
  here,
  "../../../../../reference/recombyn/apps/web/src/assets/svg/editor",
);
const output = path.join(here, "recombyn-editor-icon-sprite.svg");

const symbols = readdirSync(sourceDirectory)
  .filter((name) => name.endsWith(".svg"))
  .sort()
  .map((name) => {
    // vite-plugin-svg-icons preserves the original underscore filename in symbolId.
    const id = `icon-editor-${name.slice(0, -4)}`;
    return readFileSync(path.join(sourceDirectory, name), "utf8")
      .trim()
      .replace(/^<svg\b/, `<symbol id="${id}"`)
      .replace(/<\/svg>$/, "</symbol>");
  });

writeFileSync(
  output,
  `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display:none">\n${symbols.join("\n")}\n</svg>\n`,
  "utf8",
);
