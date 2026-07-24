import type {
  AdvisorJob,
  MemoryItem,
  MemoryRevisionMutationAction,
  MemoryRevisionMutationPayload,
  MemoryStatus,
} from "./types.ts";

export const MEMORY_KINDS = ["", "preference", "fact", "decision", "relationship", "habit", "open_loop", "procedure"] as const;
export const MEMORY_SCOPES = ["", "agent_private", "space_shared"] as const;

export function statusForTab(tab: "active" | "proposals" | "archived"): MemoryStatus {
  if (tab === "proposals") return "proposed";
  if (tab === "archived") return "archived";
  return "active";
}

export function memoryListPath(input: {
  agentId: string;
  status: MemoryStatus;
  query: string;
  kind: string;
  scope: string;
  sourceAccessRevoked: boolean;
  page: number;
  pageSize: number;
}): string {
  const params = new URLSearchParams({
    ownerAgentId: input.agentId,
    status: input.status,
    page: String(input.page),
    pageSize: String(input.pageSize),
  });
  if (input.query.trim()) params.set("q", input.query.trim());
  if (input.kind) params.set("kind", input.kind);
  if (input.scope) params.set("scope", input.scope);
  if (input.sourceAccessRevoked) params.set("sourceAccessRevoked", "true");
  return `/api/memories?${params}`;
}

export function memoryFreshness(item: Pick<MemoryItem, "memory" | "lastRecall">): "revoked" | "fresh" | "never" {
  if (item.memory.sourceAccess !== "available") return "revoked";
  return item.lastRecall?.recalledAt ? "fresh" : "never";
}

export function normalizedConfidence(value: number): number {
  return value > 1 ? value / 1_000 : value;
}

export function uniqueKey(prefix: string): string {
  return `${prefix}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}:${Math.random()}`}`;
}

export function hasPendingAdvisorJobs(jobs: Pick<AdvisorJob, "status">[]): boolean {
  return jobs.some((job) => job.status === "queued" || job.status === "running");
}

export function memoryEvidencePath(input: {
  slug: string;
  sourceKind: string;
  sourceId: string;
  sourceSurfaceId?: string | null;
  sourceAccess: string;
}): string | null {
  if (input.sourceKind !== "message" || input.sourceAccess !== "available" || !input.sourceSurfaceId) return null;
  return `/s/${encodeURIComponent(input.slug)}/channel/${encodeURIComponent(input.sourceSurfaceId)}?msg=${encodeURIComponent(input.sourceId)}`;
}

export interface MemoryRevisionDraft {
  canonicalText: string;
  internalSummary: string;
  shareableSummary: string;
  replacementMemoryId: string;
  relationType: "" | "supersedes" | "contradicts";
}

export function revisionDraftIssue(
  action: MemoryRevisionMutationAction,
  draft: MemoryRevisionDraft,
): "canonical_required" | "relation_pair_required" | null {
  if (!draft.canonicalText.trim()) return "canonical_required";
  if (action === "correct" && Boolean(draft.replacementMemoryId.trim()) !== Boolean(draft.relationType)) {
    return "relation_pair_required";
  }
  return null;
}

export function revisionMutationPayload(
  action: MemoryRevisionMutationAction,
  draft: MemoryRevisionDraft,
): MemoryRevisionMutationPayload {
  const payload: MemoryRevisionMutationPayload = {
    canonicalText: draft.canonicalText.trim(),
    internalSummary: draft.internalSummary.trim() || null,
    shareableSummary: draft.shareableSummary.trim() || null,
  };
  if (action === "correct" && draft.replacementMemoryId.trim() && draft.relationType) {
    payload.replacementMemoryId = draft.replacementMemoryId.trim();
    payload.relationType = draft.relationType;
  }
  return payload;
}
