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
  "turn.get",
  "task.read",
  "task.write",
  "capability.describe",
]);
export type GatewayScope = z.infer<typeof GatewayScopeSchema>;

export function requiredAgentScopes(scope: GatewayScope): readonly string[] {
  if (scope === "turn.reply") return ["message:send"];
  if (scope === "attachment.upload") return ["message:send", "attachment:upload"];
  if (scope === "conversation.read" || scope === "conversation.search") return ["message:read"];
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

export type ContextCheckCommand = z.infer<typeof ContextCheckCommandSchema>;
export type TurnReplyCommand = z.infer<typeof TurnReplyCommandSchema>;
export type TurnCedeCommand = z.infer<typeof TurnCedeCommandSchema>;
export type TurnProgressCommand = z.infer<typeof TurnProgressCommandSchema>;
export type ChecklistUpsertCommand = z.infer<typeof ChecklistUpsertCommandSchema>;
export type ChecklistClearCommand = z.infer<typeof ChecklistClearCommandSchema>;
export type ScheduleWakeupCommand = z.infer<typeof ScheduleWakeupCommandSchema>;
export type ConversationReadCommand = z.infer<typeof ConversationReadCommandSchema>;
export type ConversationSearchCommand = z.infer<typeof ConversationSearchCommandSchema>;
export type TaskListCommand = z.infer<typeof TaskListCommandSchema>;
export type TaskGetCommand = z.infer<typeof TaskGetCommandSchema>;
export type TaskCreateCommand = z.infer<typeof TaskCreateCommandSchema>;
export type TaskClaimCommand = z.infer<typeof TaskClaimCommandSchema>;
export type TaskUpdateCommand = z.infer<typeof TaskUpdateCommandSchema>;
export type TaskAssignCommand = z.infer<typeof TaskAssignCommandSchema>;
export type TaskUnclaimCommand = z.infer<typeof TaskUnclaimCommandSchema>;
export type TaskReportCommand = z.infer<typeof TaskReportCommandSchema>;
export type TaskDeliverCommand = z.infer<typeof TaskDeliverCommandSchema>;
