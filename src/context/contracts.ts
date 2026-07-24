import { z } from "zod";
import { RuntimeSessionKeySchema } from "../runtime/contract/v2/runtimeContract.js";

export const ContextSourceRefSchema = z.object({
  sourceKind: z.string().min(1),
  sourceId: z.string().min(1),
  sourceRevision: z.number().int().nonnegative().nullable(),
  snapshotId: z.string().min(1).nullable(),
  contentHmac: z.string().min(1),
  visibility: z.enum(["public", "private", "dm", "local_file"]),
  disclosureProjection: z.enum(["canonical", "internal_summary", "shareable_summary", "ref_only"]),
  injectionMode: z.enum(["content", "summary", "reference", "omitted"]),
  estimatedTokens: z.number().int().nonnegative(),
  reason: z.string().min(1),
}).strict();

export const MessageContextSnapshotSchema = z.object({
  spaceId: z.string().min(1).max(128),
  module: z.string().min(1).max(64),
  routeId: z.string().min(1).max(128),
  openObjectRefs: z.array(z.object({
    type: z.string().min(1).max(64),
    id: z.string().min(1).max(256),
    revision: z.number().int().nonnegative().optional(),
  }).strict()).max(16),
  focusedRef: z.object({
    type: z.string().min(1).max(64),
    id: z.string().min(1).max(256),
    field: z.string().min(1).max(64).optional(),
  }).strict().optional(),
  capturedAt: z.number().int().nonnegative(),
}).strict();
export type MessageContextSnapshot = z.infer<typeof MessageContextSnapshotSchema>;

export const ContextEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  turnId: z.string().min(1),
  session: RuntimeSessionKeySchema,
  responseDirective: z.enum(["required", "optional"]),
  deliveryItemIds: z.array(z.string().min(1)).min(1).max(50),
  seenWatermarks: z.array(z.object({ channelId: z.string().min(1), throughSeq: z.number().int().nonnegative() }).strict()),
  continuityMode: z.enum(["cold", "resumed", "resume_failed", "post_compaction"]),
  rootMessage: ContextSourceRefSchema.optional(),
  parentSnapshot: z.object({
    asOfSeq: z.number().int().nonnegative(),
    messageRefs: z.array(ContextSourceRefSchema),
    omittedCount: z.number().int().nonnegative(),
  }).strict().optional(),
  currentBatch: z.array(ContextSourceRefSchema).min(1),
  recentSurface: z.array(ContextSourceRefSchema),
  objectSnapshots: z.array(ContextSourceRefSchema),
  recalledMemories: z.array(z.object({
    memoryId: z.string().min(1),
    memoryRevision: z.number().int().positive(),
    contentHash: z.string().min(1),
    score: z.number(),
    scoreBreakdown: z.object({
      lexical: z.number(),
      continuity: z.number(),
      importance: z.number(),
      recency: z.number(),
    }).strict().optional(),
    reasons: z.array(z.string().min(1)),
    evidenceRefs: z.array(z.object({ sourceKind: z.string().min(1), sourceId: z.string().min(1) }).strict()).optional(),
    disclosure: z.enum(["internal_use", "shareable_summary", "explicit_only"]).optional(),
    relation: z.object({
      type: z.enum(["supersedes", "contradicts", "confirms", "derived_from"]),
      replacementId: z.string().min(1).optional(),
    }).strict().optional(),
    projection: z.enum(["canonical", "internal_summary", "shareable_summary", "ref_only"]),
  }).strict()),
  fileMemoryRefs: z.array(z.object({ path: z.string().min(1), contentHash: z.string().min(1), reason: z.string().min(1) }).strict()),
  uiSnapshot: MessageContextSnapshotSchema.optional(),
  capabilityActivationId: z.string().min(1),
  budget: z.object({ available: z.number().int().nonnegative(), used: z.number().int().nonnegative(), estimator: z.string().min(1) }).strict(),
  omissions: z.array(z.object({ sourceKind: z.string().min(1), reason: z.string().min(1), count: z.number().int().nonnegative() }).strict()),
  assembledAt: z.number().int().nonnegative(),
}).strict();
export type ContextEnvelope = z.infer<typeof ContextEnvelopeSchema>;
