import { createContext, useContext, type ReactNode } from "react";

const COLLABORATION_UNAVAILABLE = {
  status: "idle",
  role: null,
  peers: [],
  enabled: false,
  error: null,
  followingUserId: null,
  followPeer: () => undefined,
  unfollowPeer: () => undefined,
} as const;

const StageOneCollaborationContext = createContext(COLLABORATION_UNAVAILABLE);

export function useCollabRoom() { return useContext(StageOneCollaborationContext); }
export function CollabPresenceBar() { return null; }

/** Preserve the upstream composition point while making Yjs/WebSocket/IndexedDB unreachable. */
export function CollabRoomProvider({ children }: { children: ReactNode }) {
  return <StageOneCollaborationContext.Provider value={COLLABORATION_UNAVAILABLE}>{children}</StageOneCollaborationContext.Provider>;
}
