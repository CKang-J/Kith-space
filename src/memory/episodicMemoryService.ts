import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { hasAgentSurfaceAccessInTransaction } from "../channels/agentSurfaceAccess.js";
import { estimateContextTokens } from "../context/contextBudget.js";
import { dbForSpace, purgeDeletedSpaceContent, schema, spaceRecord, type SpaceDb } from "../db/index.js";
import type { SpaceTransaction } from "../counters.js";
import {
  CreateEpisodicMemoryCommandSchema,
  MemoryMutationCommandSchema,
  type ActorRef,
  type CreateEpisodicMemoryCommand,
  type MemoryEvidenceInput,
  type MemoryMutationCommand,
} from "./contracts.js";
import { disclosureProjection, type DisclosureProjection } from "./disclosurePolicy.js";
import { projectLexicalText } from "./lexicalProjection.js";
import { canonicalJson, claimHmac, memoryHmac } from "./memoryIntegrity.js";
import { containsSecretShapedText } from "./secretDetection.js";

export type MemoryErrorCode =
  | "MEMORY_NOT_FOUND"
  | "MEMORY_FORBIDDEN"
  | "MEMORY_INVALID"
  | "MEMORY_CONFLICT"
  | "MEMORY_SUPPRESSED";

export class MemoryError extends Error {
  constructor(public readonly code: MemoryErrorCode, message: string) {
    super(message);
    this.name = "MemoryError";
  }
}

const RevisionPayloadSchema = z.object({
  canonicalText: z.string().min(1).max(16_000).optional(),
  internalSummary: z.string().min(1).max(4_000).nullable().optional(),
  shareableSummary: z.string().min(1).max(4_000).nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  importance: z.number().min(0).max(1).optional(),
  sensitivity: z.enum(["normal", "private", "secret"]).optional(),
  disclosure: z.enum(["internal_use", "shareable_summary", "explicit_only"]).optional(),
  validFrom: z.number().int().nonnegative().nullable().optional(),
  validTo: z.number().int().nonnegative().nullable().optional(),
  tags: z.array(z.string().min(1).max(128)).max(64).optional(),
  replacementMemoryId: z.string().min(1).optional(),
  relationType: z.enum(["supersedes", "contradicts"]).optional(),
}).strict().superRefine((value, context) => {
  if (Boolean(value.replacementMemoryId) !== Boolean(value.relationType)) {
    context.addIssue({ code: "custom", message: "replacementMemoryId and relationType must be provided together" });
  }
});

type MemoryRow = typeof schema.episodicMemories.$inferSelect;
type RevisionRow = typeof schema.episodicMemoryRevisions.$inferSelect;
type EvidenceRow = typeof schema.memoryEvidence.$inferSelect;

export interface MemoryRecord {
  memory: MemoryRow;
  revision: RevisionRow;
  evidence: EvidenceRow[];
  tags: string[];
}

export interface RecalledMemory {
  memoryId: string;
  memoryRevision: number;
  contentHash: string;
  score: number;
  scoreBreakdown: MemoryScoreBreakdown;
  reasons: string[];
  evidenceRefs: Array<{ sourceKind: string; sourceId: string }>;
  disclosure: "internal_use" | "shareable_summary" | "explicit_only";
  relation?: { type: "supersedes" | "contradicts" | "confirms" | "derived_from"; replacementId?: string };
  projection: DisclosureProjection;
  content: string | null;
}

export interface MemoryScoreBreakdown {
  lexical: number;
  continuity: number;
  importance: number;
  recency: number;
}

function humanOnly(actor: ActorRef): void {
  if (actor.type !== "human") throw new MemoryError("MEMORY_FORBIDDEN", "only the Human can mutate episodic memory");
}

function millis(value: number): number {
  return Math.round(value * 1_000);
}

function publicEvidence(row: EvidenceRow): Pick<MemoryEvidenceInput, "sourceSurfaceId" | "visibilityAtOccurrence"> {
  return {
    sourceSurfaceId: row.sourceSurfaceId,
    visibilityAtOccurrence: row.visibilityAtOccurrence as MemoryEvidenceInput["visibilityAtOccurrence"],
  };
}

/** Workspace-owned episodic memory. user_global is intentionally handled by app.db, never a Space DB. */
export class EpisodicMemoryService {
  constructor(
    private readonly spaceId: string,
    private readonly db: SpaceDb = dbForSpace(spaceId),
    private readonly now: () => number = Date.now,
  ) {}

