import { z } from "zod";

export const MemoryScopeSchema = z.enum(["agent_private", "space_shared", "user_global"]);
export const MemoryStatusSchema = z.enum(["proposed", "active", "superseded", "archived", "rejected"]);
export const MemoryKindSchema = z.enum(["preference", "fact", "decision", "relationship", "habit", "open_loop", "procedure"]);
export const DisclosureModeSchema = z.enum(["internal_use", "shareable_summary", "explicit_only"]);
export const ActorRefSchema = z.object({ type: z.enum(["human", "agent", "system", "tool"]), id: z.string().min(1) }).strict();

export const EpisodicMemorySchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  spaceId: z.string().min(1).nullable(),
  ownerAgentId: z.string().min(1).nullable(),
  scope: MemoryScopeSchema,
  kind: MemoryKindSchema,
  subjectRef: z.object({ kind: z.enum(["human", "agent", "space", "project", "entity"]), id: z.string().min(1) }).strict(),
  subjectKey: z.string().min(1),
  predicateKey: z.string().min(1),
  currentRevision: z.number().int().positive(),
  status: MemoryStatusSchema,
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  sensitivity: z.enum(["normal", "private", "secret"]),
  disclosure: DisclosureModeSchema,
  validFrom: z.number().int().nonnegative().nullable(),
  validTo: z.number().int().nonnegative().nullable(),
  tags: z.array(z.string().min(1)),
  sourceAccess: z.enum(["available", "revoked", "unavailable", "deleted"]),
  deletionState: z.enum(["none", "pending"]),
  rowVersion: z.number().int().positive(),
  createdBy: ActorRefSchema,
  updatedBy: ActorRefSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict();

export const EpisodicMemoryRevisionSchema = z.object({
  schemaVersion: z.literal(1),
  memoryId: z.string().min(1),
  revision: z.number().int().positive(),
  canonicalText: z.string().min(1),
  internalSummary: z.string().min(1).nullable(),
  shareableSummary: z.string().min(1).nullable(),
  contentHmac: z.string().min(1),
  sensitivity: z.enum(["normal", "private", "secret"]),
  disclosure: DisclosureModeSchema,
  validFrom: z.number().int().nonnegative().nullable(),
  validTo: z.number().int().nonnegative().nullable(),
  createdBy: ActorRefSchema,
  createdAt: z.number().int().nonnegative(),
}).strict();

export const MemoryMutationCommandSchema = z.object({
  schemaVersion: z.literal(1),
  action: z.enum(["edit", "correct", "archive", "restore", "reject", "delete", "forget_suppress"]),
  memoryId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
  idempotencyKey: z.string().min(1).max(128),
  payload: z.record(z.unknown()).default({}),
}).strict();

export const MemoryEvidenceInputSchema = z.object({
  sourceSpaceId: z.string().min(1).nullable().default(null),
  sourceKind: z.enum(["message", "turn", "file", "manual"]),
  sourceId: z.string().min(1).max(512),
  sourceSurfaceId: z.string().min(1).nullable().default(null),
  visibilityAtOccurrence: z.enum(["public", "private", "dm", "local_file"]),
  assertedBy: ActorRefSchema,
  quotedFrom: ActorRefSchema.nullable().default(null),
  claimType: z.enum(["human_assertion", "agent_derived", "tool_fact", "manual"]),
  memoryPolicy: z.enum(["eligible", "exclude", "human_manual"]),
  excerpt: z.string().min(1).max(16_000),
  occurredAt: z.number().int().nonnegative(),
}).strict();

export const CreateEpisodicMemoryCommandSchema = z.object({
  schemaVersion: z.literal(1),
  scope: MemoryScopeSchema,
  ownerAgentId: z.string().min(1).nullable().default(null),
  kind: MemoryKindSchema,
  subjectRef: z.object({ kind: z.enum(["human", "agent", "space", "project", "entity"]), id: z.string().min(1) }).strict(),
  subjectKey: z.string().min(1).max(256),
  predicateKey: z.string().min(1).max(256),
  canonicalText: z.string().min(1).max(16_000),
  internalSummary: z.string().min(1).max(4_000).nullable().default(null),
  shareableSummary: z.string().min(1).max(4_000).nullable().default(null),
  status: MemoryStatusSchema.default("active"),
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  sensitivity: z.enum(["normal", "private", "secret"]),
  disclosure: DisclosureModeSchema,
  validFrom: z.number().int().nonnegative().nullable().default(null),
  validTo: z.number().int().nonnegative().nullable().default(null),
  tags: z.array(z.string().min(1).max(128)).max(64).default([]),
  evidence: z.array(MemoryEvidenceInputSchema).min(1).max(64),
  actor: ActorRefSchema,
  idempotencyKey: z.string().min(1).max(128),
}).strict();

export type ActorRef = z.infer<typeof ActorRefSchema>;
export type CreateEpisodicMemoryCommand = z.infer<typeof CreateEpisodicMemoryCommandSchema>;
export type MemoryEvidenceInput = z.infer<typeof MemoryEvidenceInputSchema>;
export type MemoryMutationCommand = z.infer<typeof MemoryMutationCommandSchema>;
