import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { dbForSpace, schema, type SpaceDb } from "../db/index.js";
import { EpisodicMemoryService } from "./episodicMemoryService.js";

const STATUS_VALUES = ["proposed", "active", "superseded", "archived", "rejected"] as const;
const KIND_VALUES = ["preference", "fact", "decision", "relationship", "habit", "open_loop", "procedure"] as const;
const SCOPE_VALUES = ["agent_private", "space_shared"] as const;

function enumValue<T extends readonly string[]>(value: string | null | undefined, values: T): T[number] | undefined {
  return value && values.includes(value as T[number]) ? value as T[number] : undefined;
}

/** Human management/read model. Search and pagination remain server-owned; the browser never downloads all memories to filter. */
export class MemoryManagementService {
  private readonly memories: EpisodicMemoryService;

  constructor(private readonly spaceId: string, private readonly db: SpaceDb = dbForSpace(spaceId), private readonly now: () => number = Date.now) {
    this.memories = new EpisodicMemoryService(spaceId, db);
  }

  list(input: {
    ownerAgentId?: string;
    query?: string;
    status?: string;
    kind?: string;
    scope?: string;
    tag?: string;
    sourceSurfaceId?: string;
    sourceAccessRevoked?: boolean;
    updatedAfter?: number;
    updatedBefore?: number;
    page?: number;
    pageSize?: number;
  }) {
    const conditions = [eq(schema.episodicMemories.spaceId, this.spaceId)];
    if (input.ownerAgentId) conditions.push(sql`(${schema.episodicMemories.ownerAgentId} = ${input.ownerAgentId} OR ${schema.episodicMemories.scope} = 'space_shared')`);
    const status = enumValue(input.status, STATUS_VALUES);
    const kind = enumValue(input.kind, KIND_VALUES);
    const scope = enumValue(input.scope, SCOPE_VALUES);
    if (status) conditions.push(eq(schema.episodicMemories.status, status));
    if (kind) conditions.push(eq(schema.episodicMemories.kind, kind));
    if (scope) conditions.push(eq(schema.episodicMemories.scope, scope));
    if (input.sourceAccessRevoked) conditions.push(inArray(schema.episodicMemories.sourceAccess, ["revoked", "unavailable", "deleted"]));
    if (Number.isFinite(input.updatedAfter)) conditions.push(sql`${schema.episodicMemories.updatedAt} >= ${new Date(input.updatedAfter!)}`);
    if (Number.isFinite(input.updatedBefore)) conditions.push(sql`${schema.episodicMemories.updatedAt} <= ${new Date(input.updatedBefore!)}`);
    if (input.tag) conditions.push(sql`EXISTS (SELECT 1 FROM memory_tags mt WHERE mt.memory_id = ${schema.episodicMemories.id} AND mt.tag = ${input.tag})`);
    if (input.sourceSurfaceId) conditions.push(sql`EXISTS (SELECT 1 FROM memory_evidence me WHERE me.memory_id = ${schema.episodicMemories.id} AND me.source_surface_id = ${input.sourceSurfaceId})`);
    const query = input.query?.trim();
    if (query) {
      const escaped = `%${query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      conditions.push(sql`(
        ${schema.episodicMemoryRevisions.canonicalText} LIKE ${escaped} ESCAPE '\\'
        OR coalesce(${schema.episodicMemoryRevisions.internalSummary}, '') LIKE ${escaped} ESCAPE '\\'
        OR coalesce(${schema.episodicMemoryRevisions.shareableSummary}, '') LIKE ${escaped} ESCAPE '\\'
        OR ${schema.episodicMemories.subjectKey} LIKE ${escaped} ESCAPE '\\'
        OR ${schema.episodicMemories.predicateKey} LIKE ${escaped} ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM memory_tags mt WHERE mt.memory_id = ${schema.episodicMemories.id} AND mt.tag LIKE ${escaped} ESCAPE '\\')
      )`);
    }
    const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 25));
    const page = Math.max(1, input.page ?? 1);
    const base = this.db.select({ id: schema.episodicMemories.id }).from(schema.episodicMemories)
      .innerJoin(schema.episodicMemoryRevisions, and(
        eq(schema.episodicMemoryRevisions.memoryId, schema.episodicMemories.id),
        eq(schema.episodicMemoryRevisions.revision, schema.episodicMemories.currentRevision),
      )).where(and(...conditions));
    const ids = base.orderBy(desc(schema.episodicMemories.updatedAt)).limit(pageSize).offset((page - 1) * pageSize).all();
    const totalRow = this.db.select({ value: sql<number>`count(*)` }).from(schema.episodicMemories)
      .innerJoin(schema.episodicMemoryRevisions, and(
        eq(schema.episodicMemoryRevisions.memoryId, schema.episodicMemories.id),
        eq(schema.episodicMemoryRevisions.revision, schema.episodicMemories.currentRevision),
      )).where(and(...conditions)).get();
    return {
      items: ids.map(({ id }) => this.summary(id, input.ownerAgentId)),
      page,
      pageSize,
      total: Number(totalRow?.value ?? 0),
    };
  }

  detail(memoryId: string, ownerAgentId?: string) {
    if (ownerAgentId) this.memories.hasSourceAccess(memoryId, ownerAgentId);
    const detail = this.memories.getHumanDetail(memoryId);
    const proposal = this.db.select().from(schema.memoryAdvisorProposals).where(eq(schema.memoryAdvisorProposals.memoryId, memoryId)).get();
    const advisorJob = proposal?.jobId ? this.db.select().from(schema.memoryAdvisorJobs)
      .where(eq(schema.memoryAdvisorJobs.id, proposal.jobId)).get() : null;
    const recalls = this.db.select().from(schema.memoryRecallObservations)
      .where(eq(schema.memoryRecallObservations.memoryId, memoryId)).orderBy(desc(schema.memoryRecallObservations.recalledAt)).all();
    return { ...detail, proposal: proposal ?? null, advisorJob: advisorJob ?? null, recalls };
  }

  private summary(memoryId: string, ownerAgentId?: string) {
    if (ownerAgentId) this.memories.hasSourceAccess(memoryId, ownerAgentId);
    const record = this.memories.getHuman(memoryId);
    const proposal = this.db.select().from(schema.memoryAdvisorProposals).where(eq(schema.memoryAdvisorProposals.memoryId, memoryId)).get();
    const recall = this.db.select().from(schema.memoryRecallObservations).where(eq(schema.memoryRecallObservations.memoryId, memoryId))
      .orderBy(desc(schema.memoryRecallObservations.recalledAt)).limit(1).get();
    const replacement = record.memory.status === "superseded"
      ? this.db.select().from(schema.memoryRelations).where(and(
          eq(schema.memoryRelations.fromMemoryId, memoryId),
          inArray(schema.memoryRelations.relationType, ["supersedes", "contradicts"]),
        )).orderBy(desc(schema.memoryRelations.createdAt)).limit(1).get()
      : null;
    return {
      ...record,
      evidenceCount: record.evidence.length,
      proposal: proposal ?? null,
      lastRecall: recall ?? null,
      replacement: replacement ? { memoryId: replacement.toMemoryId, relationType: replacement.relationType } : null,
      inContinuityBundle: record.memory.status === "active"
        && record.memory.sourceAccess === "available"
        && (!record.memory.validFrom || record.memory.validFrom.getTime() <= this.now())
        && (!record.memory.validTo || record.memory.validTo.getTime() > this.now())
        && ["preference", "relationship", "habit"].includes(record.memory.kind),
    };
  }
}
