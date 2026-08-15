/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/service/projects.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * User projects API — metadata + document sync (camera/selection stay local).
 */

import { apiClient, apiQuery, queryClient } from '@recombyn-native/service/client';

export type ProjectSummaryDto = {
  id: string;
  name: string;
  /** Team org when shared. */
  orgId?: string | null;
  orgName?: string | null;
  /** Up to 4 cover tiles for 最近打开 / 我的项目 collage. */
  thumbnailUrl?: string | string[] | null;
  /** User-uploaded cover — auto-save must not overwrite. */
  thumbnailCustom?: boolean;
  /** Optimistic concurrency token — send as baseRevision / If-Match on PUT. */
  revision?: number;
  updatedAt: number;
  createdAt: number;
  hasDocument?: boolean;
};

export type ProjectDto = ProjectSummaryDto & {
  document?: unknown;
};

export type PaginatedProjects = {
  projects: ProjectSummaryDto[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
};

export type UpsertProjectBody = {
  id?: string;
  name: string;
  document?: unknown;
  thumbnailDataUrl?: string | null;
  thumbnailDataUrls?: string[] | null;
  thumbnailUrls?: string[] | null;
  thumbnailCustom?: boolean;
  baseRevision?: number;
  /** Attach to team on create (requires org:project:write). */
  orgId?: string | null;
};

export type PatchProjectBody = {
  baseRevision: number;
  name?: string;
  thumbnailDataUrl?: string | null;
  thumbnailDataUrls?: string[] | null;
  thumbnailUrls?: string[] | null;
  thumbnailCustom?: boolean;
  upsertNodes?: Record<string, unknown>;
  removeNodeIds?: string[];
  pageChildren?: string[];
  frames?: unknown[];
  activeFrameId?: string | null;
  canvas?: Record<string, unknown>;
};

export const fetchProject = (id: string) =>
  apiClient.projectsGetOne({
    params: { project_id: id },
  }) as Promise<{ project: ProjectDto }>;

/** Ask server to rebuild ≤4 cover tiles from document elements (no revision bump). */
export async function extractProjectCoversApi(
  id: string,
  document?: unknown
): Promise<{ project: ProjectSummaryDto }> {
  return apiClient.projectsExtractCovers({
    params: { project_id: id },
    body: document != null ? { document: document as Record<string, unknown> } : undefined,
  }) as Promise<{ project: ProjectSummaryDto }>;
}

export async function upsertProjectApi(
  data: UpsertProjectBody,
  headers?: Record<string, string>
): Promise<{ project: ProjectSummaryDto }> {
  return apiClient.projectsUpsert({
    body: data as never,
    headers: headers?.['If-Match'] ? { 'If-Match': headers['If-Match'] } : undefined,
  }) as Promise<{ project: ProjectSummaryDto }>;
}

/** Node-level incremental sync — server merges under the same revision lock. */
export async function patchProjectApi(
  id: string,
  data: PatchProjectBody,
  headers?: Record<string, string>
): Promise<{ project: ProjectSummaryDto }> {
  return apiClient.projectsPatchOne({
    params: { project_id: id },
    body: data as never,
    headers: headers?.['If-Match'] ? { 'If-Match': headers['If-Match'] } : undefined,
  }) as Promise<{ project: ProjectSummaryDto }>;
}

export async function deleteProjectApi(id: string): Promise<{ ok: boolean }> {
  return apiQuery.projectsRemove.call({
    params: { project_id: id },
  }) as Promise<{ ok: boolean }>;
}

/** Attach / detach team org (no revision bump). */
export async function setProjectOrgApi(
  id: string,
  orgId: string | null
): Promise<{ project: ProjectSummaryDto }> {
  return apiClient.projectsSetProjectOrg({
    params: { project_id: id },
    body: { orgId },
  }) as Promise<{ project: ProjectSummaryDto }>;
}

/** Batch delete — one request for many project ids. */
export async function deleteProjectsApi(
  ids: string[]
): Promise<{ ok: boolean; deleted: number }> {
  return apiQuery.projectsBatchRemove.call({
    body: { ids },
  }) as Promise<{ ok: boolean; deleted: number }>;
}

/** Home / Mine list — Query is SoT; call after rename/delete/create. */
export async function invalidateProjectsListCache() {
  await queryClient.invalidateQueries({
    queryKey: apiQuery.projectsListMyProjects.key(),
  });
}

/** Drop cached list on logout / 401 (avoid leaking another account's pages). */
export function clearProjectsListCache() {
  queryClient.removeQueries({
    queryKey: apiQuery.projectsListMyProjects.key(),
  });
}
