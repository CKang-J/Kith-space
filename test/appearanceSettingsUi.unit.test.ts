import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const settingsView = fs.readFileSync(new URL("../web/src/views/misc.tsx", import.meta.url), "utf8");
const appearanceView = fs.readFileSync(
  new URL("../web/src/views/appearance-settings/AppearanceSettings.tsx", import.meta.url),
  "utf8",
);
const syncView = fs.readFileSync(new URL("../web/src/AppearanceFontSync.tsx", import.meta.url), "utf8");
const apiRoutes = fs.readFileSync(new URL("../src/server/routes-api/index.ts", import.meta.url), "utf8");

test("Settings exposes a dedicated Appearance page backed by shadcn fields and selects", () => {
  assert.match(settingsView, /\["appearance", "misc\.settingsNavAppearance"\]/);
  assert.match(settingsView, /cur === "appearance"[\s\S]*?<AppearanceSettings api=\{api\}/);
  assert.match(appearanceView, /from "@\/components\/ui\/field"/);
  assert.match(appearanceView, /from "@\/components\/ui\/select"/);
  assert.match(appearanceView, /interfaceFont/);
  assert.match(appearanceView, /contentFont/);
  assert.match(appearanceView, /codeFont/);
  assert.match(appearanceView, /INTERFACE_MONOSPACE_OPTIONS/);
  assert.match(appearanceView, /<SelectSeparator \/>/);
  assert.match(appearanceView, /<section className="rounded-xl border border-border bg-card p-5 text-card-foreground">/);
  assert.match(appearanceView, /<FieldSet className="m-0 border-0 p-0">/);
});

test("appearance fonts load behind Human auth and apply at the document root", () => {
  assert.match(apiRoutes, /handleAppearanceSettings\(humanCtx\)/);
  assert.match(syncView, /authState !== "authed"/);
  assert.match(syncView, /\/api\/settings\/appearance/);
  assert.match(syncView, /applyAppearanceFonts\(result\)/);
});