  create(raw: CreateEpisodicMemoryCommand): MemoryRecord {
    const command = CreateEpisodicMemoryCommandSchema.parse(raw);
    humanOnly(command.actor);
    if (command.scope === "user_global") throw new MemoryError("MEMORY_INVALID", "user_global memory belongs in app.db");
    const workspaceScope: "agent_private" | "space_shared" = command.scope;
    if (command.sensitivity === "secret") throw new MemoryError("MEMORY_INVALID", "secret content cannot be stored as episodic memory");
    if (containsSecretShapedText([
      command.canonicalText, command.internalSummary, command.shareableSummary,
      ...command.evidence.map((item) => item.excerpt),
    ])) throw new MemoryError("MEMORY_INVALID", "credential-shaped content cannot be stored as episodic memory");
    if ((command.scope === "agent_private") !== Boolean(command.ownerAgentId)) {
      throw new MemoryError("MEMORY_INVALID", "agent_private requires an owner and space_shared forbids one");
    }
    if (command.evidence.some((item) => item.sourceSpaceId && item.sourceSpaceId !== this.spaceId)) {
      throw new MemoryError("MEMORY_INVALID", "workspace memory evidence cannot claim another Space as its source");
    }
    if (command.evidence.some((item) => item.memoryPolicy === "exclude")) {
      throw new MemoryError("MEMORY_FORBIDDEN", "memory-excluded evidence cannot produce episodic memory");
    }
    const requestHash = memoryHmac(command);
    const id = this.db.transaction((tx) => {
      const replay = tx.select().from(schema.memoryMutations).where(and(
        eq(schema.memoryMutations.actor, command.actor),
        eq(schema.memoryMutations.idempotencyKey, command.idempotencyKey),
      )).get();
      if (replay) {
        if (replay.requestHash !== requestHash) throw new MemoryError("MEMORY_CONFLICT", "idempotency key was reused with different input");
        const memoryId = typeof replay.resultRef?.memoryId === "string" ? replay.resultRef.memoryId : null;
        if (!memoryId) throw new MemoryError("MEMORY_CONFLICT", "idempotent create result is unavailable");
        return memoryId;
      }

      const authoritativeEvidence = this.authoritativeEvidence(tx, command.evidence);
      const fingerprint = claimHmac(command);
      for (const evidence of authoritativeEvidence) {
        const suppression = tx.select({ id: schema.memorySuppressions.id }).from(schema.memorySuppressions).where(and(
          eq(schema.memorySuppressions.scope, command.scope),
          command.ownerAgentId
            ? eq(schema.memorySuppressions.ownerAgentId, command.ownerAgentId)
            : isNull(schema.memorySuppressions.ownerAgentId),
          eq(schema.memorySuppressions.sourceKind, evidence.sourceKind),
          eq(schema.memorySuppressions.sourceId, evidence.sourceId),
          eq(schema.memorySuppressions.claimHmac, fingerprint),
          eq(schema.memorySuppressions.status, "active"),
        )).get();
        if (suppression) throw new MemoryError("MEMORY_SUPPRESSED", "forgotten evidence and claim cannot be re-created");
      }

      const memoryId = randomUUID();
      const createdAt = new Date(this.now());
      tx.insert(schema.episodicMemories).values({
        id: memoryId,
        spaceId: this.spaceId,
        ownerAgentId: command.ownerAgentId,
        scope: workspaceScope,
        kind: command.kind,
        subjectRef: command.subjectRef,
        subjectKey: command.subjectKey,
        predicateKey: command.predicateKey,
        status: command.status,
        confidence: millis(command.confidence),
        importance: millis(command.importance),
        sensitivity: command.sensitivity,
        disclosure: command.disclosure,
        validFrom: command.validFrom == null ? null : new Date(command.validFrom),
        validTo: command.validTo == null ? null : new Date(command.validTo),
        createdBy: command.actor,
        updatedBy: command.actor,
        createdAt,
        updatedAt: createdAt,
      }).run();
      this.insertRevision(tx, memoryId, 1, command, command.actor, createdAt);
      tx.insert(schema.memoryEvidence).values(authoritativeEvidence.map((evidence) => ({
        id: randomUUID(),
        memoryId,
        memoryRevision: 1,
        sourceSpaceId: this.spaceId,
        sourceKind: evidence.sourceKind,
        sourceId: evidence.sourceId,
        sourceSurfaceId: evidence.sourceSurfaceId,
        visibilityAtOccurrence: evidence.visibilityAtOccurrence,
        assertedBy: evidence.assertedBy,
        quotedFrom: evidence.quotedFrom,
        claimType: evidence.claimType,
        memoryPolicy: evidence.memoryPolicy,
        excerptHmac: memoryHmac({ sourceKind: evidence.sourceKind, sourceId: evidence.sourceId, excerpt: evidence.excerpt }),
        occurredAt: new Date(evidence.occurredAt),
      }))).run();
      this.replaceProjection(tx, memoryId, command, command.tags);
      tx.insert(schema.memoryMutations).values({
        id: randomUUID(), memoryId, action: "create", idempotencyKey: command.idempotencyKey,
        requestHash, resultRef: { memoryId, revision: 1 }, actor: command.actor, createdAt,
      }).run();
      return memoryId;
    });
    return this.getHuman(id);
  }

