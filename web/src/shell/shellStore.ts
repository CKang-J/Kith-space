const CHAT_LOCATIONS_KEY = "kith-space.workspace.last-chat";

export interface StoredChatLocation {
  path: string;
  channelId: string | null;
}

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

export const shellActions = {
  rememberChatLocation: (path: string, channelId: string | null) => {
    const slug = workspaceSlugFromPath(path);
    if (slug && typeof window !== "undefined") {
      const locations = readChatLocations();
      locations[slug] = { path, channelId };
      window.localStorage.setItem(CHAT_LOCATIONS_KEY, JSON.stringify(locations));
    }
  },
};
