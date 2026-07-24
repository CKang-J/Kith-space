import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { appDataConnection } from "../app-data/appDatabase.js";
import { hasAgentSurfaceAccessInTransaction } from "../channels/agentSurfaceAccess.js";
import { estimateContextTokens } from "../context/contextBudget.js";
import type { SpaceTransaction } from "../counters.js";
import { dbForSpace, schema, spaceRecord, type SpaceDb } from "../db/index.js";
import {
  CreateEpisodicMemoryCommandSchema,
  MemoryMutationCommandSchema,
  type ActorRef,
  type CreateEpisodicMemoryCommand,
  type MemoryEvidenceInput,
  type MemoryMutationCommand,
} from "./contracts.js";
import { disclosureProjection, type DisclosureProjection } from "./disclosurePolicy.js";
import { MemoryError, type MemoryScoreBreakdown } from "./episodicMemoryService.js";
import { projectLexicalText } from "./lexicalProjection.js";
import { canonicalJson, claimHmac, memoryHmac } from "./memoryIntegrity.js";
import { containsSecretShapedText } from "./secretDetection.js";

interface UserMemoryRow {
  id: string;
  scope: "user_global";
  kind: string;
  subject_ref_json: string;
  subject_key: string;
  predicate_key: string;
  current_revision: number;
  status: string;
  confidence_millis: number;
  importance_millis: number;
  sensitivity: string;
  disclosure: "internal_use" | "shareable_summary" | "explicit_only";
  relation?: { type: "supersedes" | "contradicts" | "confirms" | "derived_from"; replacementId?: string };
  valid_from: number | null;
  valid_to: number | null;
  source_access: string;
  deletion_state: string;
  row_version: number;
  created_by_json: string;
  updated_by_json: string;
  created_at: number;
  updated_at: number;
}

interface UserRevisionRow {
  memory_id: string;
  revision: number;
  canonical_text: string;
  internal_summary: string | null;
  shareable_summary: string | null;
  content_hmac: string;
  sensitivity: string;
  disclosure: "internal_use" | "shareable_summary" | "explicit_only";
  valid_from: number | null;
  valid_to: number | null;
  created_by_json: string;
  created_at: number;
}

interface UserEvidenceRow {
  id: string;
  memory_id: string;
  memory_revision: number;
  source_space_id: string | null;
  source_kind: string;
  source_id: string;
  source_surface_id: string | null;
  visibility_at_occurrence: "public" | "private" | "dm" | "local_file";
  asserted_by_json: string;
  quoted_from_json: string | null;
  claim_type: string;
  memory_policy: string;
  excerpt_hmac: string;
  occurred_at: number;
}

export interface UserGlobalMemoryRecord {
  memory: UserMemoryRow;
  revision: UserRevisionRow;
  evidence: UserEvidenceRow[];
  tags: string[];
}

export interface RecalledUserGlobalMemory {
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

function humanOnly(actor: ActorRef): void {
  if (actor.type !== "human") throw new MemoryError("MEMORY_FORBIDDEN", "only the Human can mutate user-global memory");
}

/** app.db-owned memory explicitly promoted by the Human. */
export class UserGlobalMemoryService {
  constructor(
    private readonly sqlite: Database.Database = appDataConnection(),
    private readonly now: () => number = Date.now,
  ) {
    this.sqlite.pragma("secure_delete = ON");
  }

