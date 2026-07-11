import { AppDataError } from "../../app-data/appDatabase.js";
import { isDesktopTrustedRequest } from "../../local-runtime/internalCredentials.js";
import { PersonalSetupError, PersonalSetupService } from "../../personal-setup/index.js";
import { readJson, sendErr, sendJson } from "../util.js";
import type { BaseCtx } from "./ctx.js";

const setup = new PersonalSetupService();
const STATUS_PATH = "/api/setup/status";
const INITIALIZE_PATH = "/api/setup/initialize";

/** Desktop-only setup routes that remain reachable before a Human exists. */
export async function handlePersonalSetup(ctx: BaseCtx): Promise<boolean> {
  const { req, res, method, p } = ctx;
  if (p !== STATUS_PATH && p !== INITIALIZE_PATH) return false;
  if (!isDesktopTrustedRequest(req)) return (sendErr(res, 404, "not found"), true);

  if (p === STATUS_PATH && method === "GET") {
    return (sendJson(res, 200, setup.getStatus()), true);
  }
  if (p === INITIALIZE_PATH && method === "POST") {
    try {
      return (sendJson(res, 200, await setup.initialize(await readJson(req) as unknown)), true);
    } catch (error) {
      if (error instanceof PersonalSetupError || error instanceof AppDataError) {
        return (sendErr(res, 400, error.message), true);
      }
      throw error;
    }
  }
  return (sendErr(res, 404, "not found"), true);
}
