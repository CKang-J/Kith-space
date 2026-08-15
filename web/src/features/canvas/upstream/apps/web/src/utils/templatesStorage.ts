/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/utils/templatesStorage.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Ownership / listing rules:
 * - `user` / `import` → show in Projects (mine / assets) — cloud-backed
 * - `case` → opened from plaza / inspiration / liked (session, memory only)
 * - `scratch` → blank / agent new canvas (session, memory only)
 *
 * First real edit claims `case` | `scratch` → `user` and then it syncs to Projects API.
 * Project library list is NOT in localStorage; per-project drafts use IndexedDB
 * (`projectPersistenceKey` / projectDraftStore).
 */
export type TemplateSource = 'user' | 'import' | 'case' | 'scratch';

/** In-memory library row (projects come from API; this is session/editor state). */
export type EditorLibraryItem = {
  id: string;
  name?: string;
  source?: TemplateSource;
  document?: unknown;
  originCaseId?: string;
  updatedAt?: number;
  openedAt?: number;
  thumbnail?: string | null;
  thumbnailCustom?: boolean;
};

/** Listed under Projects / Me assets — not mere open sessions. */
export function isOwnedTemplate(item: { source?: string } | null | undefined) {
  return Boolean(item && (item.source === 'user' || item.source === 'import'));
}

/** Temporary open that should not appear in Projects until claimed. */
export function isSessionTemplate(item: { source?: string } | null | undefined) {
  return Boolean(item && (item.source === 'case' || item.source === 'scratch'));
}

/** Always empty — projects come from GET /api/v1/projects. */
export function loadTemplates(): EditorLibraryItem[] {
  return [];
}

/** No-op — do not write project library to disk. */
export function saveTemplates(_templates?: unknown) {}
