// Kith-space per-Space database schema (Drizzle / SQLite).
// One workspace.db belongs to one registered Space, while explicit space_id
// columns preserve the canonical product vocabulary and guard cross-Space writes.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AgentResponseMode } from "../agents/agentResponsePolicy.js";

const id = (name: string) => text(name).$defaultFn(() => randomUUID());
const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });
const now = sql`(unixepoch() * 1000)`;

export const spaces = sqliteTable("spaces", {
  id: id("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").default(now).notNull(),
});

export const agents = sqliteTable("agents", {
  id: id("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id),
  name: text("name").notNull(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  description: text("description"),
  status: text("status").default("inactive").notNull(),
  activity: text("activity").default("offline").notNull(),
  introducedAt: timestamp("introduced_at"),
  defaultResponseMode: text("default_response_mode").$type<AgentResponseMode>().default("active").notNull(),
  sessionId: text("session_id"),
  model: text("model"),
  runtime: text("runtime").default("claude").notNull(),
  runtimeConfig: text("runtime_config", { mode: "json" }).$type<Record<string, unknown>>().default({}).notNull(),
  executionMode: text("execution_mode").default("auto").notNull(),
  envVars: text("env_vars", { mode: "json" }).$type<Record<string, string>>().default({}).notNull(),
  agentTokenHash: text("agent_token_hash"),
  scopes: text("scopes", { mode: "json" }).$type<{
    granted: string[];
    mode: "default" | "custom";
    revision: number;
    updatedAt: string;
  }>(),
  creatorType: text("creator_type").default("human").notNull(),
  creatorId: text("creator_id"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").default(now).notNull(),
}, (t) => ({
  bySpace: index("agents_space_idx").on(t.spaceId),
  nameUniq: uniqueIndex("agents_name_uniq").on(t.spaceId, t.name).where(sql`${t.deletedAt} is null`),
}));

export type AgentHarnessMode = "legacy" | "migrating" | "v2";

export const agentHarnessState = sqliteTable("agent_harness_state", {
  agentId: text("agent_id").primaryKey().references(() => agents.id, { onDelete: "cascade" }),
  mode: text("mode").$type<AgentHarnessMode>().default("legacy").notNull(),
  cutoverAt: timestamp("cutover_at"),
  rollbackUntil: timestamp("rollback_until"),
  migrationAudit: text("migration_audit_json", { mode: "json" }).$type<Record<string, unknown>>().default({}).notNull(),
}, (t) => ({
  modeCheck: check("agent_harness_state_mode_check", sql`${t.mode} in ('legacy', 'migrating', 'v2')`),
}));

export type RuntimeSessionStatus = "cold" | "starting" | "idle" | "running" | "evicted" | "resume_failed" | "disabled";

export const runtimeSessions = sqliteTable("runtime_sessions", {
  id: id("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  surfaceKind: text("surface_kind").$type<"channel" | "private" | "dm" | "thread">().notNull(),
  surfaceId: text("surface_id").notNull(),
  sessionGeneration: integer("session_generation").notNull(),
  runtime: text("runtime").notNull(),
  model: text("model"),
  runtimeConfigFingerprint: text("runtime_config_fingerprint").notNull(),
  adapterVersion: text("adapter_version").notNull(),
  engineSessionId: text("engine_session_id"),
  engineHostFingerprint: text("engine_host_fingerprint"),
  workspaceRootFingerprint: text("workspace_root_fingerprint").notNull(),
  status: text("status").$type<RuntimeSessionStatus>().default("cold").notNull(),
  lastTurnId: text("last_turn_id"),
  lastActiveAt: timestamp("last_active_at").default(now).notNull(),
  lastCompactedAt: timestamp("last_compacted_at"),
  retiredAt: timestamp("retired_at"),
  snapshotVersion: integer("snapshot_version").default(0).notNull(),
  snapshot: text("snapshot_json", { mode: "json" }).$type<Record<string, unknown>>(),
  snapshotChecksum: text("snapshot_checksum"),
  snapshotSavedAt: timestamp("snapshot_saved_at"),
  createdAt: timestamp("created_at").default(now).notNull(),
  updatedAt: timestamp("updated_at").default(now).notNull(),
}, (t) => ({
  generationUniq: uniqueIndex("runtime_sessions_generation_uniq").on(
    t.spaceId,
    t.agentId,
    t.surfaceKind,
    t.surfaceId,
    t.sessionGeneration,
  ),
  currentUniq: uniqueIndex("runtime_sessions_current_uniq").on(
    t.spaceId,
    t.agentId,
    t.surfaceKind,
    t.surfaceId,
  ).where(sql`${t.retiredAt} is null`),
  byAgentStatus: index("runtime_sessions_agent_status_idx").on(t.agentId, t.status, t.lastActiveAt),
  generationCheck: check("runtime_sessions_generation_check", sql`${t.sessionGeneration} > 0`),
  statusCheck: check("runtime_sessions_status_check", sql`${t.status} in ('cold', 'starting', 'idle', 'running', 'evicted', 'resume_failed', 'disabled')`),
  snapshotVersionCheck: check("runtime_sessions_snapshot_version_check", sql`${t.snapshotVersion} >= 0`),
}));

export const channels = sqliteTable("channels", {
  id: id("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull(),
  parentMessageId: text("parent_message_id"),
  lastMessageAt: timestamp("last_message_at"),
  archivedAt: timestamp("archived_at"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").default(now).notNull(),
}, (t) => ({
  bySpace: index("channels_space_idx").on(t.spaceId),
  dmUniq: uniqueIndex("channels_dm_uniq").on(t.spaceId, t.name).where(sql`${t.type} = 'dm'`),
  threadUniq: uniqueIndex("channels_thread_uniq").on(t.spaceId, t.parentMessageId).where(sql`${t.type} = 'thread'`),
}));

export const channelAgentMembers = sqliteTable("channel_agent_members", {
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  lastReadSeq: integer("last_read_seq").default(0).notNull(),
  responseModeOverride: text("response_mode_override").$type<AgentResponseMode>(),
  ambientWakeAfterSeq: integer("ambient_wake_after_seq").default(0).notNull(),
  mentionWakeAfterSeq: integer("mention_wake_after_seq").default(0).notNull(),
  accessKind: text("access_kind").$type<"member" | "task_scoped">().default("member").notNull(),
  taskScope: text("task_scope_json", { mode: "json" }).$type<Record<string, unknown>>(),
  accessExpiresAt: timestamp("access_expires_at"),
  joinedAt: timestamp("joined_at").default(now).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.channelId, t.agentId] }),
  accessKindCheck: check("channel_agent_members_access_kind_check", sql`${t.accessKind} in ('member', 'task_scoped')`),
}));

export const humanChannelStates = sqliteTable("human_channel_states", {
  channelId: text("channel_id").primaryKey().references(() => channels.id, { onDelete: "cascade" }),
  lastReadSeq: integer("last_read_seq").default(0).notNull(),
  dmAgentId: text("dm_agent_id").references(() => agents.id, { onDelete: "set null" }),
  threadFollowedAt: timestamp("thread_followed_at"),
  threadDoneAt: timestamp("thread_done_at"),
  notificationLevel: text("notification_level").$type<"all" | "mentions" | "none">().default("all").notNull(),
  updatedAt: timestamp("updated_at").default(now).notNull(),
});

export const messages = sqliteTable("messages", {
  id: id("id").primaryKey(),
  seq: integer("seq").notNull(),
  spaceId: text("space_id").notNull().references(() => spaces.id),
  channelId: text("channel_id").notNull().references(() => channels.id),
  senderType: text("sender_type").notNull(), // human | agent | system
  senderId: text("sender_id"),
  senderName: text("sender_name").notNull(),
  messageType: text("message_type").default("text").notNull(),
  content: text("content").notNull(),
  actionMetadata: text("action_metadata", { mode: "json" }),
  threadId: text("thread_id"),
  taskStatus: text("task_status"),
  taskNumber: integer("task_number"),
  taskAssigneeType: text("task_assignee_type"), // human | agent
  taskAssigneeId: text("task_assignee_id"),
  taskClaimedAt: timestamp("task_claimed_at"),
  taskCompletedAt: timestamp("task_completed_at"),
  taskParentId: text("task_parent_id"),
  taskRevision: integer("task_revision").default(0).notNull(),
  taskExecutionMode: text("task_execution_mode").default("autopilot").notNull(),
  dispatchChainId: text("dispatch_chain_id"),
  dispatchDepth: integer("dispatch_depth"),
  memoryPolicy: text("memory_policy").$type<"eligible" | "exclude">(),
  contextSnapshot: text("context_snapshot_json", { mode: "json" }).$type<Record<string, unknown>>(),
  producedByTurnId: text("produced_by_turn_id"),
  searchText: text("search_text"),
  createdAt: timestamp("created_at").default(now).notNull(),
  updatedAt: timestamp("updated_at").default(now).notNull(),
}, (t) => ({
  bySeq: index("messages_space_seq_idx").on(t.spaceId, t.seq),
  byChannel: index("messages_channel_idx").on(t.channelId, t.seq),
  idTextPrefix: index("messages_id_text_prefix_idx").on(t.id),
  byTaskParent: index("messages_task_parent_idx").on(t.taskParentId),
}));

export const taskNumberCounters = sqliteTable("task_number_counters", {
  scopeKey: text("scope_key").primaryKey(),
  lastNumber: integer("last_number").notNull(),
});

export const dispatchChains = sqliteTable("dispatch_chains", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  rootMessageId: text("root_message_id").notNull(),
  taskMessageId: text("task_message_id"),
  channelId: text("channel_id").notNull(),
  wakeCount: integer("wake_count").default(0).notNull(),
  maxDepthSeen: integer("max_depth_seen").default(0).notNull(),
  lastRejectionCode: text("last_rejection_code"),
  lastRejectionReason: text("last_rejection_reason"),
  lastRejectedAt: timestamp("last_rejected_at"),
  lastRejectedMessageId: text("last_rejected_message_id"),
  lastRejectedAgentId: text("last_rejected_agent_id"),
  createdAt: timestamp("created_at").default(now).notNull(),
  updatedAt: timestamp("updated_at").default(now).notNull(),
}, (t) => ({
  bySpace: index("dispatch_chains_space_idx").on(t.spaceId),
  byTask: index("dispatch_chains_task_idx").on(t.taskMessageId),
}));

export const dispatchContexts = sqliteTable("dispatch_contexts", {
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  channelId: text("channel_id").notNull(),
  chainId: text("chain_id").notNull().references(() => dispatchChains.id, { onDelete: "cascade" }),
  dispatchDepth: integer("dispatch_depth").notNull(),
  updatedAt: timestamp("updated_at").default(now).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.spaceId, t.agentId, t.channelId] }),
  byChain: index("dispatch_contexts_chain_idx").on(t.chainId),
}));

