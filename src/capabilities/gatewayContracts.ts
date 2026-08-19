import { z } from "zod";
import {
  TurnCedeCommandSchema as CanonicalTurnCedeCommandSchema,
  TurnReplyCommandSchema as CanonicalTurnReplyCommandSchema,
} from "../turns/contracts.js";

export const GatewayScopeSchema = z.enum([
  "context.check",
  "turn.reply",
  "attachment.upload",
  "turn.cede",
  "turn.progress",
  "session.checklist",
  "session.schedule_wakeup",
  "conversation.read",
  "conversation.search",
  "memory.read",
  "turn.get",
  "task.read",
  "task.write",
  "capability.describe",
  "canvas.read",
  "canvas.write",
  "canvas.export",
  "canvas.import",
]);
export type GatewayScope = z.infer<typeof GatewayScopeSchema>;

export function requiredAgentScopes(scope: GatewayScope): readonly string[] {
  if (scope === "turn.reply") return ["message:send"];
  if (scope === "attachment.upload") return ["message:send", "attachment:upload"];
  if (scope === "conversation.read" || scope === "conversation.search") return ["message:read"];
  if (scope === "memory.read") return ["knowledge:read"];
  if (scope === "task.read") return ["task:read"];
  if (scope === "task.write") return ["task:write"];
  return [];
}

export const ContextCheckCommandSchema = z.object({ refresh: z.boolean().default(false) }).strict();
// The Gateway, MCP and CLI share the frozen Runtime Contract command schemas.
// Keep the transport boundary from growing a second, subtly incompatible dialect.
export const TurnReplyCommandSchema = CanonicalTurnReplyCommandSchema;
export const TurnCedeCommandSchema = CanonicalTurnCedeCommandSchema;
export const TurnProgressCommandSchema = z.object({
  text: z.string().trim().min(1).max(2_000),
  idempotencyKey: z.string().trim().min(1).max(200),
}).strict();
export const ChecklistUpsertCommandSchema = z.object({
  id: z.string().trim().min(1).max(100).optional(),
  text: z.string().trim().min(1).max(1_000),
  status: z.enum(["pending", "in_progress", "done", "cancelled"]).default("pending"),
  order: z.number().int().min(0).max(10_000),
  expectedRevision: z.number().int().positive().optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
}).strict();
export const ChecklistClearCommandSchema = z.object({
  includeCompleted: z.boolean().default(true),
  idempotencyKey: z.string().trim().min(1).max(200),
}).strict();
export const ScheduleWakeupCommandSchema = z.object({
  delaySeconds: z.number().int().min(60).max(3_600),
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: z.string().trim().min(1).max(200),
}).strict();
export const ConversationReadCommandSchema = z.object({
  channelId: z.string().trim().min(1),
  limit: z.number().int().min(1).max(100).default(50),
  afterSeq: z.number().int().nonnegative().optional(),
}).strict();
export const ConversationSearchCommandSchema = z.object({
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(50).default(20),
}).strict();
export const MemoryRecallCommandSchema = z.object({
  query: z.string().trim().min(1).max(500),
  includeContinuity: z.boolean().default(true),
}).strict();
export const MemoryGetCommandSchema = z.object({ memoryId: z.string().trim().min(1).max(128) }).strict();
export const TaskListCommandSchema = z.object({ channel: z.string().trim().min(1) }).strict();
export const TaskGetCommandSchema = z.object({ taskId: z.string().trim().min(6) }).strict();
export const TaskCreateCommandSchema = z.object({
  channel: z.string().trim().min(1),
  title: z.string().trim().min(1).max(20_000),
  executionMode: z.enum(["autopilot", "plan-first"]).default("autopilot"),
  parentTaskId: z.string().trim().min(6).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
}).strict();
const TaskMutationBase = z.object({
  taskId: z.string().trim().min(6),
  expectedRevision: z.number().int().positive().optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
});
export const TaskClaimCommandSchema = TaskMutationBase.strict();
export const TaskUpdateCommandSchema = TaskMutationBase.extend({
  status: z.enum(["todo", "in_progress", "in_review", "done", "closed"]),
  from: z.enum(["todo", "in_progress", "in_review", "done", "closed"]).optional(),
}).strict();
export const TaskAssignCommandSchema = TaskMutationBase.extend({ to: z.string().trim().min(1).max(64) }).strict();
export const TaskUnclaimCommandSchema = TaskMutationBase.strict();
export const TaskReportCommandSchema = z.object({
  taskId: z.string().trim().min(6),
  kind: z.enum(["progress", "blocker", "question", "result"]),
  content: z.string().trim().min(1).max(20_000),
  idempotencyKey: z.string().trim().min(1).max(200),
}).strict();
export const TaskDeliverCommandSchema = z.object({
  taskId: z.string().trim().min(6),
  expectedRevision: z.number().int().positive(),
  summary: z.string().trim().min(1).max(20_000),
  childTaskIds: z.array(z.string().trim().min(6)).max(100).default([]),
  idempotencyKey: z.string().trim().min(1).max(200),
}).strict();

