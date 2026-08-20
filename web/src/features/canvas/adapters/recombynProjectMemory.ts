export type ProjectDraftRecord = {
  persistenceKey: string;
  projectId: string;
  name: string;
  document: unknown;
  updatedAt: number;
  contentHash: string;
  syncedAt: number | null;
  cloudRevision?: number | null;
  baseDocument?: unknown | null;
};
export type ProjectSessionCamera = { x: number; y: number; zoom: number };
export type ProjectSessionRecord = {
  persistenceKey: string;
  projectId: string;
  camera: ProjectSessionCamera;
  selectedNodeIds: string[];
  selectedFrameIds: string[];
  isGridMode?: boolean;
  updatedAt: number;
};
export type ProjectDocumentPatch = Record<string, unknown>;

const drafts = new Map<string, ProjectDraftRecord>();
const sessions = new Map<string, ProjectSessionRecord>();
export const projectPersistenceKey = (id: string) => `rcb-project:${String(id).trim()}`;
export const projectSessionKey = (id: string) => `rcb-session:${String(id).trim()}`;
export function hashDocument(document: unknown): string {
  const value = JSON.stringify(document) ?? "";
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return `${(hash >>> 0).toString(36)}:${value.length}`;
}
export function buildProjectDocumentPatch(base: unknown, next: unknown) {
  return JSON.stringify(base) === JSON.stringify(next) ? null : { patch: {}, preferFull: true };
}
export async function putProjectDraft(input: Omit<ProjectDraftRecord, "persistenceKey" | "contentHash" | "updatedAt" | "syncedAt"> & {
  updatedAt?: number; syncedAt?: number | null; keepSyncedAt?: boolean; keepCloudRevision?: boolean; keepBaseDocument?: boolean;
}): Promise<ProjectDraftRecord | null> {
  const projectId = String(input.projectId || "").trim();
  if (!projectId || input.document == null) return null;
  const previous = drafts.get(projectId);
  const record: ProjectDraftRecord = {
    persistenceKey: projectPersistenceKey(projectId), projectId, name: input.name || "Untitled",
    document: input.document, updatedAt: input.updatedAt || Date.now(), contentHash: hashDocument(input.document),
    syncedAt: input.keepSyncedAt ? previous?.syncedAt ?? null : input.syncedAt ?? null,
    cloudRevision: input.keepCloudRevision ? previous?.cloudRevision ?? null : input.cloudRevision ?? null,
    baseDocument: input.keepBaseDocument ? previous?.baseDocument ?? previous?.document ?? null : input.baseDocument ?? null,
  };
  drafts.set(projectId, record);
  return record;
}
export async function getProjectDraft(id: string) { return drafts.get(String(id).trim()) ?? null; }
export async function markProjectDraftSynced(id: string, contentHash: string, revision?: number | null) {
  const draft = drafts.get(id); if (draft?.contentHash === contentHash) drafts.set(id, { ...draft, syncedAt: Date.now(), cloudRevision: revision ?? null, baseDocument: draft.document });
}
export async function deleteProjectDraft(id: string) { drafts.delete(id); sessions.delete(id); }
export async function deleteProjectDrafts(ids: string[]) { for (const id of ids) await deleteProjectDraft(id); }
export async function clearAllProjectDrafts() { drafts.clear(); sessions.clear(); }
export async function putProjectSession(input: Omit<ProjectSessionRecord, "persistenceKey" | "updatedAt">) {
  const record = { ...input, persistenceKey: projectSessionKey(input.projectId), updatedAt: Date.now() };
  sessions.set(input.projectId, record); return record;
}
export async function getProjectSession(id: string) { return sessions.get(String(id).trim()) ?? null; }
