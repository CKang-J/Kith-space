import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const formSource = fs.readFileSync(new URL("../web/src/spaces/SpaceFolderForm.tsx", import.meta.url), "utf8");
const switcherSource = fs.readFileSync(new URL("../web/src/SpaceSwitcher.tsx", import.meta.url), "utf8");
const storeSource = fs.readFileSync(new URL("../web/src/store.tsx", import.meta.url), "utf8");
const recoverySource = fs.readFileSync(new URL("../web/src/spaces/SpaceRecovery.tsx", import.meta.url), "utf8");

test("Desktop uses the native directory bridge while browser mode uses the host directory browser", () => {
  assert.match(formSource, /bridge\.pickSpaceDirectory\(\)/);
  assert.match(formSource, /<HostDirectoryPicker/);
  assert.doesNotMatch(formSource, /space\.hostPathPlaceholder/);
  assert.doesNotMatch(formSource, /type=["']file["']/i);
});

test("Space switcher stays a quick switcher with Home management and emergency reconnect", () => {
  assert.doesNotMatch(switcherSource, /setFlow\("default"\)/);
  assert.doesNotMatch(switcherSource, /setFlow\("attach"\)/);
  assert.match(switcherSource, /setFlow\("relocate"\)/);
  assert.match(switcherSource, /space\.status !== "ready"/);
  assert.match(switcherSource, /space\.isHome/);
  assert.match(switcherSource, /module=spaces/);
  assert.match(switcherSource, /refreshSpaces\(\)/);
});

test("relocating a Space uses the dedicated identity-preserving endpoint", () => {
  assert.match(storeSource, /mutateSpaceDirectory\("POST", `\/api\/spaces\/\$\{targetSpaceId\}\/relocate`/);
});

test("relocation stays reachable when no Space can be activated", () => {
  assert.match(recoverySource, /SpaceFolderForm intent="relocate"/);
  assert.match(recoverySource, /relocateSpace\(targetId, rootPath\)/);
});
