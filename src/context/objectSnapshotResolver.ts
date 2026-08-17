import type { SpaceDb } from "../db/index.js";
import type { ContextSourceRefSchema } from "./contracts.js";
import type { z } from "zod";

export interface ContextObjectRef {
  type: string;
  id: string;
  revision?: number;
}

export interface ResolvedContextObject {
  sourceKind: string;
  sourceId: string;
  sourceRevision: number | null;
  payload: Record<string, unknown>;
  reason: string;
  visibility: z.infer<typeof ContextSourceRefSchema>["visibility"];
  disclosureProjection: z.infer<typeof ContextSourceRefSchema>["disclosureProjection"];
}

export interface ContextObjectSnapshotResolver {
  type: string;
  resolve(input: {
    spaceId: string;
    turnId: string;
    agentId: string;
    surfaceId: string;
    refs: ContextObjectRef[];
    messageIds: string[];
    db: SpaceDb;
    now: number;
  }): ResolvedContextObject[];
}

const resolvers = new Map<string, ContextObjectSnapshotResolver>();

export function registerContextObjectSnapshotResolver(resolver: ContextObjectSnapshotResolver): void {
  resolvers.set(resolver.type, resolver);
}

export function contextObjectSnapshotResolvers(): ContextObjectSnapshotResolver[] {
  return [...resolvers.values()];
}

export function collectBoundObjectRefs(
  snapshots: Array<Record<string, unknown> | null | undefined>,
): ContextObjectRef[] {
  const refs: ContextObjectRef[] = [];
  const seen = new Set<string>();
  for (const snapshot of snapshots) {
    const rawRefs = Array.isArray(snapshot?.openObjectRefs) ? snapshot.openObjectRefs : [];
    for (const entry of rawRefs) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const ref = entry as Record<string, unknown>;
      if (typeof ref.type !== "string" || typeof ref.id !== "string") continue;
      const key = `${ref.type}:${ref.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({
        type: ref.type,
        id: ref.id,
        revision: typeof ref.revision === "number" ? ref.revision : undefined,
      });
    }
  }
  return refs;
}
