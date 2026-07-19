import { z } from "zod";
import { NormalizedUsageSchema, type NormalizedUsage } from "./v2/runtimeContract.js";

export const MemoryAdvisorCandidateSchema = z.object({
  scope: z.enum(["agent_private", "space_shared"]),
  kind: z.enum(["preference", "fact", "decision", "relationship", "habit", "open_loop", "procedure"]),
  subjectRef: z.object({
    kind: z.enum(["human", "agent", "space", "project", "entity"]),
    id: z.string().min(1).max(256),
  }).strict(),
  subjectKey: z.string().min(1).max(256),
  predicateKey: z.string().min(1).max(256),
  canonicalText: z.string().min(1).max(16_000),
  internalSummary: z.string().min(1).max(4_000).nullable(),
  shareableSummary: z.string().min(1).max(4_000).nullable(),
  sensitivity: z.enum(["normal", "private", "secret"]),
  disclosure: z.enum(["internal_use", "shareable_summary", "explicit_only"]),
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  tags: z.array(z.string().min(1).max(128)).max(32),
  evidenceSourceIds: z.array(z.string().min(1).max(512)).min(1).max(32),
}).strict();

export const MemoryAdvisorCompletionSchema = z.object({
  schemaVersion: z.literal(1),
  candidates: z.array(MemoryAdvisorCandidateSchema).max(32),
}).strict();

export type MemoryAdvisorCandidate = z.infer<typeof MemoryAdvisorCandidateSchema>;

export interface MaintenanceJsonInput {
  runtime: string;
  model?: string | null;
  configDigest: string;
  purpose: "memory_advisor";
  prompt: string;
}

export interface MaintenanceJsonResult {
  output: z.infer<typeof MemoryAdvisorCompletionSchema>;
  usage?: NormalizedUsage;
}

export interface MaintenanceRuntimeSupport {
  toolIsolation: "enforced" | "unsupported";
  reason?: string;
}

export interface MaintenanceRuntimePort {
  support(runtime: string): MaintenanceRuntimeSupport;
  completeJson(input: MaintenanceJsonInput): Promise<MaintenanceJsonResult>;
}

export function maintenanceRuntimeSupport(runtime: string): MaintenanceRuntimeSupport {
  return runtime === "claude"
    ? { toolIsolation: "enforced" }
    : { toolIsolation: "unsupported", reason: `${runtime} does not expose a verified no-tools maintenance profile` };
}

export const MaintenanceWorkerResultSchema = z.object({
  type: z.literal("maintenance:result"),
  requestId: z.string().min(1),
  ok: z.boolean(),
  output: MemoryAdvisorCompletionSchema.optional(),
  usage: NormalizedUsageSchema.optional(),
  errorCode: z.string().min(1).max(128).optional(),
  errorDetail: z.string().min(1).max(512).optional(),
}).strict();

export const MEMORY_ADVISOR_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "candidates"],
  properties: {
    schemaVersion: { const: 1 },
    candidates: {
      type: "array",
      maxItems: 32,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "scope", "kind", "subjectRef", "subjectKey", "predicateKey", "canonicalText", "internalSummary",
          "shareableSummary", "sensitivity", "disclosure", "confidence", "importance", "tags", "evidenceSourceIds",
        ],
        properties: {
          scope: { enum: ["agent_private", "space_shared"] },
          kind: { enum: ["preference", "fact", "decision", "relationship", "habit", "open_loop", "procedure"] },
          subjectRef: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "id"],
            properties: {
              kind: { enum: ["human", "agent", "space", "project", "entity"] },
              id: { type: "string", minLength: 1, maxLength: 256 },
            },
          },
          subjectKey: { type: "string", minLength: 1, maxLength: 256 },
          predicateKey: { type: "string", minLength: 1, maxLength: 256 },
          canonicalText: { type: "string", minLength: 1, maxLength: 16000 },
          internalSummary: { anyOf: [{ type: "string", minLength: 1, maxLength: 4000 }, { type: "null" }] },
          shareableSummary: { anyOf: [{ type: "string", minLength: 1, maxLength: 4000 }, { type: "null" }] },
          sensitivity: { enum: ["normal", "private", "secret"] },
          disclosure: { enum: ["internal_use", "shareable_summary", "explicit_only"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          importance: { type: "number", minimum: 0, maximum: 1 },
          tags: { type: "array", maxItems: 32, items: { type: "string", minLength: 1, maxLength: 128 } },
          evidenceSourceIds: { type: "array", minItems: 1, maxItems: 32, items: { type: "string", minLength: 1, maxLength: 512 } },
        },
      },
    },
  },
} as const;
