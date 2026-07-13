import { getHumanProfile } from "../../app-data/appDatabase.js";
import { HostDirectoryBrowserError, listHostDirectories } from "../../spaces/hostDirectoryBrowser.js";
import { sendErr, sendJson } from "../util.js";
import type { HumanCtx } from "./ctx.js";

export async function handleHostDirectories(ctx: HumanCtx): Promise<boolean> {
  const { res, method, p, url, humanId } = ctx;
  if (p !== "/api/host-directories") return false;

  const human = getHumanProfile();
  if (!human || human.id !== humanId) return (sendErr(res, 403, "not the local Human"), true);
  if (method !== "GET") return (sendErr(res, 405, "method not allowed"), true);

  try {
    return (sendJson(res, 200, await listHostDirectories(url.searchParams.get("path") ?? undefined)), true);
  } catch (error) {
    if (!(error instanceof HostDirectoryBrowserError)) throw error;
    const status = error.code === "HOST_PATH_NOT_FOUND" ? 404 : error.code === "HOST_PATH_UNREADABLE" ? 403 : 400;
    return (sendErr(res, status, error.message, { code: error.code }), true);
  }
}