  mutate(raw: MemoryMutationCommand, actor: ActorRef): MemoryRecord | { memoryId: string; deleted: true; suppressed: boolean } {
    const command = MemoryMutationCommandSchema.parse(raw);
    humanOnly(actor);
    const requestHash = memoryHmac({ command, actor });
    const result = this.db.transaction((tx) => {
      const replay = tx.select().from(schema.memoryMutations).where(and(
        eq(schema.memoryMutations.actor, actor),
        eq(schema.memoryMutations.idempotencyKey, command.idempotencyKey),
      )).get();
      if (replay) {
        if (replay.requestHash !== requestHash) throw new MemoryError("MEMORY_CONFLICT", "idempotency key was reused with different input");
        return replay.resultRef ?? { memoryId: command.memoryId };
      }
      const memory = tx.select().from(schema.episodicMemories).where(and(
        eq(schema.episodicMemories.id, command.memoryId),
        eq(schema.episodicMemories.spaceId, this.spaceId),
      )).get();
      if (!memory) throw new MemoryError("MEMORY_NOT_FOUND", "memory does not exist");
      if (memory.currentRevision !== command.expectedRevision) {
        throw new MemoryError("MEMORY_CONFLICT", `expected revision ${command.expectedRevision}, found ${memory.currentRevision}`);
      }
      const revision = tx.select().from(schema.episodicMemoryRevisions).where(and(
        eq(schema.episodicMemoryRevisions.memoryId, memory.id),
        eq(schema.episodicMemoryRevisions.revision, memory.currentRevision),
      )).get();
      if (!revision) throw new MemoryError("MEMORY_CONFLICT", "current memory revision is missing");
      const createdAt = new Date(this.now());
      let resultRef: Record<string, unknown>;
      if (command.action === "delete" || command.action === "forget_suppress") {
        const suppressed = command.action === "forget_suppress";
        if (suppressed) {
          const fingerprint = claimHmac({
            scope: memory.scope, ownerAgentId: memory.ownerAgentId, subjectKey: memory.subjectKey,
            predicateKey: memory.predicateKey, canonicalText: revision.canonicalText,
          });
          const evidence = tx.select().from(schema.memoryEvidence).where(eq(schema.memoryEvidence.memoryId, memory.id)).all();
          for (const item of evidence) {
            const existing = tx.select({ id: schema.memorySuppressions.id }).from(schema.memorySuppressions).where(and(
              eq(schema.memorySuppressions.scope, memory.scope),
              memory.ownerAgentId ? eq(schema.memorySuppressions.ownerAgentId, memory.ownerAgentId) : isNull(schema.memorySuppressions.ownerAgentId),
              eq(schema.memorySuppressions.sourceKind, item.sourceKind),
              eq(schema.memorySuppressions.sourceId, item.sourceId),
              eq(schema.memorySuppressions.claimHmac, fingerprint),
            )).get();
            if (existing) {
              tx.update(schema.memorySuppressions).set({
                status: "active", revokedAt: null, createdBy: actor, createdAt,
              }).where(eq(schema.memorySuppressions.id, existing.id)).run();
            } else {
              tx.insert(schema.memorySuppressions).values({
                id: randomUUID(), scope: memory.scope, ownerAgentId: memory.ownerAgentId,
                sourceKind: item.sourceKind, sourceId: item.sourceId, claimHmac: fingerprint,
                status: "active", createdBy: actor, createdAt,
              }).run();
            }
          }
        }
        tx.run(sql`DELETE FROM memory_fts WHERE memory_id = ${memory.id}`);
        tx.delete(schema.episodicMemories).where(eq(schema.episodicMemories.id, memory.id)).run();
        resultRef = { memoryId: memory.id, deleted: true, suppressed };
      } else {
        const payload = RevisionPayloadSchema.parse(command.payload);
        if (command.action !== "correct" && payload.replacementMemoryId) {
          throw new MemoryError("MEMORY_INVALID", "replacement relations are valid only for correction");
        }
        const nextSensitivity = payload.sensitivity ?? revision.sensitivity;
        if (nextSensitivity === "secret") throw new MemoryError("MEMORY_INVALID", "secret content cannot be stored as episodic memory");
        if (containsSecretShapedText([
          payload.canonicalText,
          payload.internalSummary,
          payload.shareableSummary,
        ])) throw new MemoryError("MEMORY_INVALID", "credential-shaped content cannot be stored as episodic memory");
        const nextRevision = memory.currentRevision + 1;
        const next = {
          canonicalText: payload.canonicalText ?? revision.canonicalText,
          internalSummary: payload.internalSummary === undefined ? revision.internalSummary : payload.internalSummary,
          shareableSummary: payload.shareableSummary === undefined ? revision.shareableSummary : payload.shareableSummary,
          sensitivity: nextSensitivity,
          disclosure: payload.disclosure ?? revision.disclosure,
          validFrom: payload.validFrom === undefined ? revision.validFrom?.getTime() ?? null : payload.validFrom,
          validTo: payload.validTo === undefined ? revision.validTo?.getTime() ?? null : payload.validTo,
        };
        tx.insert(schema.episodicMemoryRevisions).values({
          memoryId: memory.id, revision: nextRevision, canonicalText: next.canonicalText,
          internalSummary: next.internalSummary, shareableSummary: next.shareableSummary,
          contentHmac: memoryHmac(next), sensitivity: next.sensitivity, disclosure: next.disclosure,
          validFrom: next.validFrom == null ? null : new Date(next.validFrom),
          validTo: next.validTo == null ? null : new Date(next.validTo),
          createdBy: actor, createdAt,
        }).run();
        let replacement: MemoryRow | undefined;
        if (command.action === "correct" && payload.replacementMemoryId) {
          replacement = tx.select().from(schema.episodicMemories).where(and(
            eq(schema.episodicMemories.id, payload.replacementMemoryId),
            eq(schema.episodicMemories.spaceId, this.spaceId),
            eq(schema.episodicMemories.status, "active"),
          )).get();
          if (!replacement || replacement.id === memory.id || replacement.scope !== memory.scope
            || replacement.ownerAgentId !== memory.ownerAgentId) {
            throw new MemoryError("MEMORY_INVALID", "replacement memory must be an active item in the same scope");
          }
          tx.insert(schema.memoryRelations).values({
            id: randomUUID(), fromMemoryId: memory.id, fromRevision: nextRevision,
            toMemoryId: replacement.id, toRevision: replacement.currentRevision,
            relationType: payload.relationType!, createdBy: actor, createdAt,
          }).run();
        } else if (command.action === "correct") {
          tx.insert(schema.memoryRelations).values({
            id: randomUUID(),
            fromMemoryId: memory.id,
            fromRevision: memory.currentRevision,
            toMemoryId: memory.id,
            toRevision: nextRevision,
            relationType: "supersedes",
            createdBy: actor,
            createdAt,
          }).run();
        }
        const status = replacement ? "superseded"
          : command.action === "archive" ? "archived"
          : command.action === "restore" ? "active"
          : command.action === "reject" ? "rejected"
          : "active";
        tx.update(schema.episodicMemories).set({
          currentRevision: nextRevision,
          status,
          confidence: payload.confidence === undefined ? memory.confidence : millis(payload.confidence),
          importance: payload.importance === undefined ? memory.importance : millis(payload.importance),
          sensitivity: next.sensitivity,
          disclosure: next.disclosure,
          validFrom: next.validFrom == null ? null : new Date(next.validFrom),
          validTo: next.validTo == null ? null : new Date(next.validTo),
          rowVersion: memory.rowVersion + 1,
          updatedBy: actor,
          updatedAt: createdAt,
        }).where(eq(schema.episodicMemories.id, memory.id)).run();
        const tags = payload.tags ?? tx.select({ tag: schema.memoryTags.tag }).from(schema.memoryTags)
          .where(eq(schema.memoryTags.memoryId, memory.id)).all().map((item) => item.tag);
        this.replaceProjection(tx, memory.id, {
          ...next,
          subjectKey: memory.subjectKey,
          predicateKey: memory.predicateKey,
        }, tags);
        resultRef = { memoryId: memory.id, revision: nextRevision };
      }
      tx.insert(schema.memoryMutations).values({
        id: randomUUID(), memoryId: memory.id, action: command.action,
        idempotencyKey: command.idempotencyKey, requestHash, resultRef, actor, createdAt,
      }).run();
      return resultRef;
    });
    if (result.deleted === true) {
      purgeDeletedSpaceContent(this.spaceId);
      return result as { memoryId: string; deleted: true; suppressed: boolean };
    }
    return this.getHuman(String(result.memoryId));
  }

