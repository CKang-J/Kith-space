import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sourceUrl = new URL("../web/src/spaces/SpacesModule.tsx", import.meta.url);
const createMenuUrl = new URL("../web/src/spaces/SpaceCreateMenu.tsx", import.meta.url);
const dialogUrl = new URL("../web/src/spaces/SpaceFolderDialog.tsx", import.meta.url);
const folderFormUrl = new URL("../web/src/spaces/SpaceFolderForm.tsx", import.meta.url);
const hostPickerUrl = new URL("../web/src/spaces/HostDirectoryPicker.tsx", import.meta.url);
const hostDirectoryApiUrl = new URL("../web/src/spaces/hostDirectoryApi.ts", import.meta.url);
const cardMenuUrl = new URL("../web/src/spaces/SpaceCardMenu.tsx", import.meta.url);
const renameDialogUrl = new URL("../web/src/spaces/SpaceRenameDialog.tsx", import.meta.url);
const cssUrl = new URL("../web/src/spaces/SpacesModule.css", import.meta.url);

test("Home Spaces module exposes only local Space lifecycle actions", () => {
  const source = fs.readFileSync(sourceUrl, "utf8");

  assert.match(source, /SpaceFolderForm/);
  assert.match(source, /filter\(\(space\)\s*=>\s*!space\.isHome\)/);
  assert.match(source, /<SearchField/);
  assert.match(source, /refreshSpaces\(\)/);
  assert.match(source, /space\.rootPath/);
  assert.match(source, /space\.lastOpenedAt/);
  assert.match(source, /space\.status\s*===\s*"ready"/);
  assert.match(source, /relocateSpace\(/);
  assert.match(source, /`\/s\/\$\{space\.slug\}\/channel`/);

  assert.doesNotMatch(source, /\/api\/(?:tasks|inbox)/);
});

test("Space cards expose accessible project actions and focused dialogs", () => {
  const source = fs.readFileSync(sourceUrl, "utf8");
  const menu = fs.readFileSync(cardMenuUrl, "utf8");
  const renameDialog = fs.readFileSync(renameDialogUrl, "utf8");

  assert.match(source, /<SpaceCardMenu/);
  assert.match(source, /onContextMenu=/);
  assert.match(source, /contextMenuRequest/);
  assert.match(source, /copyText\(space\.rootPath\)/);
  assert.match(source, /removeSpace\(space\.id\)/);
  assert.match(menu, /aria-haspopup="menu"/);
  assert.match(menu, /role="menuitem"/);
  assert.match(menu, /spacesModule\.revealInFileManager/);
  assert.match(menu, /spacesModule\.favorite/);
  assert.match(menu, /spacesModule\.remove/);
  assert.match(renameDialog, /role="dialog"/);
  assert.match(renameDialog, /aria-modal="true"/);
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

test("Space creation uses a modal and browser host-directory picker", () => {
  const source = fs.readFileSync(sourceUrl, "utf8");
  const dialog = fs.readFileSync(dialogUrl, "utf8");
  const form = fs.readFileSync(folderFormUrl, "utf8");
  const picker = fs.readFileSync(hostPickerUrl, "utf8");
  const hostDirectoryApi = fs.readFileSync(hostDirectoryApiUrl, "utf8");

  assert.match(source, /<SpaceFolderDialog/);
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(form, /<HostDirectoryPicker/);
  assert.doesNotMatch(form, /space\.hostPathPlaceholder/);
  assert.match(hostDirectoryApi, /\/api\/host-directories/);
  assert.match(picker, /spacesModule\.selectCurrentFolder/);
});

test("Spaces module keeps the card grid responsive inside the existing module panel", () => {
  const css = fs.readFileSync(cssUrl, "utf8");

  assert.match(css, /\.spaces-module__grid\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(/);
  assert.match(css, /\.spaces-module__card\s*\{[^}]*border-radius:/s);
});