export const dispatchWakes = sqliteTable("dispatch_wakes", {
  id: id("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  chainId: text("chain_id").notNull().references(() => dispatchChains.id, { onDelete: "cascade" }),
  messageId: text("message_id").notNull(),
  targetAgentId: text("target_agent_id").notNull(),
  dispatchDepth: integer("dispatch_depth").notNull(),
  status: text("status").default("reserved").notNull(),
  createdAt: timestamp("created_at").default(now).notNull(),
}, (t) => ({
  byChain: index("dispatch_wakes_chain_idx").on(t.chainId),
  byAgent: index("dispatch_wakes_agent_idx").on(t.targetAgentId),
  byStatus: index("dispatch_wakes_status_created_idx").on(t.status, t.createdAt),
}));

export const dispatchStops = sqliteTable("dispatch_stops", {
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  scopeType: text("scope_type").notNull(),
  scopeId: text("scope_id").notNull(),
  reason: text("reason"),
  stoppedAt: timestamp("stopped_at").default(now).notNull(),
  updatedAt: timestamp("updated_at").default(now).notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.spaceId, t.scopeType, t.scopeId] }) }));

export const messageMentions = sqliteTable("message_mentions", {
  messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  mentionType: text("mention_type").notNull(), // human | agent | channel_all (display marker; agent rows snapshot recipients)
  mentionId: text("mention_id").notNull(),
  mentionName: text("mention_name").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.messageId, t.mentionType, t.mentionId] }),
  byMention: index("mentions_target_idx").on(t.mentionType, t.mentionId),
}));

