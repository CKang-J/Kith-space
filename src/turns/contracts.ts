import { z } from "zod";
import { NormalizedUsageSchema } from "../runtime/contract/v2/runtimeContract.js";
import { DisclosureSourceRefSchema } from "../capabilities/contracts.js";

export const TurnStatusSchema = z.enum(["pending", "running", "retry_wait", "completed", "failed", "cancelled"]);
export const TurnOutcomeSchema = z.enum(["replied", "ceded", "mixed", "failed", "cancelled"]);
export const AttemptStatusSchema = z.enum(["claimed", "admitted", "running", "finalizing", "succeeded", "failed", "cancelled", "lost"]);

export const AgentTurnSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  sessionId: z.string().min(1),
  sessionGeneration: z.number().int().positive(),
  spaceId: z.string().min(1),
  agentId: z.string().min(1),
  status: TurnStatusSchema,
  outcome: TurnOutcomeSchema.nullable(),
  effectiveDirective: z.enum(["required", "optional"]),
  maxAttempts: z.number().int().positive(),
  nextAttemptAt: z.number().int().nonnegative().nullable(),
  createdAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().nullable(),
}).strict();

export const AgentTurnAttemptSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  turnId: z.string().min(1),
  attemptNo: z.number().int().positive(),
  status: AttemptStatusSchema,
  workerGeneration: z.number().int().nonnegative(),
  leaseOwner: z.string().min(1),
  leaseExpiresAt: z.number().int().nonnegative(),
  engineSessionIdBefore: z.string().min(1).nullable(),
  engineSessionIdAfter: z.string().min(1).nullable(),
  usage: NormalizedUsageSchema.nullable(),
  errorCode: z.string().min(1).nullable(),
}).strict();

export const TurnReplyCommandSchema = z.object({
  schemaVersion: z.literal(1),
  body: z.string(),
  attachmentIds: z.array(z.string().min(1)).max(20).default([]),
  sourceRefs: z.array(DisclosureSourceRefSchema).max(20).default([]),
  disclosureGrantId: z.string().min(1).optional(),
  handledInputIds: z.array(z.string().min(1)).min(1).max(50),
  operationKey: z.string().min(1).max(128),
}).strict().refine((value) => value.body.trim().length > 0 || value.attachmentIds.length > 0, {
  message: "reply requires body or attachments",
});

export const TurnCedeCommandSchema = z.object({
  schemaVersion: z.literal(1),
  inputIds: z.array(z.string().min(1)).min(1).max(50),
  reason: z.string().min(1).max(1000),
  operationKey: z.string().min(1).max(128),
}).strict();
