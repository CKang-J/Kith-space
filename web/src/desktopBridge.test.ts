import assert from "node:assert/strict";
import { test } from "node:test";
import { getDesktopBridge, isKithDesktopBridge, resolveSettingsSection } from "./desktopBridge.ts";

const bridge = {
  getSettings: async () => ({
    lifecycle: { closeBehavior: "tray" as const, launchAtLogin: false, launchAtLoginSupported: true },
    browser: { mode: "off" as const, port: 7777, hasAccessToken: false, tokenRevision: 0, activeSessions: 0, lanWarning: "" },
  }),
  updateLifecycle: async () => bridge.getSettings(),
  updateBrowserAccess: async () => bridge.getSettings(),
  revokeBrowserSessions: async () => bridge.getSettings(),
  completeBrowserAccessUpdate: async () => {},
};

test("Desktop bridge detection accepts only the complete preload contract", () => {
  assert.equal(isKithDesktopBridge(bridge), true);
  assert.equal(getDesktopBridge({ kithDesktop: bridge }), bridge);
  assert.equal(isKithDesktopBridge({ ...bridge, revokeBrowserSessions: undefined }), false);
  assert.equal(getDesktopBridge({}), null);
});

test("Desktop settings routes fall back to account outside Electron", () => {
  assert.equal(resolveSettingsSection("desktop", false), "account");
  assert.equal(resolveSettingsSection("desktop", true), "desktop");
  assert.equal(resolveSettingsSection("space", false), "space");
  assert.equal(resolveSettingsSection(undefined, false), "account");
});