  create(raw: CreateEpisodicMemoryCommand): UserGlobalMemoryRecord {
    const command = CreateEpisodicMemoryCommandSchema.parse(raw);
    humanOnly(command.actor);
    if (command.scope !== "user_global" || command.ownerAgentId !== null) {
      throw new MemoryError("MEMORY_INVALID", "user-global memory requires scope=user_global and no Agent owner");
    }
    if (command.sensitivity === "secret") throw new MemoryError("MEMORY_INVALID", "secret content cannot be stored as episodic memory");
    if (containsSecretShapedText([
      command.canonicalText, command.internalSummary, command.shareableSummary,
      ...command.evidence.map((item) => item.excerpt),
    ])) throw new MemoryError("MEMORY_INVALID", "credential-shaped content cannot be stored as episodic memory");
    if (command.evidence.some((item) => item.memoryPolicy !== "human_manual")) {
      throw new MemoryError("MEMORY_FORBIDDEN", "user-global memory must be manually promoted by the Human");
    }
    const authoritativeEvidence = this.authoritativeEvidence(command.evidence);
    const requestHash = memoryHmac(command);
    const create = this.sqlite.transaction(() => {
      const replay = this.sqlite.prepare(`SELECT request_hash, result_ref_json FROM user_memory_mutations WHERE actor_json = ? AND idempotency_key = ?`)
        .get(canonicalJson(command.actor), command.idempotencyKey) as { request_hash: string; result_ref_json: string | null } | undefined;
      if (replay) {
        if (replay.request_hash !== requestHash) throw new MemoryError("MEMORY_CONFLICT", "idempotency key was reused with different input");
        return String(JSON.parse(replay.result_ref_json ?? "{}").memoryId);
      }
      const fingerprint = claimHmac(command);
      for (const evidence of authoritativeEvidence) {
        const suppressed = this.sqlite.prepare(`
          SELECT 1 FROM user_memory_suppressions
          WHERE source_kind = ? AND source_id = ? AND claim_hmac = ? AND status = 'active'
        `).get(evidence.sourceKind, evidence.sourceId, fingerprint);
        if (suppressed) throw new MemoryError("MEMORY_SUPPRESSED", "forgotten evidence and claim cannot be re-created");
      }
      const id = randomUUID();
      const now = this.now();
      this.sqlite.prepare(`
        INSERT INTO user_episodic_memories (
          id, scope, kind, subject_ref_json, subject_key, predicate_key, current_revision, status,
          confidence_millis, importance_millis, sensitivity, disclosure, valid_from, valid_to,
          source_access, deletion_state, row_version, created_by_json, updated_by_json, created_at, updated_at
        ) VALUES (?, 'user_global', ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 'available', 'none', 1, ?, ?, ?, ?)
      `).run(id, command.kind, canonicalJson(command.subjectRef), command.subjectKey, command.predicateKey, command.status,
        Math.round(command.confidence * 1_000), Math.round(command.importance * 1_000), command.sensitivity, command.disclosure,
        command.validFrom, command.validTo, canonicalJson(command.actor), canonicalJson(command.actor), now, now);
      this.sqlite.prepare(`
        INSERT INTO user_episodic_memory_revisions (
          memory_id, revision, canonical_text, internal_summary, shareable_summary, content_hmac,
          sensitivity, disclosure, valid_from, valid_to, created_by_json, created_at
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, command.canonicalText, command.internalSummary, command.shareableSummary, memoryHmac(command),
        command.sensitivity, command.disclosure, command.validFrom, command.validTo, canonicalJson(command.actor), now);
      const insertEvidence = this.sqlite.prepare(`
        INSERT INTO user_memory_evidence (
          id, memory_id, memory_revision, source_space_id, source_kind, source_id, source_surface_id,
          visibility_at_occurrence, asserted_by_json, quoted_from_json, claim_type, memory_policy, excerpt_hmac, occurred_at
        ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const evidence of authoritativeEvidence) insertEvidence.run(
        randomUUID(), id, evidence.sourceSpaceId, evidence.sourceKind, evidence.sourceId, evidence.sourceSurfaceId,
        evidence.visibilityAtOccurrence, canonicalJson(evidence.assertedBy), evidence.quotedFrom ? canonicalJson(evidence.quotedFrom) : null,
        evidence.claimType, evidence.memoryPolicy, memoryHmac({ sourceKind: evidence.sourceKind, sourceId: evidence.sourceId, excerpt: evidence.excerpt }), evidence.occurredAt,
      );
      this.replaceProjection(id, command, command.tags);
      this.sqlite.prepare(`
        INSERT INTO user_memory_mutations (id, memory_id, action, idempotency_key, request_hash, result_ref_json, actor_json, created_at)
        VALUES (?, ?, 'create', ?, ?, ?, ?, ?)
      `).run(randomUUID(), id, command.idempotencyKey, requestHash, canonicalJson({ memoryId: id, revision: 1 }), canonicalJson(command.actor), now);
      return id;
    });
    return this.getHuman(create.immediate());
  }

  mutate(raw: MemoryMutationCommand, actor: ActorRef): UserGlobalMemoryRecord | { memoryId: string; deleted: true; suppressed: boolean } {
    const command = MemoryMutationCommandSchema.parse(raw);
    humanOnly(actor);
    if (command.action === "retain_independent") {
      throw new MemoryError("MEMORY_INVALID", "retain_independent is only available for Space-owned memory");
    }
    const requestHash = memoryHmac({ command, actor });
    const operation = this.sqlite.transaction(() => {
      const replay = this.sqlite.prepare(`SELECT request_hash, result_ref_json FROM user_memory_mutations WHERE actor_json = ? AND idempotency_key = ?`)
        .get(canonicalJson(actor), command.idempotencyKey) as { request_hash: string; result_ref_json: string | null } | undefined;
      if (replay) {
        if (replay.request_hash !== requestHash) throw new MemoryError("MEMORY_CONFLICT", "idempotency key was reused with different input");
        return JSON.parse(replay.result_ref_json ?? "{}");
      }
      const memory = this.sqlite.prepare("SELECT * FROM user_episodic_memories WHERE id = ?").get(command.memoryId) as UserMemoryRow | undefined;
      if (!memory) throw new MemoryError("MEMORY_NOT_FOUND", "memory does not exist");
      if (memory.current_revision !== command.expectedRevision) throw new MemoryError("MEMORY_CONFLICT", `expected revision ${command.expectedRevision}, found ${memory.current_revision}`);
      const revision = this.sqlite.prepare("SELECT * FROM user_episodic_memory_revisions WHERE memory_id = ? AND revision = ?")
        .get(memory.id, memory.current_revision) as UserRevisionRow | undefined;
      if (!revision) throw new MemoryError("MEMORY_CONFLICT", "current memory revision is missing");
      const now = this.now();
      let result: Record<string, unknown>;
      if (command.action === "delete" || command.action === "forget_suppress") {
        const suppressed = command.action === "forget_suppress";
        if (suppressed) {
          const fingerprint = claimHmac({ scope: "user_global", ownerAgentId: null, subjectKey: memory.subject_key, predicateKey: memory.predicate_key, canonicalText: revision.canonical_text, subjectRef: JSON.parse(memory.subject_ref_json) });
          const evidence = this.sqlite.prepare("SELECT source_kind, source_id FROM user_memory_evidence WHERE memory_id = ?").all(memory.id) as Array<{ source_kind: string; source_id: string }>;
          const insert = this.sqlite.prepare(`
            INSERT INTO user_memory_suppressions (id, source_kind, source_id, claim_hmac, status, created_by_json, created_at)
            VALUES (?, ?, ?, ?, 'active', ?, ?)
            ON CONFLICT(source_kind, source_id, claim_hmac) DO UPDATE SET
              status = 'active', revoked_at = NULL, created_by_json = excluded.created_by_json, created_at = excluded.created_at
          `);
          for (const item of evidence) insert.run(randomUUID(), item.source_kind, item.source_id, fingerprint, canonicalJson(actor), now);
        }
        this.sqlite.prepare("DELETE FROM user_memory_fts WHERE memory_id = ?").run(memory.id);
        this.sqlite.prepare("DELETE FROM user_episodic_memories WHERE id = ?").run(memory.id);
        result = { memoryId: memory.id, deleted: true, suppressed };
      } else {
        const payload = RevisionPayloadSchema.parse(command.payload);
        if (command.action !== "correct" && payload.replacementMemoryId) {
          throw new MemoryError("MEMORY_INVALID", "replacement relations are valid only for correction");
        }
        const sensitivity = payload.sensitivity ?? revision.sensitivity;
        if (sensitivity === "secret") throw new MemoryError("MEMORY_INVALID", "secret content cannot be stored as episodic memory");
        if (containsSecretShapedText([
          payload.canonicalText,
          payload.internalSummary,
          payload.shareableSummary,
        ])) throw new MemoryError("MEMORY_INVALID", "credential-shaped content cannot be stored as episodic memory");
        const next = {
          canonicalText: payload.canonicalText ?? revision.canonical_text,
          internalSummary: payload.internalSummary === undefined ? revision.internal_summary : payload.internalSummary,
          shareableSummary: payload.shareableSummary === undefined ? revision.shareable_summary : payload.shareableSummary,
          sensitivity,
          disclosure: payload.disclosure ?? revision.disclosure,
          validFrom: payload.validFrom === undefined ? revision.valid_from : payload.validFrom,
          validTo: payload.validTo === undefined ? revision.valid_to : payload.validTo,
        };
        const revisionNumber = memory.current_revision + 1;
        this.sqlite.prepare(`
          INSERT INTO user_episodic_memory_revisions (
            memory_id, revision, canonical_text, internal_summary, shareable_summary, content_hmac,
            sensitivity, disclosure, valid_from, valid_to, created_by_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(memory.id, revisionNumber, next.canonicalText, next.internalSummary, next.shareableSummary,
          memoryHmac(next), next.sensitivity, next.disclosure, next.validFrom, next.validTo, canonicalJson(actor), now);
        let replacement: UserMemoryRow | undefined;
        if (command.action === "correct" && payload.replacementMemoryId) {
          replacement = this.sqlite.prepare("SELECT * FROM user_episodic_memories WHERE id = ? AND status = 'active'")
            .get(payload.replacementMemoryId) as UserMemoryRow | undefined;
          if (!replacement || replacement.id === memory.id) {
            throw new MemoryError("MEMORY_INVALID", "replacement memory must be another active user-global item");
          }
          this.sqlite.prepare(`
            INSERT INTO user_memory_relations (
              id, from_memory_id, from_revision, to_memory_id, to_revision, relation_type, created_by_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(randomUUID(), memory.id, revisionNumber, replacement.id, replacement.current_revision,
            payload.relationType, canonicalJson(actor), now);
        } else if (command.action === "correct") {
          this.sqlite.prepare(`
            INSERT INTO user_memory_relations (
              id, from_memory_id, from_revision, to_memory_id, to_revision, relation_type, created_by_json, created_at
            ) VALUES (?, ?, ?, ?, ?, 'supersedes', ?, ?)
          `).run(randomUUID(), memory.id, memory.current_revision, memory.id, revisionNumber, canonicalJson(actor), now);
        }
        const status = replacement ? "superseded"
          : command.action === "archive" ? "archived"
          : command.action === "restore" ? "active"
          : command.action === "reject" ? "rejected" : "active";
        this.sqlite.prepare(`
          UPDATE user_episodic_memories SET current_revision = ?, status = ?, confidence_millis = ?, importance_millis = ?,
            sensitivity = ?, disclosure = ?, valid_from = ?, valid_to = ?, row_version = row_version + 1,
            updated_by_json = ?, updated_at = ? WHERE id = ?
        `).run(revisionNumber, status,
          payload.confidence === undefined ? memory.confidence_millis : Math.round(payload.confidence * 1_000),
          payload.importance === undefined ? memory.importance_millis : Math.round(payload.importance * 1_000),
          next.sensitivity, next.disclosure, next.validFrom, next.validTo, canonicalJson(actor), now, memory.id);
        const tags = payload.tags ?? (this.sqlite.prepare("SELECT tag FROM user_memory_tags WHERE memory_id = ?").all(memory.id) as Array<{ tag: string }>).map((item) => item.tag);
        this.replaceProjection(memory.id, { ...next, subjectKey: memory.subject_key, predicateKey: memory.predicate_key }, tags);
        result = { memoryId: memory.id, revision: revisionNumber };
      }
      this.sqlite.prepare(`
        INSERT INTO user_memory_mutations (id, memory_id, action, idempotency_key, request_hash, result_ref_json, actor_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), memory.id, command.action, command.idempotencyKey, requestHash, canonicalJson(result), canonicalJson(actor), now);
      return result;
    });
    const result = operation.immediate() as Record<string, unknown>;
    if (result.deleted === true) {
      const checkpoint = this.sqlite.pragma("wal_checkpoint(TRUNCATE)") as Array<{ busy: number }>;
      if (checkpoint.some((row) => row.busy !== 0)) throw new Error("app database privacy checkpoint is busy");
      return result as { memoryId: string; deleted: true; suppressed: boolean };
    }
    return this.getHuman(String(result.memoryId));
  }

  getHuman(memoryId: string): UserGlobalMemoryRecord {
    const memory = this.sqlite.prepare("SELECT * FROM user_episodic_memories WHERE id = ?").get(memoryId) as UserMemoryRow | undefined;
    if (!memory) throw new MemoryError("MEMORY_NOT_FOUND", "memory does not exist");
    const revision = this.sqlite.prepare("SELECT * FROM user_episodic_memory_revisions WHERE memory_id = ? AND revision = ?")
      .get(memory.id, memory.current_revision) as UserRevisionRow | undefined;
    if (!revision) throw new MemoryError("MEMORY_NOT_FOUND", "memory revision does not exist");
    return {
      memory,
      revision,
      evidence: this.sqlite.prepare("SELECT * FROM user_memory_evidence WHERE memory_id = ? ORDER BY occurred_at, id").all(memory.id) as UserEvidenceRow[],
      tags: (this.sqlite.prepare("SELECT tag FROM user_memory_tags WHERE memory_id = ? ORDER BY tag").all(memory.id) as Array<{ tag: string }>).map((item) => item.tag),
    };
  }

  getHumanDetail(memoryId: string) {
    const record = this.getHuman(memoryId);
    const revisionHistory = this.sqlite.prepare(`
      SELECT * FROM user_episodic_memory_revisions WHERE memory_id = ? ORDER BY revision DESC
    `).all(memoryId) as UserRevisionRow[];
    const relations = this.sqlite.prepare(`
      SELECT * FROM user_memory_relations WHERE from_memory_id = ? OR to_memory_id = ? ORDER BY created_at DESC
    `).all(memoryId, memoryId);
    return { ...record, revisionHistory, relations };
  }

  listSuppressions() {
    return this.sqlite.prepare("SELECT * FROM user_memory_suppressions ORDER BY created_at DESC LIMIT 500").all();
  }

  revokeSuppression(suppressionId: string, actor: ActorRef) {
    humanOnly(actor);
    const updated = this.sqlite.prepare(`
      UPDATE user_memory_suppressions SET status = 'revoked', revoked_at = ? WHERE id = ? AND status = 'active'
    `).run(this.now(), suppressionId);
    if (!updated.changes) throw new MemoryError("MEMORY_NOT_FOUND", "active suppression does not exist");
    return this.sqlite.prepare("SELECT * FROM user_memory_suppressions WHERE id = ?").get(suppressionId);
  }

  listHuman(status?: string): UserGlobalMemoryRecord[] {
    const rows = status
      ? this.sqlite.prepare("SELECT id FROM user_episodic_memories WHERE status = ? ORDER BY updated_at DESC LIMIT 500").all(status)
      : this.sqlite.prepare("SELECT id FROM user_episodic_memories ORDER BY updated_at DESC LIMIT 500").all();
    return (rows as Array<{ id: string }>).map(({ id }) => this.getHuman(id));
  }

  getForAgent(memoryId: string, currentSpaceId: string, agentId: string, targetSurfaceId: string): RecalledUserGlobalMemory {
    const record = this.getHuman(memoryId);
    if (record.memory.status === "superseded") {
      const pointer = this.sqlite.prepare(`
        SELECT to_memory_id, relation_type FROM user_memory_relations
        WHERE from_memory_id = ? AND from_revision = ? AND relation_type IN ('supersedes', 'contradicts')
        ORDER BY created_at DESC LIMIT 1
      `).get(memoryId, record.memory.current_revision) as { to_memory_id: string; relation_type: "supersedes" | "contradicts" } | undefined;
      if (!pointer) throw new MemoryError("MEMORY_NOT_FOUND", "superseded memory has no replacement");
      return {
        ...this.getForAgent(pointer.to_memory_id, currentSpaceId, agentId, targetSurfaceId),
        reasons: ["explicit_get", "replacement", "user_global"],
        relation: { type: pointer.relation_type, replacementId: pointer.to_memory_id },
      };
    }
    if (record.memory.status !== "active" || !this.isCurrentlyValid(record.memory)) {
      throw new MemoryError("MEMORY_NOT_FOUND", "memory is not active");
    }
    const resolved = this.resolveEvidence(record.evidence, currentSpaceId, agentId);
    this.persistSourceAccess(record.memory.id, record.memory.source_access, resolved.state);
    if (resolved.state !== "available") throw new MemoryError("MEMORY_FORBIDDEN", "memory source is no longer accessible");
    const selected = disclosureProjection({
      disclosure: record.revision.disclosure,
      targetSurfaceId,
      evidence: resolved.evidence.map((item) => ({ sourceSurfaceId: item.source_surface_id, visibilityAtOccurrence: item.visibility_at_occurrence })),
      hasInternalSummary: Boolean(record.revision.internal_summary),
      hasShareableSummary: Boolean(record.revision.shareable_summary),
    });
    return {
      memoryId: record.memory.id,
      memoryRevision: record.revision.revision,
      contentHash: record.revision.content_hmac,
      score: 1,
      scoreBreakdown: { lexical: 1, continuity: 0, importance: 0, recency: 0 },
      reasons: ["explicit_get", "user_global"],
      evidenceRefs: resolved.evidence.map((item) => ({ sourceKind: item.source_kind, sourceId: item.source_id })),
      disclosure: record.revision.disclosure,
      projection: selected,
      content: selected === "canonical" ? record.revision.canonical_text
        : selected === "internal_summary" ? record.revision.internal_summary
        : selected === "shareable_summary" ? record.revision.shareable_summary : null,
    };
  }

  recall(input: { currentSpaceId: string; agentId: string; targetSurfaceId: string; query: string; includeContinuity?: boolean }): RecalledUserGlobalMemory[] {
    const projection = projectLexicalText(input.query);
    const tokens = [projection.lexicalText, projection.cjkBigrams, projection.cjkTrigrams]
      .flatMap((value) => value.split(/\s+/)).filter(Boolean);
    const lexicalIds = new Map<string, number>();
    if (tokens.length) {
      const match = [...new Set(tokens)].map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
      try {
        const rows = this.sqlite.prepare(`
          SELECT memory_id AS id, bm25(user_memory_fts) AS rank
          FROM user_memory_fts WHERE user_memory_fts MATCH ? ORDER BY rank LIMIT 64
        `).all(match) as Array<{ id: string; rank: number }>;
        rows.forEach((row) => lexicalIds.set(row.id, Math.max(0, 1 / (1 + Math.abs(Number(row.rank))))));
      } catch {
        // FTS is an optional query accelerator; continuity and exact lookup remain available.
      }
    }
    const exactTerms = [...projection.normalizedText].length > 0 && [...projection.normalizedText].length <= 2
      && !/\s/u.test(projection.normalizedText) ? [projection.normalizedText] : [];
    if (exactTerms.length) {
      const rows = this.sqlite.prepare("SELECT memory_id AS id FROM user_memory_lexical_terms WHERE term = ?").all(exactTerms[0]) as Array<{ id: string }>;
      rows.forEach((row) => lexicalIds.set(row.id, Math.max(lexicalIds.get(row.id) ?? 0, 0.8)));
    }
    const now = this.now();
    const liveSql = "source_access IN ('available', 'revoked', 'unavailable') AND (valid_from IS NULL OR valid_from <= ?) AND (valid_to IS NULL OR valid_to > ?)";
    const lexicalRows = lexicalIds.size
      ? this.sqlite.prepare(`SELECT id FROM user_episodic_memories WHERE ${liveSql} AND status IN ('active', 'superseded') AND id IN (${[...lexicalIds].map(() => "?").join(",")})`)
        .all(now, now, ...lexicalIds.keys()) as Array<{ id: string }>
      : [];
    const continuityRows = input.includeContinuity === false ? [] : this.sqlite.prepare(`
      SELECT id FROM user_episodic_memories WHERE ${liveSql} AND status = 'active' AND kind IN ('preference', 'relationship', 'habit')
      ORDER BY updated_at DESC LIMIT 128
    `).all(now, now) as Array<{ id: string }>;
    const candidates = [...new Map([...lexicalRows, ...continuityRows].map((row) => [row.id, row])).values()];
    const recalled = candidates.flatMap((row) => {
      const candidate = this.getHuman(row.id);
      let record = candidate;
      let relation: RecalledUserGlobalMemory["relation"];
      if (candidate.memory.status === "superseded") {
        const pointer = this.sqlite.prepare(`
          SELECT * FROM user_memory_relations
          WHERE from_memory_id = ? AND from_revision = ? AND relation_type IN ('supersedes', 'contradicts')
          ORDER BY created_at DESC LIMIT 1
        `).get(candidate.memory.id, candidate.memory.current_revision) as {
          to_memory_id: string; relation_type: "supersedes" | "contradicts";
        } | undefined;
        if (!pointer) return [];
        try { record = this.getHuman(pointer.to_memory_id); } catch { return []; }
        if (record.memory.status !== "active" || !this.isCurrentlyValid(record.memory)) return [];
        relation = { type: pointer.relation_type, replacementId: record.memory.id };
      }
      const resolved = this.resolveEvidence(record.evidence, input.currentSpaceId, input.agentId);
      this.persistSourceAccess(record.memory.id, record.memory.source_access, resolved.state);
      if (resolved.state !== "available") return [];
      const lexical = lexicalIds.get(candidate.memory.id) ?? lexicalIds.get(record.memory.id) ?? 0;
      const continuity = ["preference", "relationship", "habit"].includes(record.memory.kind) ? 0.25 : 0;
      const recency = Math.max(0, 1 - ((now - record.memory.updated_at) / (180 * 86_400_000)));
      const scoreBreakdown: MemoryScoreBreakdown = {
        lexical: lexical * 0.55,
        continuity,
        importance: (record.memory.importance_millis / 1_000) * 0.15,
        recency: recency * 0.05,
      };
      const selected = disclosureProjection({
        disclosure: record.revision.disclosure,
        targetSurfaceId: input.targetSurfaceId,
        evidence: resolved.evidence.map((item) => ({ sourceSurfaceId: item.source_surface_id, visibilityAtOccurrence: item.visibility_at_occurrence })),
        hasInternalSummary: Boolean(record.revision.internal_summary),
        hasShareableSummary: Boolean(record.revision.shareable_summary),
      });
      return [{
        memoryId: record.memory.id,
        memoryRevision: record.revision.revision,
        contentHash: record.revision.content_hmac,
        score: Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0),
        scoreBreakdown,
        reasons: [...(lexical ? ["query"] : []), ...(continuity ? ["continuity"] : []), ...(relation ? ["replacement"] : []), "user_global"],
        evidenceRefs: resolved.evidence.map((item) => ({ sourceKind: item.source_kind, sourceId: item.source_id })),
        disclosure: record.revision.disclosure,
        ...(relation ? { relation } : {}),
        projection: selected,
        content: selected === "canonical" ? record.revision.canonical_text
          : selected === "internal_summary" ? record.revision.internal_summary
          : selected === "shareable_summary" ? record.revision.shareable_summary : null,
      }];
    });
    recalled.sort((left, right) => right.score - left.score || left.memoryId.localeCompare(right.memoryId));
    const byMemory = new Map<string, RecalledUserGlobalMemory>();
    for (const item of recalled) if (!byMemory.has(item.memoryId)) byMemory.set(item.memoryId, item);
    const selected: RecalledUserGlobalMemory[] = [];
    let continuityCount = 0;
    let queryCount = 0;
    let continuityTokens = 0;
    let queryTokens = 0;
    for (const item of byMemory.values()) {
      const itemTokens = item.content ? estimateContextTokens(item.content) : 0;
      const continuity = item.reasons.includes("continuity") && !item.reasons.includes("query");
      if (continuity) {
        if (continuityCount >= 12 || continuityTokens + itemTokens > 2_000) continue;
        continuityCount += 1;
        continuityTokens += itemTokens;
      } else {
        if (queryCount >= 8 || queryTokens + itemTokens > 4_000) continue;
        queryCount += 1;
        queryTokens += itemTokens;
      }
      selected.push(item);
    }
    return selected;
  }

  hasSourceAccess(
    memoryId: string,
    currentSpaceId: string,
    agentId: string,
    currentSpaceTransaction?: SpaceTransaction,
  ): boolean {
    let record: UserGlobalMemoryRecord;
    try {
      record = this.getHuman(memoryId);
    } catch {
      return false;
    }
    if (record.memory.status !== "active" || !this.isCurrentlyValid(record.memory)) return false;
    const resolved = this.resolveEvidence(record.evidence, currentSpaceId, agentId, currentSpaceTransaction);
    this.persistSourceAccess(record.memory.id, record.memory.source_access, resolved.state);
    return resolved.state === "available";
  }

  revisionContent(memoryId: string, revision: number, projection: DisclosureProjection): string | null {
    const row = this.sqlite.prepare(`
      SELECT canonical_text, internal_summary, shareable_summary
      FROM user_episodic_memory_revisions WHERE memory_id = ? AND revision = ?
    `).get(memoryId, revision) as Pick<UserRevisionRow, "canonical_text" | "internal_summary" | "shareable_summary"> | undefined;
    if (!row) return null;
    return projection === "canonical" ? row.canonical_text
      : projection === "internal_summary" ? row.internal_summary
      : projection === "shareable_summary" ? row.shareable_summary
      : null;
  }

  private authoritativeEvidence(evidence: MemoryEvidenceInput[]): MemoryEvidenceInput[] {
    return evidence.map((item) => {
      if (item.sourceKind === "manual") {
        return { ...item, sourceSpaceId: null, sourceSurfaceId: null, visibilityAtOccurrence: "local_file" };
      }
      if (item.sourceKind === "file") {
        if (!item.sourceSpaceId) throw new MemoryError("MEMORY_INVALID", "file evidence requires a registered Space");
        const root = spaceRecord(item.sourceSpaceId)?.rootPath;
        const sourcePath = root ? path.resolve(root, item.sourceId) : null;
        const relative = root && sourcePath ? path.relative(path.resolve(root), sourcePath) : "..";
        if (!sourcePath || relative === "" || relative.startsWith("..") || path.isAbsolute(relative) || !existsSync(sourcePath)) {
          throw new MemoryError("MEMORY_INVALID", "file evidence is outside its Space or unavailable");
        }
        return { ...item, sourceSurfaceId: null, visibilityAtOccurrence: "local_file" };
      }
      if (item.sourceKind === "turn") {
        if (!item.sourceSpaceId) throw new MemoryError("MEMORY_INVALID", "turn evidence requires a registered Space");
        let db: SpaceDb;
        try { db = dbForSpace(item.sourceSpaceId); } catch {
          throw new MemoryError("MEMORY_INVALID", "turn evidence Space is unavailable");
        }
        const turn = db.select().from(schema.agentTurns).where(and(
          eq(schema.agentTurns.id, item.sourceId), eq(schema.agentTurns.spaceId, item.sourceSpaceId),
        )).get();
        const session = turn ? db.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.id, turn.runtimeSessionId)).get() : null;
        if (!session) throw new MemoryError("MEMORY_INVALID", "turn evidence does not match an authoritative source");
        return {
          ...item,
          sourceSurfaceId: session.surfaceId,
          visibilityAtOccurrence: this.surfaceVisibility(db, item.sourceSpaceId, session.surfaceId),
        };
      }
      if (!item.sourceSpaceId || !item.sourceSurfaceId) {
        throw new MemoryError("MEMORY_INVALID", "message evidence requires a registered Space and source surface");
      }
      let db: SpaceDb;
      try {
        db = dbForSpace(item.sourceSpaceId);
      } catch {
        throw new MemoryError("MEMORY_INVALID", "message evidence Space is unavailable");
      }
      const message = db.select().from(schema.messages).where(and(
        eq(schema.messages.id, item.sourceId),
        eq(schema.messages.spaceId, item.sourceSpaceId),
        eq(schema.messages.channelId, item.sourceSurfaceId),
      )).get();
      if (!message) throw new MemoryError("MEMORY_INVALID", "message evidence does not match an authoritative source");
      if (message.memoryPolicy === "exclude") {
        throw new MemoryError("MEMORY_FORBIDDEN", "memory-excluded source message cannot produce user-global memory");
      }
      return {
        ...item,
        visibilityAtOccurrence: this.surfaceVisibility(db, item.sourceSpaceId, item.sourceSurfaceId),
        memoryPolicy: "human_manual",
      };
    });
  }

  private surfaceVisibility(
    db: SpaceDb | SpaceTransaction,
    spaceId: string,
    surfaceId: string,
  ): MemoryEvidenceInput["visibilityAtOccurrence"] {
    const channel = db.select().from(schema.channels).where(and(
      eq(schema.channels.id, surfaceId), eq(schema.channels.spaceId, spaceId),
    )).get();
    if (!channel) throw new MemoryError("MEMORY_INVALID", "memory evidence surface does not exist");
    if (channel.type === "channel") return "public";
    if (channel.type === "dm") return "dm";
    if (channel.type !== "thread" || !channel.parentMessageId) return "private";
    const parent = db.select({ channelId: schema.messages.channelId }).from(schema.messages)
      .where(eq(schema.messages.id, channel.parentMessageId)).get();
    return parent ? this.surfaceVisibility(db, spaceId, parent.channelId) : "private";
  }

  private resolveEvidence(
    evidence: UserEvidenceRow[],
    currentSpaceId: string,
    agentId: string,
    currentSpaceTransaction?: SpaceTransaction,
  ): { evidence: UserEvidenceRow[]; state: "available" | "revoked" | "unavailable" | "deleted" } {
    let failure: "revoked" | "unavailable" | "deleted" | null = null;
    const available = evidence.filter((item) => {
      if (item.source_kind === "file") {
        const root = item.source_space_id ? spaceRecord(item.source_space_id)?.rootPath : null;
        const sourcePath = root ? path.resolve(root, item.source_id) : null;
        const relative = root && sourcePath ? path.relative(path.resolve(root), sourcePath) : "..";
        const exists = Boolean(sourcePath && relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative) && existsSync(sourcePath));
        if (!exists) failure = "deleted";
        return exists;
      }
      if (!item.source_surface_id) {
        const allowed = item.source_kind === "manual" || item.visibility_at_occurrence === "local_file";
        if (!allowed) failure ??= "unavailable";
        return allowed;
      }
      if (!item.source_space_id) {
        failure ??= "unavailable";
        return false;
      }
      try {
        const db: SpaceDb | SpaceTransaction = item.source_space_id === currentSpaceId && currentSpaceTransaction
          ? currentSpaceTransaction
          : dbForSpace(item.source_space_id);
        if (item.source_kind === "message") {
          const message = db.select({ channelId: schema.messages.channelId }).from(schema.messages).where(and(
            eq(schema.messages.id, item.source_id),
            eq(schema.messages.spaceId, item.source_space_id),
          )).get();
          if (!message || message.channelId !== item.source_surface_id) {
            failure = "deleted";
            return false;
          }
        } else if (item.source_kind === "turn") {
          const turn = db.select({ runtimeSessionId: schema.agentTurns.runtimeSessionId }).from(schema.agentTurns).where(and(
            eq(schema.agentTurns.id, item.source_id), eq(schema.agentTurns.spaceId, item.source_space_id),
          )).get();
          const session = turn ? db.select({ surfaceId: schema.runtimeSessions.surfaceId }).from(schema.runtimeSessions)
            .where(eq(schema.runtimeSessions.id, turn.runtimeSessionId)).get() : null;
          if (!session || session.surfaceId !== item.source_surface_id) {
            failure = "deleted";
            return false;
          }
        }
        const allowed = hasAgentSurfaceAccessInTransaction(db as SpaceTransaction, {
          spaceId: item.source_space_id,
          channelId: item.source_surface_id,
          agentId,
          now: this.now(),
        });
        if (!allowed && failure !== "deleted") failure = "revoked";
        return allowed;
      } catch {
        if (failure !== "deleted") failure = "unavailable";
        return false;
      }
    });
    if (!evidence.length) return { evidence: [], state: "unavailable" };
    return available.length === evidence.length
      ? { evidence: available, state: "available" }
      : { evidence: [], state: failure ?? "unavailable" };
  }

  private persistSourceAccess(memoryId: string, previous: string, state: "available" | "revoked" | "unavailable" | "deleted"): void {
    if (previous === state) return;
    this.sqlite.prepare("UPDATE user_episodic_memories SET source_access = ?, updated_at = ? WHERE id = ?")
      .run(state, this.now(), memoryId);
  }

  private isCurrentlyValid(memory: UserMemoryRow): boolean {
    return (memory.valid_from == null || memory.valid_from <= this.now())
      && (memory.valid_to == null || memory.valid_to > this.now());
  }

  private replaceProjection(
    memoryId: string,
    value: { canonicalText: string; internalSummary: string | null; shareableSummary: string | null; subjectKey: string; predicateKey: string },
    tags: string[],
  ): void {
    const normalizedTags = [...new Set(tags.map((tag) => projectLexicalText(tag).normalizedText).filter(Boolean))];
    const projection = projectLexicalText([
      value.canonicalText, value.internalSummary, value.shareableSummary, value.subjectKey, value.predicateKey, ...normalizedTags,
    ].filter((item): item is string => Boolean(item)).join(" "));
    this.sqlite.prepare("DELETE FROM user_memory_tags WHERE memory_id = ?").run(memoryId);
    this.sqlite.prepare("DELETE FROM user_memory_lexical_terms WHERE memory_id = ?").run(memoryId);
    this.sqlite.prepare("DELETE FROM user_memory_fts WHERE memory_id = ?").run(memoryId);
    const insertTag = this.sqlite.prepare("INSERT INTO user_memory_tags (memory_id, tag) VALUES (?, ?)");
    normalizedTags.forEach((tag) => insertTag.run(memoryId, tag));
    const insertTerm = this.sqlite.prepare("INSERT INTO user_memory_lexical_terms (memory_id, term) VALUES (?, ?)");
    projection.shortExactTerms.forEach((term) => insertTerm.run(memoryId, term));
    this.sqlite.prepare("INSERT INTO user_memory_fts (memory_id, lexical_text, cjk_bigrams, cjk_trigrams) VALUES (?, ?, ?, ?)")
      .run(memoryId, projection.lexicalText, projection.cjkBigrams, projection.cjkTrigrams);
  }
}
