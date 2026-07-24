import { z } from "zod";
import type { CompiledAdvisorModelConfig, ProviderExecutionSnapshot, ResolvedEgressPlan } from "../../advisor-provider/contracts.js";
import type { MaintenanceJsonResult } from "./maintenanceRuntimePort.js";

export interface PreparedAdvisorRun {
  runId: string;
  localHandle: string;
  workerGeneration: number;
  snapshot: ProviderExecutionSnapshot;
  config: CompiledAdvisorModelConfig;
  preflight: ResolvedEgressPlan;
}

export type ActivatedAdvisorCredential =
  | { type: "api_key"; value: string }
  | { type: "oauth"; value: string; expires?: number }
  | { type: "none"; value: null };

export interface AdvisorProviderRuntimePort {
  prepare(snapshot: ProviderExecutionSnapshot, config: CompiledAdvisorModelConfig): Promise<PreparedAdvisorRun>;
  complete(input: PreparedAdvisorRun, prompt: string, credentialHandle: string, signal?: AbortSignal): Promise<MaintenanceJsonResult>;
  cancel(runId: string): Promise<void>;
}

export const AdvisorPrepareResultSchema = z.object({
  type: z.literal("advisor:result"),
  requestId: z.string().min(1),
  ok: z.literal(true),
  localHandle: z.string().uuid(),
  workerGeneration: z.number().int().positive(),
  preflight: z.object({
    canonicalOrigin: z.string().url(),
    proxy: z.enum(["none", "declared"]),
    networkClass: z.enum(["loopback", "lan", "public_cloud", "custom"]),
    resolvedAddressDigest: z.string().regex(/^[0-9a-f]{64}$/),
    redirectPolicy: z.enum(["reject", "same_origin_only"]),
    allEgress: z.array(z.string().url()).max(16),
  }).strict(),
}).strict();

export const AdvisorCompleteResultSchema = z.object({
  type: z.literal("advisor:result"),
  requestId: z.string().min(1),
  ok: z.literal(true),
  output: z.unknown(),
  usage: z.record(z.unknown()).optional(),
  postflight: AdvisorPrepareResultSchema.shape.preflight,
}).strict();
