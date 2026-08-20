/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/collab/collabTypes.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
export type CollabRole = 'edit' | 'view';

export type CollabStatus = 'idle' | 'connecting' | 'synced' | 'error';

export type CollabPeerCamera = {
  x: number;
  y: number;
  zoom: number;
};

export type CollabPeer = {
  clientId: number;
  userId: string;
  name: string;
  color: string;
  selectedNodeIds: string[];
  /** Artboard / frame selection (data-frame-id). */
  selectedFrameIds: string[];
  cursor: { x: number; y: number } | null;
  /** Remote viewport for peer follow. */
  camera: CollabPeerCamera | null;
};

export type CollabRoomToken = {
  token: string;
  roomId: string;
  wsUrl: string;
  role: CollabRole;
  expiresAt: number;
};
