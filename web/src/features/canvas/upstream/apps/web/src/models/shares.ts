/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/models/shares.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Share / directory DTOs — HTTP via `apiClient.shares*` / `usersUsers*`.
 */

export type SharePermission = 'preview' | 'download' | 'edit';

export type ShareDto = {
  id: string;
  ownerId?: string;
  name: string;
  permission: SharePermission;
  document?: unknown;
  editorUserIds?: string[];
  viewerUserIds?: string[];
  linkEnabled?: boolean;
  linkPublic?: boolean;
  viewerCanView?: boolean;
  viewerCanEdit?: boolean;
  sourceProjectId?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type DirectoryUser = {
  id: string;
  name: string;
  email: string;
  avatar?: string | null;
};
