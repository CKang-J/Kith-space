import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Desktop settings consume only the narrow preload contract", () => {
  const bridge = source("./desktopBridge.ts");
  const panel = source("./views/DesktopSettings.tsx");

  for (const method of ["getSettings", "updateLifecycle", "updateBrowserAccess", "revokeBrowserSessions", "completeBrowserAccessUpdate"]) {
    assert.match(bridge, new RegExp(`${method}\\(`));
    assert.match(panel, new RegExp(`bridge\\.${method}\\(`));
  }
  assert.match(bridge, /interface Window[\s\S]+kithDesktop\?: KithDesktopBridge/);
  assert.doesNotMatch(`${bridge}\n${panel}`, /fetch\(|\/api\/desktop|x-kith-desktop-token/i);
});

test("Desktop settings navigation and copy are present only behind bridge detection", () => {
  const settings = source("./views/misc.tsx");
  const panel = source("./views/DesktopSettings.tsx");
  const moduleWorkspace = source("./shell/ModuleWorkspace.tsx");
  const en = source("./locales/en.json");
  const zh = source("./locales/zh.json");

  assert.match(settings, /const desktopBridge = getDesktopBridge\(\)/);
  assert.match(settings, /desktopBridge\s*\?\s*\[\.\.\.SETTINGS, \["desktop", "misc\.settingsNavDesktop"\]\]/);
  assert.match(settings, /resolveSettingsSection\(section, desktopBridge !== null\)/);
  assert.match(settings, /requestedSection !== "desktop" \|\| desktopBridge/);
  assert.match(moduleWorkspace, /workspaceModuleResourceFromSearch\(location\.search, moduleId\)/);
  assert.match(settings, /moduleId: "settings", settings: "account"/);
  assert.match(settings, /!desktopAvailable \? <div className="browser-session-row">/);
  assert.match(panel, /result\.accessToken/);
  assert.match(panel, /copyText\(revealedToken\)/);
  assert.match(panel, /browser\.mode === "lan"/);
  assert.match(panel, /mode === "lan" && browser\.mode !== "lan"/);
  assert.match(panel, /role="alertdialog"/);
  assert.match(en, /"settingsNavDesktop": "Desktop & Web"/);
  assert.match(zh, /"settingsNavDesktop": "桌面端与 Web"/);
});
