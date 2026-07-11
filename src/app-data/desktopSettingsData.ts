import { appDataConnection } from "./appDatabase.js";

export type StoredDesktopCloseBehavior = "tray" | "quit";

export interface DesktopSettingsRecord {
  closeBehavior: StoredDesktopCloseBehavior;
  launchAtLogin: boolean;
}

type DesktopSettingsRow = {
  close_behavior: StoredDesktopCloseBehavior;
  launch_at_login: 0 | 1;
};

function mapSettings(row: DesktopSettingsRow): DesktopSettingsRecord {
  return {
    closeBehavior: row.close_behavior,
    launchAtLogin: row.launch_at_login === 1,
  };
}

export function readDesktopSettings(): DesktopSettingsRecord {
  const row = appDataConnection().prepare(`
    SELECT close_behavior, launch_at_login
    FROM desktop_settings
    WHERE singleton_key = 1
  `).get() as DesktopSettingsRow;
  return mapSettings(row);
}

export function writeDesktopSettings(input: DesktopSettingsRecord): DesktopSettingsRecord {
  appDataConnection().prepare(`
    UPDATE desktop_settings
    SET close_behavior = @closeBehavior, launch_at_login = @launchAtLogin
    WHERE singleton_key = 1
  `).run({
    closeBehavior: input.closeBehavior,
    launchAtLogin: input.launchAtLogin ? 1 : 0,
  });
  return readDesktopSettings();
}