export const CanvasSnapshotGetCommandSchema = z.object({
  snapshotId: z.string().trim().min(1),
  canvasId: z.string().trim().min(1).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
}).strict();
export const CanvasElementsGetCommandSchema = z.object({
  canvasId: z.string().trim().min(1).optional(),
  snapshotId: z.string().trim().min(1).optional(),
  elementIds: z.array(z.string().trim().min(1)).max(200).optional(),
  frameIds: z.array(z.string().trim().min(1)).max(200).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
}).strict();
export const CanvasElementsApplyCommandSchema = z.object({
  canvasId: z.string().trim().min(1).optional(),
  snapshotId: z.string().trim().min(1).optional(),
  expectedRevision: z.number().int().nonnegative(),
  operations: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
  confirmDestructive: z.boolean().optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
}).strict();
export const CanvasExportCommandSchema = z.object({
  snapshotId: z.string().trim().min(1),
  canvasId: z.string().trim().min(1).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
}).strict();
export const CanvasContextBundleCreateCommandSchema = z.object({
  snapshotId: z.string().trim().min(1),
  canvasId: z.string().trim().min(1).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
}).strict();
export const CanvasAssetImportCommandSchema = z.object({
  canvasId: z.string().trim().min(1).optional(),
  snapshotId: z.string().trim().min(1).optional(),
  /** Local Space attachment id (message-bound or current-turn temporary). */
  attachmentId: z.string().trim().min(1).optional(),
  /** Alias retained for MCP/CLI transport parity; treated as attachmentId. */
  assetId: z.string().trim().min(1).optional(),
  url: z.string().optional(),
  dataUrl: z.string().optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
}).strict();

export {
  CanvasAlignNodesCommandSchema,
  CanvasBooleanOpCommandSchema,
  CanvasCreateFrameCommandSchema,
  CanvasCreateImageCommandSchema,
  CanvasCreateShapeCommandSchema,
  CanvasCreateTextCommandSchema,
  CanvasDeleteNodesCommandSchema,
  CanvasDistributeNodesCommandSchema,
  CanvasDuplicateNodesCommandSchema,
  CanvasFlipNodesCommandSchema,
  CanvasGroupNodesCommandSchema,
  CanvasReorderNodesCommandSchema,
  CanvasSceneSummaryCommandSchema,
  CanvasSkillGetCommandSchema,
  CanvasSkillListCommandSchema,
  CanvasSetCanvasBackgroundCommandSchema,
  CanvasUngroupNodesCommandSchema,
  CanvasUpdateFrameCommandSchema,
  CanvasUpdateNodeCommandSchema,
} from "../canvas/canvasAgentTools.js";
export type {
  CanvasAlignNodesCommand,
  CanvasBooleanOpCommand,
  CanvasCreateFrameCommand,
  CanvasCreateImageCommand,
  CanvasCreateShapeCommand,
  CanvasCreateTextCommand,
  CanvasDeleteNodesCommand,
  CanvasDistributeNodesCommand,
  CanvasDuplicateNodesCommand,
  CanvasFlipNodesCommand,
  CanvasGroupNodesCommand,
  CanvasReorderNodesCommand,
  CanvasSceneSummaryCommand,
  CanvasSkillGetCommand,
  CanvasSkillListCommand,
  CanvasSetCanvasBackgroundCommand,
  CanvasUngroupNodesCommand,
  CanvasUpdateFrameCommand,
  CanvasUpdateNodeCommand,
} from "../canvas/canvasAgentTools.js";
export type ContextCheckCommand = z.infer<typeof ContextCheckCommandSchema>;
export type CanvasSnapshotGetCommand = z.infer<typeof CanvasSnapshotGetCommandSchema>;
export type CanvasElementsGetCommand = z.infer<typeof CanvasElementsGetCommandSchema>;
export type CanvasElementsApplyCommand = z.infer<typeof CanvasElementsApplyCommandSchema>;
export type CanvasExportCommand = z.infer<typeof CanvasExportCommandSchema>;
export type CanvasContextBundleCreateCommand = z.infer<typeof CanvasContextBundleCreateCommandSchema>;
export type CanvasAssetImportCommand = z.infer<typeof CanvasAssetImportCommandSchema>;
export type TurnReplyCommand = z.infer<typeof TurnReplyCommandSchema>;
export type TurnCedeCommand = z.infer<typeof TurnCedeCommandSchema>;
export type TurnProgressCommand = z.infer<typeof TurnProgressCommandSchema>;
export type ChecklistUpsertCommand = z.infer<typeof ChecklistUpsertCommandSchema>;
export type ChecklistClearCommand = z.infer<typeof ChecklistClearCommandSchema>;
export type ScheduleWakeupCommand = z.infer<typeof ScheduleWakeupCommandSchema>;
export type ConversationReadCommand = z.infer<typeof ConversationReadCommandSchema>;
export type ConversationSearchCommand = z.infer<typeof ConversationSearchCommandSchema>;
export type MemoryRecallCommand = z.infer<typeof MemoryRecallCommandSchema>;
export type MemoryGetCommand = z.infer<typeof MemoryGetCommandSchema>;
export type TaskListCommand = z.infer<typeof TaskListCommandSchema>;
export type TaskGetCommand = z.infer<typeof TaskGetCommandSchema>;
export type TaskCreateCommand = z.infer<typeof TaskCreateCommandSchema>;
export type TaskClaimCommand = z.infer<typeof TaskClaimCommandSchema>;
export type TaskUpdateCommand = z.infer<typeof TaskUpdateCommandSchema>;
export type TaskAssignCommand = z.infer<typeof TaskAssignCommandSchema>;
export type TaskUnclaimCommand = z.infer<typeof TaskUnclaimCommandSchema>;
export type TaskReportCommand = z.infer<typeof TaskReportCommandSchema>;
export type TaskDeliverCommand = z.infer<typeof TaskDeliverCommandSchema>;
