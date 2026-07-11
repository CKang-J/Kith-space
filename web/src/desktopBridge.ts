export type DesktopCloseBehavior = "tray" | "quit";
export type BrowserAccessMode = "off" | "local" | "lan";

export interface DesktopLifecycleSettings {
  closeBehavior: DesktopCloseBehavior;
  launchAtLogin: boolean;
  launchAtLoginSupported: boolean;
}

export interface DesktopBrowserAccessSettings {
  mode: BrowserAccessMode;
  port: number;
  hasAccessToken: boolean;
  tokenRevision: number;
  activeSessions: number;
  lanWarning: string;
}

export interface DesktopSettingsSnapshot {
  lifecycle: DesktopLifecycleSettings;
  browser: DesktopBrowserAccessSettings;
}

export interface DesktopBrowserAccessResult extends DesktopSettingsSnapshot {
  accessToken?: string;
  restartRequired?: boolean;
  restarted?: boolean;
}

export interface KithDesktopBridge {
  getSettings(): Promise<DesktopSettingsSnapshot>;
  updateLifecycle(input: Partial<Pick<DesktopLifecycleSettings, "closeBehavior" | "launchAtLogin">>): Promise<DesktopSettingsSnapshot>;
  updateBrowserAccess(input: { mode?: BrowserAccessMode; port?: number; accessToken?: string }): Promise<DesktopBrowserAccessResult>;
  revokeBrowserSessions(): Promise<DesktopSettingsSnapshot>;
  completeBrowserAccessUpdate(): Promise<void>;
}

declare global {
  interface Window {
    kithDesktop?: KithDesktopBridge;
  }
}

interface DesktopBridgeHost {
  kithDesktop?: unknown;
}

const REQUIRED_METHODS: (keyof KithDesktopBridge)[] = [
  "getSettings",
  "updateLifecycle",
  "updateBrowserAccess",
  "revokeBrowserSessions",
  "completeBrowserAccessUpdate",
];

export function isKithDesktopBridge(value: unknown): value is KithDesktopBridge {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return REQUIRED_METHODS.every((method) => typeof candidate[method] === "function");
}

export function getDesktopBridge(host?: DesktopBridgeHost): KithDesktopBridge | null {
  const source = host ?? (typeof window === "undefined" ? undefined : window);
  return isKithDesktopBridge(source?.kithDesktop) ? source.kithDesktop : null;
}

export function resolveSettingsSection(requested: string | undefined, desktopAvailable: boolean) {
  const section = requested || "account";
  return section === "desktop" && !desktopAvailable ? "account" : section;
}