  getHuman(memoryId: string): MemoryRecord {
    const memory = this.db.select().from(schema.episodicMemories).where(and(
      eq(schema.episodicMemories.id, memoryId), eq(schema.episodicMemories.spaceId, this.spaceId),
    )).get();
    if (!memory) throw new MemoryError("MEMORY_NOT_FOUND", "memory does not exist");
    const revision = this.db.select().from(schema.episodicMemoryRevisions).where(and(
      eq(schema.episodicMemoryRevisions.memoryId, memory.id),
      eq(schema.episodicMemoryRevisions.revision, memory.currentRevision),
    )).get();
    if (!revision) throw new MemoryError("MEMORY_NOT_FOUND", "memory revision does not exist");
    return {
      memory,
      revision,
      evidence: this.db.select().from(schema.memoryEvidence).where(eq(schema.memoryEvidence.memoryId, memory.id)).all(),
      tags: this.db.select({ tag: schema.memoryTags.tag }).from(schema.memoryTags)
        .where(eq(schema.memoryTags.memoryId, memory.id)).all().map((item) => item.tag),
    };
  }

  getHumanDetail(memoryId: string) {
    const record = this.getHuman(memoryId);
    const revisions = this.db.select().from(schema.episodicMemoryRevisions)
      .where(eq(schema.episodicMemoryRevisions.memoryId, memoryId))
      .orderBy(desc(schema.episodicMemoryRevisions.revision)).all();
    const relations = this.db.select().from(schema.memoryRelations).where(or(
      eq(schema.memoryRelations.fromMemoryId, memoryId),
      eq(schema.memoryRelations.toMemoryId, memoryId),
    )).orderBy(desc(schema.memoryRelations.createdAt)).all();
    return { ...record, revisionHistory: revisions, relations };
  }

