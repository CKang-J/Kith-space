import {
  readDesktopSettings,
  writeDesktopSettings,
} from "../app-data/desktopSettingsData.js";

export type DesktopCloseBehavior = "tray" | "quit";

export interface DesktopSettings {
  closeBehavior: DesktopCloseBehavior;
  launchAtLogin: boolean;
}

export type DesktopSettingsErrorCode =
  | "DESKTOP_SETTINGS_BODY_INVALID"
  | "DESKTOP_SETTINGS_FIELD_UNKNOWN"
  | "DESKTOP_CLOSE_BEHAVIOR_INVALID"
  | "DESKTOP_LAUNCH_AT_LOGIN_INVALID";

export class DesktopSettingsError extends Error {
  constructor(public readonly code: DesktopSettingsErrorCode, message: string) {
    super(message);
    this.name = "DesktopSettingsError";
  }
}

const ALLOWED_FIELDS = new Set(["closeBehavior", "launchAtLogin"]);

function requireUpdate(input: unknown): Partial<DesktopSettings> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new DesktopSettingsError("DESKTOP_SETTINGS_BODY_INVALID", "request body must be an object");
  }
  const body = input as Record<string, unknown>;
  const fields = Object.keys(body);
  if (fields.length === 0) {
    throw new DesktopSettingsError("DESKTOP_SETTINGS_BODY_INVALID", "at least one Desktop setting is required");
  }
  const unknownField = fields.find((field) => !ALLOWED_FIELDS.has(field));
  if (unknownField) {
    throw new DesktopSettingsError("DESKTOP_SETTINGS_FIELD_UNKNOWN", `unknown Desktop setting: ${unknownField}`);
  }
  const update: Partial<DesktopSettings> = {};
  if (Object.prototype.hasOwnProperty.call(body, "closeBehavior")) {
    if (body.closeBehavior !== "tray" && body.closeBehavior !== "quit") {
      throw new DesktopSettingsError(
        "DESKTOP_CLOSE_BEHAVIOR_INVALID",
        "closeBehavior must be tray or quit",
      );
    }
    update.closeBehavior = body.closeBehavior;
  }
  if (Object.prototype.hasOwnProperty.call(body, "launchAtLogin")) {
    if (typeof body.launchAtLogin !== "boolean") {
      throw new DesktopSettingsError(
        "DESKTOP_LAUNCH_AT_LOGIN_INVALID",
        "launchAtLogin must be a boolean",
      );
    }
    update.launchAtLogin = body.launchAtLogin;
  }
  return update;
}

/** Installation-level Desktop lifecycle settings behind one validated persistence interface. */
export class DesktopSettingsService {
  getSettings(): DesktopSettings {
    return readDesktopSettings();
  }

  updateSettings(input: unknown): DesktopSettings {
    const update = requireUpdate(input);
    const current = readDesktopSettings();
    return writeDesktopSettings({
      closeBehavior: update.closeBehavior ?? current.closeBehavior,
      launchAtLogin: update.launchAtLogin ?? current.launchAtLogin,
    });
  }
}
