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
  assert.match(settings, /\["advisor", "misc\.settingsNavAdvisor"\]/);
  assert.match(settings, /resolveSettingsSection\(section, desktopBridge !== null\)/);
  assert.match(settings, /requestedSection === cur/);
  assert.match(moduleWorkspace, /workspaceModuleResourceFromSearch\(location\.search, moduleId\)/);
  assert.match(settings, /moduleId: "settings", settings: cur/);
  assert.match(settings, /function HumanSettings/);
  assert.doesNotMatch(`${settings}\n${moduleWorkspace}`, /settings: "account"|AccountSettings|settingsNavAccount|misc\.account/);
  assert.match(settings, /!desktopAvailable \? <div className="browser-session-row">/);
  assert.match(panel, /result\.accessToken/);
  assert.match(panel, /copyText\(revealedToken\)/);
  assert.match(panel, /browser\.mode === "lan"/);
  assert.match(panel, /mode === "lan" && browser\.mode !== "lan"/);
  assert.match(panel, /role="alertdialog"/);
  assert.match(en, /"settingsNavDesktop": "Desktop & Web"/);
  assert.match(zh, /"settingsNavDesktop": "桌面端与 Web"/);
});

test("Human settings and empty states use Personal AgentOS terminology", () => {
  const settings = source("./views/misc.tsx");
  const taskBoard = source("./TaskBoard.tsx");
  const en = JSON.parse(source("./locales/en.json"));
  const zh = JSON.parse(source("./locales/zh.json"));

  assert.match(settings, /\["human", "misc\.settingsNavHuman"\]/);
  assert.match(settings, /\["appearance", "misc\.settingsNavAppearance"\]/);
  assert.match(taskBoard, /t\("tasks\.emptySpace"\)/);
  assert.equal(en.misc.settingsNavHuman, "Human Profile");
  assert.equal(zh.misc.settingsNavHuman, "Human 资料");
  assert.equal(en.misc.settingsNavAppearance, "Appearance");
  assert.equal(zh.misc.settingsNavAppearance, "外观");
  assert.equal(en.tasks.emptyServer, undefined);
  assert.equal(zh.tasks.emptyServer, undefined);
  assert.equal(en.chat.loadFailedBody, "Kith-space could not reach its local service. Make sure the Desktop app is running, then retry.");
  assert.equal(zh.chat.loadFailedBody, "Kith-space 暂时连不上本机服务。请确认桌面应用仍在运行，然后重试。");
});