  listSuppressions(input: { scope?: "agent_private" | "space_shared"; ownerAgentId?: string } = {}) {
    const conditions = [];
    if (input.scope) conditions.push(eq(schema.memorySuppressions.scope, input.scope));
    if (input.ownerAgentId) conditions.push(eq(schema.memorySuppressions.ownerAgentId, input.ownerAgentId));
    return this.db.select().from(schema.memorySuppressions)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.memorySuppressions.createdAt)).limit(500).all();
  }

  revokeSuppression(suppressionId: string, actor: ActorRef) {
    humanOnly(actor);
    const updated = this.db.update(schema.memorySuppressions).set({ status: "revoked", revokedAt: new Date(this.now()) })
      .where(and(eq(schema.memorySuppressions.id, suppressionId), eq(schema.memorySuppressions.status, "active")))
      .returning().get();
    if (!updated) throw new MemoryError("MEMORY_NOT_FOUND", "active suppression does not exist");
    return updated;
  }

  listHuman(input: { scope?: "agent_private" | "space_shared"; ownerAgentId?: string; status?: string } = {}): MemoryRecord[] {
    const conditions = [eq(schema.episodicMemories.spaceId, this.spaceId)];
    if (input.scope) conditions.push(eq(schema.episodicMemories.scope, input.scope));
    if (input.ownerAgentId) conditions.push(eq(schema.episodicMemories.ownerAgentId, input.ownerAgentId));
    if (input.status) conditions.push(eq(schema.episodicMemories.status, input.status));
    return this.db.select({ id: schema.episodicMemories.id }).from(schema.episodicMemories)
      .where(and(...conditions)).orderBy(desc(schema.episodicMemories.updatedAt)).limit(500).all()
      .map(({ id }) => this.getHuman(id));
  }

  getForAgent(memoryId: string, agentId: string, targetSurfaceId: string): RecalledMemory {
    const record = this.getHuman(memoryId);
    if (record.memory.status === "superseded") {
      const pointer = this.db.select().from(schema.memoryRelations).where(and(
        eq(schema.memoryRelations.fromMemoryId, memoryId),
        eq(schema.memoryRelations.fromRevision, record.memory.currentRevision),
        inArray(schema.memoryRelations.relationType, ["supersedes", "contradicts"]),
      )).orderBy(desc(schema.memoryRelations.createdAt)).get();
      if (!pointer) throw new MemoryError("MEMORY_NOT_FOUND", "superseded memory has no replacement");
      return {
        ...this.getForAgent(pointer.toMemoryId, agentId, targetSurfaceId),
        reasons: ["explicit_get", "replacement"],
        relation: { type: pointer.relationType as "supersedes" | "contradicts", replacementId: pointer.toMemoryId },
      };
    }
    if (record.memory.status !== "active" || !this.isCurrentlyValid(record.memory)
      || ["deleted", "unavailable"].includes(record.memory.sourceAccess)) {
      throw new MemoryError("MEMORY_NOT_FOUND", "memory is not active");
    }
    if (record.memory.scope === "agent_private" && record.memory.ownerAgentId !== agentId) {
      throw new MemoryError("MEMORY_FORBIDDEN", "agent-private memory belongs to another Agent");
    }
    const resolved = this.resolveEvidence(record.evidence, agentId);
    this.persistSourceAccess(record.memory, resolved.state);
    if (resolved.state !== "available") throw new MemoryError("MEMORY_FORBIDDEN", "memory source is no longer accessible");
    return this.project(record, resolved.evidence, targetSurfaceId, {
      lexical: 1, continuity: 0, importance: 0, recency: 0,
    }, ["explicit_get"]);
  }

  hasSourceAccess(memoryId: string, agentId: string): boolean {
    return this.db.transaction((tx) => this.hasSourceAccessInTransaction(tx, memoryId, agentId));
  }

  hasSourceAccessInTransaction(tx: SpaceTransaction, memoryId: string, agentId: string): boolean {
    const memory = tx.select().from(schema.episodicMemories).where(and(
      eq(schema.episodicMemories.id, memoryId),
      eq(schema.episodicMemories.spaceId, this.spaceId),
    )).get();
    if (!memory || memory.status !== "active" || !this.isCurrentlyValid(memory)
      || (memory.scope === "agent_private" && memory.ownerAgentId !== agentId)) {
      return false;
    }
    const evidence = tx.select().from(schema.memoryEvidence).where(eq(schema.memoryEvidence.memoryId, memory.id)).all();
    const resolved = this.resolveEvidenceInTransaction(tx, evidence, agentId);
    if (memory.sourceAccess !== resolved.state) {
      tx.update(schema.episodicMemories).set({ sourceAccess: resolved.state, updatedAt: new Date(this.now()) })
        .where(eq(schema.episodicMemories.id, memory.id)).run();
    }
    return resolved.state === "available";
  }

  revisionContent(memoryId: string, revision: number, projection: DisclosureProjection): string | null {
    const row = this.db.select().from(schema.episodicMemoryRevisions).where(and(
      eq(schema.episodicMemoryRevisions.memoryId, memoryId),
      eq(schema.episodicMemoryRevisions.revision, revision),
    )).get();
    if (!row) return null;
    return projection === "canonical" ? row.canonicalText
      : projection === "internal_summary" ? row.internalSummary
      : projection === "shareable_summary" ? row.shareableSummary
      : null;
  }

  recall(input: { agentId: string; targetSurfaceId: string; query?: string; includeContinuity?: boolean }): RecalledMemory[] {
    const query = projectLexicalText(input.query ?? "");
    const lexicalIds = new Map<string, number>();
    const matchTokens = [query.lexicalText, query.cjkBigrams, query.cjkTrigrams].flatMap((part) => part.split(/\s+/)).filter(Boolean);
    if (matchTokens.length) {
      const match = [...new Set(matchTokens)].map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
      try {
        const rows = this.db.all(sql`SELECT memory_id AS memoryId, bm25(memory_fts) AS rank FROM memory_fts WHERE memory_fts MATCH ${match} ORDER BY rank LIMIT 64`) as Array<{ memoryId: string; rank: number }>;
        rows.forEach((row) => lexicalIds.set(row.memoryId, Math.max(0, 1 / (1 + Math.abs(Number(row.rank))))));
      } catch {
        // FTS is an optional query accelerator; continuity and exact lookup remain available.
      }
    }
    const queryCharacters = [...query.normalizedText];
    const exactQueryTerms = queryCharacters.length > 0 && queryCharacters.length <= 2 && !/\s/u.test(query.normalizedText)
      ? [query.normalizedText]
      : [];
    if (exactQueryTerms.length) {
      const exact = this.db.select({ memoryId: schema.memoryLexicalTerms.memoryId }).from(schema.memoryLexicalTerms)
        .where(inArray(schema.memoryLexicalTerms.term, exactQueryTerms)).all();
      exact.forEach((row) => lexicalIds.set(row.memoryId, Math.max(lexicalIds.get(row.memoryId) ?? 0, 0.8)));
    }
    const eligibility = and(
      eq(schema.episodicMemories.spaceId, this.spaceId),
      or(isNull(schema.episodicMemories.validFrom), lte(schema.episodicMemories.validFrom, new Date(this.now()))),
      or(isNull(schema.episodicMemories.validTo), gt(schema.episodicMemories.validTo, new Date(this.now()))),
      inArray(schema.episodicMemories.sourceAccess, ["available", "revoked"]),
      or(
        and(eq(schema.episodicMemories.scope, "agent_private"), eq(schema.episodicMemories.ownerAgentId, input.agentId)),
        eq(schema.episodicMemories.scope, "space_shared"),
      ),
    );
    const lexicalRows = lexicalIds.size
      ? this.db.select().from(schema.episodicMemories).where(and(
          eligibility,
          inArray(schema.episodicMemories.status, ["active", "superseded"]),
          inArray(schema.episodicMemories.id, [...lexicalIds.keys()]),
        )).all()
      : [];
    const continuityRows = input.includeContinuity === false
      ? []
      : this.db.select().from(schema.episodicMemories).where(and(
          eligibility,
          eq(schema.episodicMemories.status, "active"),
          inArray(schema.episodicMemories.kind, ["preference", "relationship", "habit"]),
        )).orderBy(desc(schema.episodicMemories.updatedAt)).limit(128).all();
    const candidates = [...new Map([...lexicalRows, ...continuityRows].map((row) => [row.id, row])).values()];
    const records = candidates.map((memory) => this.getHuman(memory.id));
    const recalled: RecalledMemory[] = [];
    for (const candidate of records) {
      let record = candidate;
      let relation: RecalledMemory["relation"];
      if (candidate.memory.status === "superseded") {
        const pointer = this.db.select().from(schema.memoryRelations).where(and(
          eq(schema.memoryRelations.fromMemoryId, candidate.memory.id),
          eq(schema.memoryRelations.fromRevision, candidate.memory.currentRevision),
          inArray(schema.memoryRelations.relationType, ["supersedes", "contradicts"]),
        )).orderBy(desc(schema.memoryRelations.createdAt)).get();
        if (!pointer) continue;
        try {
          record = this.getHuman(pointer.toMemoryId);
        } catch {
          continue;
        }
        if (record.memory.status !== "active" || !this.isCurrentlyValid(record.memory)
          || (record.memory.scope === "agent_private" && record.memory.ownerAgentId !== input.agentId)) continue;
        relation = { type: pointer.relationType as "supersedes" | "contradicts", replacementId: record.memory.id };
      }
      const resolved = this.resolveEvidence(record.evidence, input.agentId);
      this.persistSourceAccess(record.memory, resolved.state);
      if (resolved.state !== "available") continue;
      const lexical = lexicalIds.get(candidate.memory.id) ?? lexicalIds.get(record.memory.id) ?? 0;
      const continuity = ["preference", "relationship", "habit"].includes(record.memory.kind) ? 0.25 : 0;
      const recency = Math.max(0, 1 - ((this.now() - record.memory.updatedAt.getTime()) / (180 * 86_400_000)));
      const scoreBreakdown = {
        lexical: lexical * 0.55,
        continuity,
        importance: (record.memory.importance / 1_000) * 0.15,
        recency: recency * 0.05,
      };
      recalled.push(this.project(record, resolved.evidence, input.targetSurfaceId, scoreBreakdown, [
        ...(lexical ? ["query"] : []),
        ...(continuity ? ["continuity"] : []),
        ...(relation ? ["replacement"] : []),
      ], relation));
    }
    recalled.sort((a, b) => b.score - a.score || a.memoryId.localeCompare(b.memoryId));
    const byMemory = new Map<string, RecalledMemory>();
    for (const item of recalled) if (!byMemory.has(item.memoryId)) byMemory.set(item.memoryId, item);
    const deduplicated = [...byMemory.values()];
    const selected: RecalledMemory[] = [];
    let continuityCount = 0;
    let queryCount = 0;
    let continuityTokens = 0;
    let queryTokens = 0;
    for (const item of deduplicated) {
      const tokens = item.content ? estimateContextTokens(item.content) : 0;
      const continuity = item.reasons.includes("continuity") && !item.reasons.includes("query");
      if (continuity) {
        if (continuityCount >= 12 || continuityTokens + tokens > 2_000) continue;
        continuityCount += 1;
        continuityTokens += tokens;
      } else {
        if (queryCount >= 8 || queryTokens + tokens > 4_000) continue;
        queryCount += 1;
        queryTokens += tokens;
      }
      selected.push(item);
    }
    return selected;
  }

  /** Rebuilds only live canonical rows; forgotten text has been deleted and suppressions remain authoritative. */
  reindex(): number {
    const records = this.db.select({ id: schema.episodicMemories.id }).from(schema.episodicMemories)
      .where(eq(schema.episodicMemories.spaceId, this.spaceId)).all();
    this.db.transaction((tx) => {
      tx.run(sql`DELETE FROM memory_fts`);
      tx.delete(schema.memoryLexicalTerms).run();
      for (const { id } of records) {
        const record = this.getHuman(id);
        this.replaceProjection(tx, id, {
          ...record.revision,
          subjectKey: record.memory.subjectKey,
          predicateKey: record.memory.predicateKey,
        }, record.tags);
      }
    });
    return records.length;
  }

  private resolveEvidence(evidence: EvidenceRow[], agentId: string): {
    evidence: EvidenceRow[];
    state: "available" | "revoked" | "unavailable" | "deleted";
  } {
    return this.db.transaction((tx) => this.resolveEvidenceInTransaction(tx, evidence, agentId));
  }

  private resolveEvidenceInTransaction(tx: SpaceTransaction, evidence: EvidenceRow[], agentId: string): {
    evidence: EvidenceRow[];
    state: "available" | "revoked" | "unavailable" | "deleted";
  } {
    let failure: "revoked" | "unavailable" | "deleted" | null = null;
    const available = evidence.filter((item) => {
      if (item.sourceKind === "file") {
        const root = spaceRecord(this.spaceId)?.rootPath;
        const sourcePath = root ? path.resolve(root, item.sourceId) : null;
        const relative = root && sourcePath ? path.relative(path.resolve(root), sourcePath) : "..";
        const exists = Boolean(sourcePath && relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative) && existsSync(sourcePath));
        if (!exists) failure = "deleted";
        return exists;
      }
      if (!item.sourceSurfaceId) {
        const allowed = item.sourceKind === "manual" || item.visibilityAtOccurrence === "local_file";
        if (!allowed) failure ??= "unavailable";
        return allowed;
      }
      if (item.sourceKind === "message") {
        const source = tx.select({ channelId: schema.messages.channelId }).from(schema.messages).where(and(
          eq(schema.messages.id, item.sourceId),
          eq(schema.messages.spaceId, this.spaceId),
        )).get();
        if (!source || source.channelId !== item.sourceSurfaceId) {
          failure = "deleted";
          return false;
        }
      } else if (item.sourceKind === "turn") {
        const turn = tx.select({ runtimeSessionId: schema.agentTurns.runtimeSessionId }).from(schema.agentTurns).where(and(
          eq(schema.agentTurns.id, item.sourceId), eq(schema.agentTurns.spaceId, this.spaceId),
        )).get();
        const sourceSession = turn ? tx.select({ surfaceId: schema.runtimeSessions.surfaceId }).from(schema.runtimeSessions)
          .where(eq(schema.runtimeSessions.id, turn.runtimeSessionId)).get() : null;
        if (!sourceSession || sourceSession.surfaceId !== item.sourceSurfaceId) {
          failure = "deleted";
          return false;
        }
      }
      const allowed = hasAgentSurfaceAccessInTransaction(tx, {
        spaceId: this.spaceId, channelId: item.sourceSurfaceId, agentId, now: this.now(),
      });
      if (!allowed && failure !== "deleted") failure = "revoked";
      return allowed;
    });
    if (!evidence.length) return { evidence: [], state: "unavailable" };
    return available.length === evidence.length
      ? { evidence: available, state: "available" }
      : { evidence: [], state: failure ?? "unavailable" };
  }

  private authoritativeEvidence(
    tx: Parameters<Parameters<SpaceDb["transaction"]>[0]>[0],
    evidence: MemoryEvidenceInput[],
  ): MemoryEvidenceInput[] {
    return evidence.map((item) => {
      if (item.sourceKind === "file") {
        const root = spaceRecord(this.spaceId)?.rootPath;
        const sourcePath = root ? path.resolve(root, item.sourceId) : null;
        const relative = root && sourcePath ? path.relative(path.resolve(root), sourcePath) : "..";
        if (!sourcePath || relative === "" || relative.startsWith("..") || path.isAbsolute(relative) || !existsSync(sourcePath)) {
          throw new MemoryError("MEMORY_INVALID", "file evidence is outside the Space or unavailable");
        }
        return { ...item, sourceSpaceId: this.spaceId, sourceSurfaceId: null, visibilityAtOccurrence: "local_file" };
      }
      if (item.sourceKind === "turn") {
        const turn = tx.select().from(schema.agentTurns).where(and(
          eq(schema.agentTurns.id, item.sourceId), eq(schema.agentTurns.spaceId, this.spaceId),
        )).get();
        const session = turn ? tx.select().from(schema.runtimeSessions)
          .where(eq(schema.runtimeSessions.id, turn.runtimeSessionId)).get() : null;
        if (!session) throw new MemoryError("MEMORY_INVALID", "turn evidence does not match an authoritative source");
        return {
          ...item,
          sourceSpaceId: this.spaceId,
          sourceSurfaceId: session.surfaceId,
          visibilityAtOccurrence: this.surfaceVisibility(tx, session.surfaceId),
        };
      }
      if (item.sourceKind === "manual") {
        return { ...item, sourceSpaceId: this.spaceId, sourceSurfaceId: null, visibilityAtOccurrence: "local_file" };
      }
      if (!item.sourceSurfaceId) throw new MemoryError("MEMORY_INVALID", "message evidence requires a source surface");
      const message = tx.select().from(schema.messages).where(and(
        eq(schema.messages.id, item.sourceId),
        eq(schema.messages.spaceId, this.spaceId),
        eq(schema.messages.channelId, item.sourceSurfaceId),
      )).get();
      if (!message) throw new MemoryError("MEMORY_INVALID", "message evidence does not match an authoritative source");
      if (message.memoryPolicy === "exclude") {
        throw new MemoryError("MEMORY_FORBIDDEN", "memory-excluded source message cannot produce episodic memory");
      }
      if (message.memoryPolicy == null && item.memoryPolicy !== "human_manual") {
        throw new MemoryError("MEMORY_FORBIDDEN", "legacy message evidence requires an explicit Human import");
      }
      return {
        ...item,
        sourceSpaceId: this.spaceId,
        visibilityAtOccurrence: this.surfaceVisibility(tx, item.sourceSurfaceId),
        memoryPolicy: message.memoryPolicy ?? "human_manual",
      };
    });
  }

  private surfaceVisibility(
    tx: Parameters<Parameters<SpaceDb["transaction"]>[0]>[0],
    surfaceId: string,
  ): MemoryEvidenceInput["visibilityAtOccurrence"] {
    const channel = tx.select().from(schema.channels).where(and(
      eq(schema.channels.id, surfaceId), eq(schema.channels.spaceId, this.spaceId),
    )).get();
    if (!channel) throw new MemoryError("MEMORY_INVALID", "memory evidence surface does not exist");
    if (channel.type === "channel") return "public";
    if (channel.type === "dm") return "dm";
    if (channel.type !== "thread" || !channel.parentMessageId) return "private";
    const parent = tx.select({ channelId: schema.messages.channelId }).from(schema.messages)
      .where(eq(schema.messages.id, channel.parentMessageId)).get();
    return parent ? this.surfaceVisibility(tx, parent.channelId) : "private";
  }

  private persistSourceAccess(memory: MemoryRow, state: "available" | "revoked" | "unavailable" | "deleted"): void {
    if (memory.sourceAccess === state) return;
    this.db.update(schema.episodicMemories).set({ sourceAccess: state, updatedAt: new Date(this.now()) })
      .where(eq(schema.episodicMemories.id, memory.id)).run();
  }

  private isCurrentlyValid(memory: MemoryRow): boolean {
    return (memory.validFrom == null || memory.validFrom.getTime() <= this.now())
      && (memory.validTo == null || memory.validTo.getTime() > this.now());
  }

  private project(
    record: MemoryRecord,
    evidence: EvidenceRow[],
    targetSurfaceId: string,
    scoreBreakdown: MemoryScoreBreakdown,
    reasons: string[],
    relation?: RecalledMemory["relation"],
  ): RecalledMemory {
    const projection = disclosureProjection({
      disclosure: record.revision.disclosure as "internal_use" | "shareable_summary" | "explicit_only",
      targetSurfaceId,
      evidence: evidence.map(publicEvidence),
      hasInternalSummary: Boolean(record.revision.internalSummary),
      hasShareableSummary: Boolean(record.revision.shareableSummary),
    });
    const content = projection === "canonical" ? record.revision.canonicalText
      : projection === "internal_summary" ? record.revision.internalSummary
      : projection === "shareable_summary" ? record.revision.shareableSummary
      : null;
    return {
      memoryId: record.memory.id,
      memoryRevision: record.revision.revision,
      contentHash: record.revision.contentHmac,
      score: Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0),
      scoreBreakdown,
      reasons,
      evidenceRefs: evidence.map((item) => ({ sourceKind: item.sourceKind, sourceId: item.sourceId })),
      disclosure: record.revision.disclosure as RecalledMemory["disclosure"],
      ...(relation ? { relation } : {}),
      projection,
      content,
    };
  }

  private insertRevision(
    tx: Parameters<Parameters<SpaceDb["transaction"]>[0]>[0],
    memoryId: string,
    revision: number,
    value: Pick<CreateEpisodicMemoryCommand, "canonicalText" | "internalSummary" | "shareableSummary" | "sensitivity" | "disclosure" | "validFrom" | "validTo">,
    actor: ActorRef,
    createdAt: Date,
  ): void {
    tx.insert(schema.episodicMemoryRevisions).values({
      memoryId, revision, canonicalText: value.canonicalText, internalSummary: value.internalSummary,
      shareableSummary: value.shareableSummary, contentHmac: memoryHmac(value), sensitivity: value.sensitivity,
      disclosure: value.disclosure, validFrom: value.validFrom == null ? null : new Date(value.validFrom),
      validTo: value.validTo == null ? null : new Date(value.validTo), createdBy: actor, createdAt,
    }).run();
  }

  private replaceProjection(
    tx: Parameters<Parameters<SpaceDb["transaction"]>[0]>[0],
    memoryId: string,
    value: { canonicalText: string; internalSummary: string | null; shareableSummary: string | null; subjectKey: string; predicateKey: string },
    tags: string[],
  ): void {
    const normalizedTags = [...new Set(tags.map((tag) => projectLexicalText(tag).normalizedText).filter(Boolean))];
    const projection = projectLexicalText([
      value.canonicalText, value.internalSummary, value.shareableSummary, value.subjectKey, value.predicateKey, ...normalizedTags,
    ].filter((part): part is string => Boolean(part)).join(" "));
    tx.delete(schema.memoryTags).where(eq(schema.memoryTags.memoryId, memoryId)).run();
    tx.delete(schema.memoryLexicalTerms).where(eq(schema.memoryLexicalTerms.memoryId, memoryId)).run();
    tx.run(sql`DELETE FROM memory_fts WHERE memory_id = ${memoryId}`);
    if (normalizedTags.length) tx.insert(schema.memoryTags).values(normalizedTags.map((tag) => ({ memoryId, tag }))).run();
    if (projection.shortExactTerms.length) {
      tx.insert(schema.memoryLexicalTerms).values(projection.shortExactTerms.map((term) => ({ memoryId, term }))).run();
    }
    tx.run(sql`INSERT INTO memory_fts (memory_id, lexical_text, cjk_bigrams, cjk_trigrams)
      VALUES (${memoryId}, ${projection.lexicalText}, ${projection.cjkBigrams}, ${projection.cjkTrigrams})`);
  }
}
