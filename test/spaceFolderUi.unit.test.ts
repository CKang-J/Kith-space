import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const formSource = fs.readFileSync(new URL("../web/src/spaces/SpaceFolderForm.tsx", import.meta.url), "utf8");
const switcherSource = fs.readFileSync(new URL("../web/src/SpaceSwitcher.tsx", import.meta.url), "utf8");
const storeSource = fs.readFileSync(new URL("../web/src/store.tsx", import.meta.url), "utf8");
const recoverySource = fs.readFileSync(new URL("../web/src/spaces/SpaceRecovery.tsx", import.meta.url), "utf8");

test("Desktop chooses a host directory through the preload bridge while browser mode accepts a host path", () => {
  assert.match(formSource, /bridge\.pickSpaceDirectory\(\)/);
  assert.match(formSource, /space\.hostPathPlaceholder/);
  assert.doesNotMatch(formSource, /type=["']file["']/i);
});

test("Space switcher exposes default, attach, and reconnect flows", () => {
  assert.match(switcherSource, /setFlow\("default"\)/);
  assert.match(switcherSource, /setFlow\("attach"\)/);
  assert.match(switcherSource, /setFlow\("relocate"\)/);
  assert.match(switcherSource, /space\.status !== "ready"/);
  assert.match(switcherSource, /refreshSpaces\(\)/);
});

test("relocating a Space uses the dedicated identity-preserving endpoint", () => {
  assert.match(storeSource, /mutateSpaceDirectory\(`\/api\/spaces\/\$\{targetSpaceId\}\/relocate`/);
  assert.match(storeSource, /space\.status === "ready"/);
});

test("relocation stays reachable when no Space can be activated", () => {
  assert.match(recoverySource, /SpaceFolderForm intent="relocate"/);
  assert.match(recoverySource, /relocateSpace\(targetId, rootPath\)/);
});
