import {
  readBrowserAccessSettings,
  writeBrowserAccessPolicy,
  type BrowserAccessSettingsRecord,
} from "../app-data/browserAccessData.js";
import {
  BrowserAccessError,
  type BrowserAccessMode,
  type BrowserAccessSettings,
  type BrowserListenerPolicy,
} from "./types.js";

const MODES = new Set<BrowserAccessMode>(["off", "local", "lan"]);

function requireMode(value: unknown): BrowserAccessMode {
  if (typeof value !== "string" || !MODES.has(value as BrowserAccessMode)) {
    throw new BrowserAccessError("BROWSER_ACCESS_MODE_INVALID", "Browser access mode is invalid");
  }
  return value as BrowserAccessMode;
}

function requirePort(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new BrowserAccessError(
      "BROWSER_ACCESS_PORT_INVALID",
      "Browser access port must be an integer between 1 and 65535",
    );
  }
  return value;
}

function publicSettings(stored: BrowserAccessSettingsRecord): BrowserAccessSettings {
  return {
    mode: stored.mode,
    port: stored.port,
    hasAccessToken: stored.accessTokenHash !== null,
    tokenRevision: stored.tokenRevision,
  };
}

export class BrowserAccessPolicy {
  getSettings(): BrowserAccessSettings {
    return publicSettings(readBrowserAccessSettings());
  }

  updateSettings(input: { mode?: BrowserAccessMode; port?: number }): BrowserAccessSettings {
    const current = readBrowserAccessSettings();
    const stored = writeBrowserAccessPolicy({
      mode: input.mode === undefined ? current.mode : requireMode(input.mode),
      port: input.port === undefined ? current.port : requirePort(input.port),
    });
    return publicSettings(stored);
  }

  getListenerPolicy(): BrowserListenerPolicy {
    const settings = this.getSettings();
    return {
      browserEnabled: settings.mode !== "off",
      host: settings.mode === "lan" ? "0.0.0.0" : "127.0.0.1",
      port: settings.port,
    };
  }
}
