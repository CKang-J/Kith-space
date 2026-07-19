import { z } from "zod";
import { AdapterSnapshotSchema, WorkerSessionSnapshotReportSchema, type RuntimeSessionSnapshot } from "../sessionSnapshot.js";

export const RuntimeSessionKeySchema = z.object({
  spaceId: z.string().min(1),
  agentId: z.string().min(1),
  surfaceKind: z.enum(["channel", "private", "dm", "thread"]),
  surfaceId: z.string().min(1),
});
export type RuntimeSessionKey = z.infer<typeof RuntimeSessionKeySchema>;

export const NormalizedUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  reasoningTokens: z.number().int().nonnegative().optional(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(),
  model: z.string().min(1).optional(),
  source: z.enum(["final", "incremental", "estimated"]),
}).strict();
export type NormalizedUsage = z.infer<typeof NormalizedUsageSchema>;

export const RuntimeCapabilitiesSchema = z.object({
  resumableSession: z.boolean(),
  persistentProcess: z.boolean(),
  mcp: z.enum(["native", "config", "bridge", "none"]),
  hooks: z.object({
    beforeTool: z.boolean(),
    afterTool: z.boolean(),
    beforeCompact: z.boolean(),
    afterCompact: z.boolean(),
    stopFinalize: z.boolean(),
  }).strict(),
  usage: z.enum(["final", "incremental", "none"]),
  cancellation: z.enum(["graceful", "process"]),
  context: z.object({
    modelWindow: z.enum(["reported", "catalog", "unknown"]),
    tokenEstimator: z.enum(["provider", "local", "approximate"]),
  }).strict(),
  cwdRelocatableResume: z.boolean(),
  toolIsolation: z.enum(["enforced", "advisory", "none"]),
}).strict();
export type RuntimeCapabilities = z.infer<typeof RuntimeCapabilitiesSchema>;

export const RuntimeEventKindSchema = z.enum([
  "turn_started",
  "session_changed",
  "activity",
  "thinking_summary",
  "text_preview",
  "tool_started",
  "tool_completed",
  "tool_failed",
  "usage",
  "compaction_started",
  "compaction_completed",
  "events_truncated",
  "turn_completed",
  "turn_failed",
]);
export type RuntimeEventKind = z.infer<typeof RuntimeEventKindSchema>;

export const RuntimeEventEnvelopeSchema = z.object({
  schemaVersion: z.literal(2),
  workerGeneration: z.number().int().nonnegative(),
  sessionId: z.string().min(1),
  sessionGeneration: z.number().int().positive(),
  turnId: z.string().min(1),
  attemptId: z.string().min(1),
  eventId: z.string().min(1),
  ordinal: z.number().int().nonnegative(),
  kind: RuntimeEventKindSchema,
  payload: z.record(z.unknown()),
  createdAt: z.number().int().nonnegative(),
}).strict();
export type RuntimeEventEnvelope = z.infer<typeof RuntimeEventEnvelopeSchema>;

export interface PromptDescriptor {
  text: string;
  version: string;
  digest: string;
}

export interface McpBootstrapDescriptor {
  mode: "native" | "config" | "bridge" | "none";
  serverName: string;
  descriptor: Record<string, unknown>;
}

export interface SessionBrokerDescriptor {
  sessionHandle: string;
  endpoint: string;
}

export interface OpenRuntimeSessionOptions {
  runtimeSessionId: string;
  sessionGeneration: number;
  workerGeneration: number;
  address: RuntimeSessionKey;
  cwd: string;
  runtimeStateDir: string;
  model?: string;
  runtimeConfig?: Record<string, unknown>;
  engineSessionId?: string | null;
  restoredSnapshot?: RuntimeSessionSnapshot | null;
  systemPrompt: PromptDescriptor;
  mcpBootstrap: McpBootstrapDescriptor;
  env: NodeJS.ProcessEnv;
  broker: SessionBrokerDescriptor;
}

export interface RuntimeTurnInput {
  turnId: string;
  attemptId: string;
  context: string;
  capabilityActivationId: string;
  deadlineAt: number;
}

export const MAX_RUNTIME_TERMINAL_BYTES = 128 * 1024;
export const RuntimeTurnResultSchema = z.object({
  outcome: z.enum(["completed", "failed", "cancelled"]),
  engineSessionId: z.string().max(4_096).nullable(),
  usage: NormalizedUsageSchema.optional(),
  errorCode: z.string().min(1).max(128).optional(),
  sessionSnapshot: WorkerSessionSnapshotReportSchema.optional(),
}).strict();
export type RuntimeTurnResult = z.infer<typeof RuntimeTurnResultSchema>;

export interface RuntimeEventSink {
  emit(event: RuntimeEventEnvelope): Promise<void>;
}

export type AdapterSnapshot = z.infer<typeof AdapterSnapshotSchema>;

export interface RuntimeSessionV2 {
  runTurn(input: RuntimeTurnInput, sink: RuntimeEventSink): Promise<RuntimeTurnResult>;
  cancel(attemptId: string): Promise<void>;
  snapshot(): Promise<AdapterSnapshot>;
  close(reason: "idle" | "stop" | "reset" | "shutdown"): Promise<void>;
}

export interface RuntimeV2 {
  name: string;
  capabilities: RuntimeCapabilities;
  openSession(options: OpenRuntimeSessionOptions): Promise<RuntimeSessionV2>;
}
