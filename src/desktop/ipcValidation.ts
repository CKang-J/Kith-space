import type {
  DesktopBrowserMode,
  DesktopCloseBehavior,
} from "./coreClient.js";

type UnknownRecord = Record<string, unknown>;

function requireRecord(value: unknown, allowed: Set<string>): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Desktop settings input must be an object");
  }
  const record = value as UnknownRecord;
  const fields = Object.keys(record);
  if (fields.length === 0 || fields.some((field) => !allowed.has(field))) {
    throw new Error("Desktop settings input contains unsupported fields");
  }
  return record;
}
export function parseLifecycleUpdate(value: unknown): {
  closeBehavior?: DesktopCloseBehavior;
  launchAtLogin?: boolean;
} {
  const input = requireRecord(value, new Set(["closeBehavior", "launchAtLogin"]));
  if (input.closeBehavior !== undefined && input.closeBehavior !== "tray" && input.closeBehavior !== "quit") {
    throw new Error("closeBehavior must be tray or quit");
  }
  if (input.launchAtLogin !== undefined && typeof input.launchAtLogin !== "boolean") {
    throw new Error("launchAtLogin must be a boolean");
  }
  return {
    ...(input.closeBehavior === undefined ? {} : { closeBehavior: input.closeBehavior }),
    ...(input.launchAtLogin === undefined ? {} : { launchAtLogin: input.launchAtLogin }),
  };
}

export function parseBrowserAccessUpdate(value: unknown): {
  mode?: DesktopBrowserMode;
  port?: number;
  accessToken?: string;
} {
  const input = requireRecord(value, new Set(["mode", "port", "accessToken"]));
  if (input.mode !== undefined && input.mode !== "off" && input.mode !== "local" && input.mode !== "lan") {
    throw new Error("mode must be off, local, or lan");
  }
  if (input.port !== undefined && (!Number.isInteger(input.port) || (input.port as number) < 1 || (input.port as number) > 65535)) {
    throw new Error("port must be an integer from 1 to 65535");
  }
  if (input.accessToken !== undefined && typeof input.accessToken !== "string") {
    throw new Error("accessToken must be a string");
  }
  return {
    ...(input.mode === undefined ? {} : { mode: input.mode }),
    ...(input.port === undefined ? {} : { port: input.port as number }),
    ...(input.accessToken === undefined ? {} : { accessToken: input.accessToken }),
  };
}
