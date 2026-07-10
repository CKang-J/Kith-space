import { useSyncExternalStore } from "react";
import { DEFAULT_MODULE_RATIO, normalizeModuleRatio } from "./paneConstraints.ts";

const MODULE_RATIO_KEY = "kith-space.workspace.split-ratio.v2";
const CHAT_LOCATIONS_KEY = "kith-space.workspace.last-chat";

export interface StoredChatLocation {
  path: string;
  channelId: string | null;
}

export type ShellState = {
  moduleRatio: number;
  lastChatPath: string | null;
  lastChatChannelId: string | null;
};

const defaultModuleRatio = () => {
  if (typeof window === "undefined") return DEFAULT_MODULE_RATIO;
  const stored = Number.parseFloat(window.localStorage.getItem(MODULE_RATIO_KEY) ?? "");
  return Number.isFinite(stored) ? normalizeModuleRatio(stored) : DEFAULT_MODULE_RATIO;
};

const readChatLocations = (): Record<string, StoredChatLocation> => {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(CHAT_LOCATIONS_KEY) ?? "{}") as Record<string, StoredChatLocation>;
  } catch {
    return {};
  }
};

export const storedChatLocation = (slug: string) => readChatLocations()[slug] ?? null;

const workspaceSlugFromPath = (path: string) => {
  const encoded = path.match(/^\/s\/([^/]+)/)?.[1];
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
};

let state: ShellState = {
  moduleRatio: defaultModuleRatio(),
  lastChatPath: null,
  lastChatChannelId: null,
};

const listeners = new Set<() => void>();

const update = (patch: Partial<ShellState>) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const setModuleRatio = (ratio: number) => {
  const moduleRatio = normalizeModuleRatio(ratio);
  if (typeof window !== "undefined") window.localStorage.setItem(MODULE_RATIO_KEY, String(moduleRatio));
  update({ moduleRatio });
};

export const shellActions = {
  setModuleRatio,
  resetModuleRatio: () => setModuleRatio(DEFAULT_MODULE_RATIO),
  rememberChatLocation: (path: string, channelId: string | null) => {
    const slug = workspaceSlugFromPath(path);
    if (slug && typeof window !== "undefined") {
      const locations = readChatLocations();
      locations[slug] = { path, channelId };
      window.localStorage.setItem(CHAT_LOCATIONS_KEY, JSON.stringify(locations));
    }
    if (state.lastChatPath === path && state.lastChatChannelId === channelId) return;
    update({ lastChatPath: path, lastChatChannelId: channelId });
  },
};

export function useShellStore() {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
