import type { BrowserMode, CoreReadyInfo, ProcessFailure } from "./processSupervisorContract.js";

function isBrowserMode(value: unknown): value is BrowserMode {
  return value === "off" || value === "local" || value === "lan";
}

export function parseCoreReadyMessage(message: unknown): CoreReadyInfo | null {
  if (!message || typeof message !== "object") return null;
  const candidate = message as Record<string, unknown>;
  if (candidate.type !== "kith:core-ready") return null;
  if (typeof candidate.host !== "string" || candidate.host.trim() === "") return null;
  if (!Number.isInteger(candidate.port) || Number(candidate.port) < 1 || Number(candidate.port) > 65_535) return null;
  if (!isBrowserMode(candidate.browserMode)) return null;
  return {
    host: candidate.host,
    port: Number(candidate.port),
    browserMode: candidate.browserMode,
  };
}

export function parseCoreErrorMessage(message: unknown): ProcessFailure | null {
  if (!message || typeof message !== "object") return null;
  const candidate = message as Record<string, unknown>;
  if (candidate.type !== "kith:core-error") return null;
  if (typeof candidate.code !== "string" || candidate.code.trim() === "") return null;
  if (typeof candidate.message !== "string" || candidate.message.trim() === "") return null;
  if (!Number.isInteger(candidate.port) || Number(candidate.port) < 1 || Number(candidate.port) > 65_535) return null;
  return {
    code: "CORE_REPORTED_ERROR",
    role: "core",
    message: candidate.message,
    reportedCode: candidate.code,
    port: Number(candidate.port),
  };
}
