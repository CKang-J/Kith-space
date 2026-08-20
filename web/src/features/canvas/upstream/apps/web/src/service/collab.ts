/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/service/collab.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Collab room tokens — API mints HMAC tokens; Node WS server verifies them.
 */

import { apiClient } from '@recombyn-native/service/client';
import type { CollabRoomToken } from '@recombyn-native/components/editor/collab/collabTypes';

export type MintCollabRoomTokenBody = {
  projectId?: string;
  shareId?: string;
};

export const mintCollabRoomTokenApi = (data: MintCollabRoomTokenBody) =>
  apiClient.collabCollabRoomToken({ body: data }) as Promise<CollabRoomToken>;
