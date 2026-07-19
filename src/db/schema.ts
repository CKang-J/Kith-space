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
  joinedAt: timestamp("joined_at").default(now).notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.channelId, t.agentId] }) }));

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
  createdAt: timestamp("created_at").default(now).notNull(),
}, (t) => ({
  byChannel: index("attachments_channel_idx").on(t.channelId),
  idTextPrefix: index("attachments_id_text_prefix_idx").on(t.id),
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
