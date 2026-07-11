import { DesktopSettingsError, DesktopSettingsService } from "../../desktop-settings/index.js";
import { isDesktopTrustedRequest } from "../../local-runtime/internalCredentials.js";
import { readJson, sendErr, sendJson } from "../util.js";
import type { BaseCtx } from "./ctx.js";

const settings = new DesktopSettingsService();
const SETTINGS_PATH = "/api/desktop/settings";

/** Desktop-only lifecycle settings. Browser sessions receive 404 at this seam. */
export async function handleDesktopSettings(ctx: BaseCtx): Promise<boolean> {
  const { req, res, method, p } = ctx;
  if (p !== SETTINGS_PATH && !p.startsWith(`${SETTINGS_PATH}/`)) return false;
  if (!isDesktopTrustedRequest(req)) return (sendErr(res, 404, "not found"), true);

  if (p === SETTINGS_PATH && method === "GET") {
    return (sendJson(res, 200, settings.getSettings()), true);
  }
  if (p === SETTINGS_PATH && method === "PUT") {
    try {
      const updated = settings.updateSettings(await readJson(req) as unknown);
      return (sendJson(res, 200, updated), true);
    } catch (error) {
      if (error instanceof DesktopSettingsError) return (sendErr(res, 400, error.message), true);
      throw error;
    }
  }
  return (sendErr(res, 404, "not found"), true);
}
