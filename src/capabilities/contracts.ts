import { z } from "zod";

export const TurnCapabilityClaimsSchema = z.object({
  schemaVersion: z.literal(1),
  activationId: z.string().min(1),
  turnId: z.string().min(1),
  attemptId: z.string().min(1),
  sessionId: z.string().min(1),
  sessionGeneration: z.number().int().positive(),
  workerGeneration: z.number().int().nonnegative(),
  spaceId: z.string().min(1),
  agentId: z.string().min(1),
  allowedOutputSurfaceIds: z.array(z.string().min(1)).min(1),
  allowedInputIds: z.array(z.string().min(1)).max(50),
  seenWatermarks: z.array(z.object({ channelId: z.string().min(1), throughSeq: z.number().int().nonnegative() }).strict()),
  scopes: z.array(z.string().min(1)),
  disclosureGrantIds: z.array(z.string().min(1)),
  expiresAt: z.number().int().nonnegative(),
}).strict();
export type TurnCapabilityClaims = z.infer<typeof TurnCapabilityClaimsSchema>;

export const DisclosureSourceRefSchema = z.object({
  sourceKind: z.string().min(1),
  sourceId: z.string().min(1),
  sourceRevision: z.number().int().nonnegative().nullable(),
  projection: z.enum(["canonical", "internal_summary", "shareable_summary", "ref_only"]),
}).strict();
export type DisclosureSourceRef = z.infer<typeof DisclosureSourceRefSchema>;

export const DisclosureGrantSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  turnId: z.string().min(1),
  sourceRefs: z.array(DisclosureSourceRefSchema).min(1),
  targetSurfaceId: z.string().min(1),
  actionDigest: z.string().min(1),
  allowedProjection: z.enum(["canonical", "internal_summary", "shareable_summary", "ref_only"]),
  status: z.enum(["active", "consumed", "expired", "revoked"]),
  expiresAt: z.number().int().nonnegative(),
  consumedAt: z.number().int().nonnegative().nullable(),
}).strict();
