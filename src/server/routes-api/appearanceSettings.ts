import {
  AppearanceSettingsError,
  AppearanceSettingsService,
} from "../../appearance-settings/index.js";
import { readJson, sendErr, sendJson } from "../util.js";
import type { HumanCtx } from "./ctx.js";

const settings = new AppearanceSettingsService();
const SETTINGS_PATH = "/api/settings/appearance";

export async function handleAppearanceSettings(ctx: HumanCtx): Promise<boolean> {
  const { req, res, method, p } = ctx;
  if (p !== SETTINGS_PATH) return false;

  if (method === "GET") {
    return (sendJson(res, 200, settings.getSettings()), true);
  }
  if (method === "PATCH") {
    try {
      const updated = settings.updateSettings(await readJson(req) as unknown);
      return (sendJson(res, 200, updated), true);
    } catch (error) {
      if (error instanceof AppearanceSettingsError) return (sendErr(res, 400, error.message), true);
      throw error;
    }
  }
  return (sendErr(res, 404, "not found"), true);
}
