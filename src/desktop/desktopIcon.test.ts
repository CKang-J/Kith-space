import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { resolveDesktopIconPath } from "./desktopIcon.js";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

test("Desktop icon resolves from the active application layout", () => {
  assert.equal(
    resolveDesktopIconPath({ isDevelopment: true, repoRoot: "C:\\repo", resourcesPath: "C:\\resources" }),
    path.join("C:\\repo", "web", "public", "favicon.ico"),
  );
  assert.equal(
    resolveDesktopIconPath({ isDevelopment: false, repoRoot: "C:\\repo", resourcesPath: "C:\\resources" }),
    path.join("C:\\resources", "web", "dist", "favicon.ico"),
  );
});

test("Desktop window and tray share the branded icon", () => {
  assert.match(mainSource, /const desktopIconPath = resolveDesktopIconPath\(/);
  assert.match(mainSource, /new Tray\(nativeImage\.createFromPath\(desktopIconPath\)\)/);
  assert.match(mainSource, /new BrowserWindow\(\{[\s\S]*?icon: desktopIconPath,/);
});
