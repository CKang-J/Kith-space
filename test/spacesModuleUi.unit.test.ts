import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sourceUrl = new URL("../web/src/spaces/SpacesModule.tsx", import.meta.url);
const createMenuUrl = new URL("../web/src/spaces/SpaceCreateMenu.tsx", import.meta.url);
const cssUrl = new URL("../web/src/spaces/SpacesModule.css", import.meta.url);

test("Home Spaces module exposes only local Space lifecycle actions", () => {
  const source = fs.readFileSync(sourceUrl, "utf8");

  assert.match(source, /SpaceFolderForm/);
  assert.match(source, /filter\(\(space\)\s*=>\s*!space\.isHome\)/);
  assert.match(source, /type="search"/);
  assert.match(source, /refreshSpaces\(\)/);
  assert.match(source, /space\.rootPath/);
  assert.match(source, /space\.lastOpenedAt/);
  assert.match(source, /space\.status\s*===\s*"ready"/);
  assert.match(source, /relocateSpace\(/);
  assert.match(source, /`\/s\/\$\{space\.slug\}\/channel`/);

  assert.doesNotMatch(source, /\/api\/(?:tasks|inbox)/);
});

test("Space creation choices live under one accessible New Space menu", () => {
  const source = fs.readFileSync(sourceUrl, "utf8");
  const menu = fs.readFileSync(createMenuUrl, "utf8");

  assert.match(source, /<SpaceCreateMenu onSelect=\{openCreate\} \/>/);
  assert.doesNotMatch(source, /onClick=\{\(\) => openCreate\("attach"\)\}/);
  assert.match(menu, /aria-haspopup="menu"/);
  assert.match(menu, /role="menu"/);
  assert.match(menu, /role="menuitem"/);
  assert.match(menu, /spacesModule\.createBlank/);
  assert.match(menu, /spacesModule\.attachExisting/);
});

test("Spaces module keeps the card grid responsive inside the existing module panel", () => {
  const css = fs.readFileSync(cssUrl, "utf8");

  assert.match(css, /\.spaces-module__grid\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(/);
  assert.match(css, /\.spaces-module__card\s*\{[^}]*border-radius:/s);
});
