import type { ServerResponse } from "node:http";
import { sendErr } from "../util.js";
import { isTaskOperationError } from "./taskTypes.js";

export function sendTaskOperationError(res: ServerResponse, error: unknown): boolean {
  if (!isTaskOperationError(error)) return false;
  const status = error.code === "INVALID_ARGUMENT" ? 400
    : error.code === "NOT_FOUND" ? 404
      : 409;
  sendErr(res, status, error.message, { code: error.code, current: error.current ?? null });
  return true;
}
