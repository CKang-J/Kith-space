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
  pickSpaceDirectory: async () => null,
  revealSpaceDirectory: async () => "",
};

test("Desktop bridge detection accepts only the complete preload contract", () => {
  assert.equal(isKithDesktopBridge(bridge), true);
  assert.equal(getDesktopBridge({ kithDesktop: bridge }), bridge);
  assert.equal(isKithDesktopBridge({ ...bridge, pickSpaceDirectory: undefined }), false);
  assert.equal(isKithDesktopBridge({ ...bridge, revealSpaceDirectory: undefined }), false);
  assert.equal(isKithDesktopBridge({ ...bridge, revokeBrowserSessions: undefined }), false);
  assert.equal(getDesktopBridge({}), null);
});

test("settings routes default and fall back to the Human profile", () => {
  assert.equal(resolveSettingsSection("desktop", false), "human");
  assert.equal(resolveSettingsSection("desktop", true), "desktop");
  assert.equal(resolveSettingsSection("appearance", false), "appearance");
  assert.equal(resolveSettingsSection("generation", false), "generation");
  assert.equal(resolveSettingsSection("space", false), "space");
  assert.equal(resolveSettingsSection("advisor", false), "advisor");
  assert.equal(resolveSettingsSection("human", false), "human");
  assert.equal(resolveSettingsSection("account", false), "human");
  assert.equal(resolveSettingsSection("unknown", true), "human");
  assert.equal(resolveSettingsSection(undefined, false), "human");
});