export const reactions = sqliteTable("reactions", {
  id: id("id").primaryKey(),
  messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  actorType: text("actor_type").notNull(), // human | agent
  actorId: text("actor_id").notNull(),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at").default(now).notNull(),
}, (t) => ({ uniq: uniqueIndex("reactions_uniq").on(t.messageId, t.actorType, t.actorId, t.emoji) }));

export const attachments = sqliteTable("attachments", {
  id: id("id").primaryKey(),
  messageId: text("message_id").references(() => messages.id),
  channelId: text("channel_id"),
  spaceId: text("space_id").notNull().references(() => spaces.id),
  uploaderType: text("uploader_type"), // human | agent
  uploaderId: text("uploader_id"),
  filename: text("filename").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  storageKey: text("storage_key").notNull(),
  uploadState: text("upload_state"), // null/legacy | temporary | deleting | bound
  sourceTurnId: text("source_turn_id"),
  sourceActivationId: text("source_activation_id"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").default(now).notNull(),
}, (t) => ({
  byChannel: index("attachments_channel_idx").on(t.channelId),
  idTextPrefix: index("attachments_id_text_prefix_idx").on(t.id),
  byTemporaryExpiry: index("attachments_upload_state_expiry_idx").on(t.uploadState, t.expiresAt),
}));

export const reminders = sqliteTable("reminders", {
  id: id("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id),
  ownerType: text("owner_type").notNull(), // human | agent
  ownerId: text("owner_id").notNull(),
  channelId: text("channel_id").references(() => channels.id),
  content: text("content").notNull(),
  anchorMessageId: text("anchor_message_id"),
  recurrence: text("recurrence"),
  status: text("status").default("scheduled").notNull(),
  remindAt: timestamp("remind_at").notNull(),
  firedAt: timestamp("fired_at"),
  createdAt: timestamp("created_at").default(now).notNull(),
}, (t) => ({ byDue: index("reminders_due_idx").on(t.remindAt) }));

export const knowledge = sqliteTable("knowledge", {
  id: id("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id),
  agentId: text("agent_id").references(() => agents.id),
  title: text("title").notNull(),
  content: text("content").notNull(),
  searchText: text("search_text"),
  createdAt: timestamp("created_at").default(now).notNull(),
});

export const agentActivityLog = sqliteTable("agent_activity_log", {
  id: id("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id),
  agentId: text("agent_id").notNull(),
  ts: integer("ts").notNull(),
  kind: text("kind").notNull(),
  activity: text("activity"),
  detail: text("detail"),
  text: text("text"),
  toolName: text("tool_name"),
  toolInput: text("tool_input"),
}, (t) => ({ byAgent: index("activity_agent_idx").on(t.agentId, t.ts) }));

export const humanSpacePreferences = sqliteTable("human_space_preferences", {
  spaceId: text("space_id").primaryKey().references(() => spaces.id, { onDelete: "cascade" }),
  prefs: text("prefs", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at").default(now).notNull(),
});

export const humanSavedMessages = sqliteTable("human_saved_messages", {
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").default(now).notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.spaceId, t.messageId] }) }));

export const turnContextSnapshots = sqliteTable("turn_context_snapshots", {
  id: id("id").primaryKey(),
  payload: text("payload_json_redacted", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  payloadHmac: text("payload_hmac").notNull(),
  retentionClass: text("retention_class").notNull(),
  createdAt: timestamp("created_at").default(now).notNull(),
  expiresAt: timestamp("expires_at"),
}, (t) => ({ byExpiry: index("turn_context_snapshots_expiry_idx").on(t.expiresAt) }));

export const agentTurns = sqliteTable("agent_turns", {
  id: id("id").primaryKey(),
  runtimeSessionId: text("runtime_session_id").notNull().references(() => runtimeSessions.id, { onDelete: "cascade" }),
  sessionGeneration: integer("session_generation").notNull(),
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  status: text("status").$type<"pending" | "running" | "retry_wait" | "completed" | "failed" | "cancelled">().default("pending").notNull(),
  outcome: text("outcome").$type<"replied" | "ceded" | "mixed" | "failed" | "cancelled">(),
  effectiveDirective: text("effective_directive").$type<"required" | "optional">().notNull(),
  contextEnvelope: text("context_envelope_json", { mode: "json" }).$type<Record<string, unknown>>(),
  maxAttempts: integer("max_attempts").default(3).notNull(),
  nextAttemptAt: timestamp("next_attempt_at"),
  createdAt: timestamp("created_at").default(now).notNull(),
  completedAt: timestamp("completed_at"),
}, (t) => ({
  activeSessionUniq: uniqueIndex("agent_turns_active_session_uniq").on(t.runtimeSessionId)
    .where(sql`${t.status} in ('pending', 'running', 'retry_wait')`),
  bySchedule: index("agent_turns_schedule_idx").on(t.status, t.nextAttemptAt),
  bySessionStatus: index("agent_turns_session_status_idx").on(t.runtimeSessionId, t.status),
  statusCheck: check("agent_turns_status_check", sql`${t.status} in ('pending', 'running', 'retry_wait', 'completed', 'failed', 'cancelled')`),
  outcomeCheck: check("agent_turns_outcome_check", sql`${t.outcome} is null or ${t.outcome} in ('replied', 'ceded', 'mixed', 'failed', 'cancelled')`),
  directiveCheck: check("agent_turns_directive_check", sql`${t.effectiveDirective} in ('required', 'optional')`),
  maxAttemptsCheck: check("agent_turns_max_attempts_check", sql`${t.maxAttempts} > 0`),
}));

export const agentTurnAttempts = sqliteTable("agent_turn_attempts", {
  id: id("id").primaryKey(),
  turnId: text("turn_id").notNull().references(() => agentTurns.id, { onDelete: "cascade" }),
  attemptNo: integer("attempt_no").notNull(),
  status: text("status").$type<"claimed" | "admitted" | "running" | "finalizing" | "succeeded" | "failed" | "cancelled" | "lost">().notNull(),
  workerGeneration: integer("worker_generation").notNull(),
  leaseOwner: text("lease_owner").notNull(),
  leaseExpiresAt: timestamp("lease_expires_at").notNull(),
  heartbeatAt: timestamp("heartbeat_at"),
  engineSessionIdBefore: text("engine_session_id_before"),
  engineSessionIdAfter: text("engine_session_id_after"),
  usage: text("usage_json", { mode: "json" }).$type<Record<string, unknown>>(),
  errorCode: text("error_code"),
  errorDetailRedacted: text("error_detail_redacted"),
  eventCount: integer("event_count").default(0).notNull(),
  eventPayloadBytes: integer("event_payload_bytes").default(0).notNull(),
  claimedAt: timestamp("claimed_at").default(now).notNull(),
  admittedAt: timestamp("admitted_at"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
}, (t) => ({
  attemptUniq: uniqueIndex("agent_turn_attempts_turn_no_uniq").on(t.turnId, t.attemptNo),
  byLease: index("agent_turn_attempts_lease_idx").on(t.status, t.leaseExpiresAt),
  statusCheck: check("agent_turn_attempts_status_check", sql`${t.status} in ('claimed', 'admitted', 'running', 'finalizing', 'succeeded', 'failed', 'cancelled', 'lost')`),
}));

export const agentTurnEvents = sqliteTable("agent_turn_events", {
  attemptId: text("attempt_id").notNull().references(() => agentTurnAttempts.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  kind: text("kind").notNull(),
  payload: text("payload_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at").default(now).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.attemptId, t.ordinal] }),
  byCreatedKind: index("agent_turn_events_created_kind_idx").on(t.createdAt, t.kind),
}));

export const agentDeliveryItems = sqliteTable("agent_delivery_items", {
  id: id("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  sourceChannelId: text("source_channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  sourceSeq: integer("source_seq").notNull(),
  cursorOwnerChannelId: text("cursor_owner_channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  targetSurfaceKind: text("target_surface_kind").$type<"channel" | "private" | "dm" | "thread">().notNull(),
  targetSurfaceId: text("target_surface_id").notNull(),
  targetRuntimeSessionId: text("target_runtime_session_id").references(() => runtimeSessions.id, { onDelete: "set null" }),
  directive: text("directive").$type<"required" | "optional" | "observe">().notNull(),
  reason: text("reason").notNull(),
  policySnapshot: text("policy_snapshot_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  disposition: text("disposition").$type<"pending" | "bound" | "observed" | "replied" | "ceded" | "dispatch_blocked" | "dismissed">().default("pending").notNull(),
  turnId: text("turn_id").references(() => agentTurns.id, { onDelete: "set null" }),
  dispatchWakeId: text("dispatch_wake_id").references(() => dispatchWakes.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").default(now).notNull(),
  settledAt: timestamp("settled_at"),
}, (t) => ({
  agentMessageUniq: uniqueIndex("agent_delivery_items_agent_message_uniq").on(t.agentId, t.messageId),
  byAgentDisposition: index("agent_delivery_items_agent_disposition_seq_idx").on(t.agentId, t.disposition, t.sourceSeq),
  byCursorOwner: index("agent_delivery_items_cursor_owner_seq_idx").on(t.cursorOwnerChannelId, t.agentId, t.sourceSeq),
  byTurn: index("agent_delivery_items_turn_idx").on(t.turnId),
  directiveCheck: check("agent_delivery_items_directive_check", sql`${t.directive} in ('required', 'optional', 'observe')`),
  dispositionCheck: check("agent_delivery_items_disposition_check", sql`${t.disposition} in ('pending', 'bound', 'observed', 'replied', 'ceded', 'dispatch_blocked', 'dismissed')`),
}));

export const turnOperations = sqliteTable("turn_operations", {
  id: id("id").primaryKey(),
  turnId: text("turn_id").notNull().references(() => agentTurns.id, { onDelete: "cascade" }),
  toolName: text("tool_name").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  operationSlot: text("operation_slot").notNull(),
  status: text("status").$type<"pending" | "committed" | "failed">().default("pending").notNull(),
  resultRef: text("result_ref_json", { mode: "json" }).$type<Record<string, unknown>>(),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at").default(now).notNull(),
  updatedAt: timestamp("updated_at").default(now).notNull(),
}, (t) => ({
  operationUniq: uniqueIndex("turn_operations_key_uniq").on(t.turnId, t.toolName, t.idempotencyKey),
  byStatus: index("turn_operations_status_idx").on(t.status, t.updatedAt),
}));

export const turnOutputs = sqliteTable("turn_outputs", {
  id: id("id").primaryKey(),
  turnId: text("turn_id").notNull().references(() => agentTurns.id, { onDelete: "cascade" }),
  operationId: text("operation_id").notNull().references(() => turnOperations.id, { onDelete: "cascade" }),
  outputKind: text("output_kind").$type<"reply" | "cede">().notNull(),
  messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").default(now).notNull(),
}, (t) => ({ byTurn: index("turn_outputs_turn_idx").on(t.turnId) }));

export const turnOutputInputs = sqliteTable("turn_output_inputs", {
  outputId: text("output_id").notNull().references(() => turnOutputs.id, { onDelete: "cascade" }),
  deliveryItemId: text("delivery_item_id").notNull().references(() => agentDeliveryItems.id, { onDelete: "cascade" }),
}, (t) => ({ pk: primaryKey({ columns: [t.outputId, t.deliveryItemId] }) }));

export const turnContextSources = sqliteTable("turn_context_sources", {
  id: id("id").primaryKey(),
  turnId: text("turn_id").notNull().references(() => agentTurns.id, { onDelete: "cascade" }),
  phase: text("phase").$type<"initial" | "later_query">().notNull(),
  ordinal: integer("ordinal").notNull(),
  sourceKind: text("source_kind").notNull(),
  sourceId: text("source_id").notNull(),
  sourceRevision: integer("source_revision"),
  snapshotId: text("snapshot_id").references(() => turnContextSnapshots.id, { onDelete: "set null" }),
  visibility: text("visibility").notNull(),
  disclosureProjection: text("disclosure_projection").notNull(),
  injectionMode: text("injection_mode").notNull(),
  reason: text("reason").notNull(),
  tokenEstimate: integer("token_estimate").notNull(),
  contentHmac: text("content_hmac").notNull(),
  createdAt: timestamp("created_at").default(now).notNull(),
}, (t) => ({ phaseOrdinalUniq: uniqueIndex("turn_context_sources_phase_ordinal_uniq").on(t.turnId, t.phase, t.ordinal) }));

export const turnCapabilityActivations = sqliteTable("turn_capability_activations", {
  id: text("id").primaryKey(),
  turnId: text("turn_id").notNull().references(() => agentTurns.id, { onDelete: "cascade" }),
  attemptId: text("attempt_id").notNull().references(() => agentTurnAttempts.id, { onDelete: "cascade" }),
  sessionGeneration: integer("session_generation").notNull(),
  workerGeneration: integer("worker_generation").notNull(),
  claimsDigest: text("claims_digest").notNull(),
  status: text("status").$type<"pending" | "active" | "revoked" | "expired">().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  activatedAt: timestamp("activated_at"),
  revokedAt: timestamp("revoked_at"),
}, (t) => ({ byAttempt: uniqueIndex("turn_capability_activations_attempt_uniq").on(t.attemptId) }));

export const disclosureGrants = sqliteTable("disclosure_grants", {
  id: text("id").primaryKey(),
  turnId: text("turn_id").notNull().references(() => agentTurns.id, { onDelete: "cascade" }),
  sourceRefs: text("source_refs_json", { mode: "json" }).$type<Record<string, unknown>[]>().notNull(),
  targetSurfaceId: text("target_surface_id").notNull(),
  actionDigest: text("action_digest").notNull(),
  allowedProjection: text("allowed_projection").notNull(),
  status: text("status").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
  createdBy: text("created_by").notNull(),
});

export const sessionChecklistItems = sqliteTable("session_checklist_items", {
  id: id("id").primaryKey(),
  runtimeSessionId: text("runtime_session_id").notNull().references(() => runtimeSessions.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  status: text("status").$type<"open" | "pending" | "in_progress" | "done" | "cancelled">().default("open").notNull(),
  sortOrder: integer("sort_order").notNull(),
  sourceTurnId: text("source_turn_id").references(() => agentTurns.id, { onDelete: "set null" }),
  rowVersion: integer("row_version").default(1).notNull(),
  createdAt: timestamp("created_at").default(now).notNull(),
  updatedAt: timestamp("updated_at").default(now).notNull(),
}, (t) => ({ bySession: index("session_checklist_items_session_idx").on(t.runtimeSessionId, t.sortOrder) }));

export const sessionWakeups = sqliteTable("session_wakeups", {
  id: id("id").primaryKey(),
  runtimeSessionId: text("runtime_session_id").notNull().references(() => runtimeSessions.id, { onDelete: "cascade" }),
  sessionGeneration: integer("session_generation").notNull(),
  ownerAgentId: text("owner_agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  dueAt: timestamp("due_at").notNull(),
  reason: text("reason").notNull(),
  status: text("status").$type<"scheduled" | "leased" | "fired" | "cancelled">().default("scheduled").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  sourceTurnId: text("source_turn_id").references(() => agentTurns.id, { onDelete: "set null" }),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at"),
  createdAt: timestamp("created_at").default(now).notNull(),
  firedAt: timestamp("fired_at"),
}, (t) => ({
  sessionKeyUniq: uniqueIndex("session_wakeups_session_key_uniq").on(t.runtimeSessionId, t.idempotencyKey),
  byDue: index("session_wakeups_due_idx").on(t.status, t.dueAt),
}));
