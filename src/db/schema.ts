// kith-space backend table definitions (Drizzle / SQLite)
// Field names and semantics are derived from observed /api/* response shapes (see root CLAUDE.md "Data Model").
// IDs are UUID strings generated in the application. message.seq is monotonic within each workspace, driving incremental sync.
import { randomUUID } from "node:crypto";
import { sqliteTable, text, integer, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const id = (name: string) => text(name).$defaultFn(() => randomUUID());
const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });
const now = sql`(unixepoch() * 1000)`;

// ── Human users ──────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: id("id").primaryKey(),
  name: text("name").notNull().unique(),         // stable identifier used in @mentions
  displayName: text("display_name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),           // for local login (nullable in PoC)
  gravatarHash: text("gravatar_hash"),
  avatarUrl: text("avatar_url"),
  description: text("description"),
  createdAt: timestamp("created_at").default(now).notNull(),
});

// ── Workspace (server) ────────────────────────────────────────
export const servers = sqliteTable("servers", {
  id: id("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ownerId: text("owner_id").notNull().references(() => users.id),
  onboardingAgentId: text("onboarding_agent_id"),
  rootPath: text("root_path").notNull(),
  avatarUrl: text("avatar_url"),                   // custom workspace avatar; value = /api/attachments/<id>
  hideHumansFromMembers: integer("hide_humans_from_members", { mode: "boolean" }).default(false).notNull(),
  plan: text("plan").default("free").notNull(),
  createdAt: timestamp("created_at").default(now).notNull(),
});

export const serverMembers = sqliteTable("server_members", {
  serverId: text("server_id").notNull().references(() => servers.id),
  userId: text("user_id").notNull().references(() => users.id),
  role: text("role").default("member").notNull(), // owner | admin | member
  pushMuted: integer("push_muted", { mode: "boolean" }).default(false).notNull(), // whether the user has muted push notifications for this server
  joinedAt: timestamp("joined_at").default(now).notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.serverId, t.userId] }) }));

// ── Machine (daemon host / cloud sandbox) ─────────────────────────────
export const machines = sqliteTable("machines", {
  id: id("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id),
  userId: text("user_id").notNull().references(() => users.id), // owner
  name: text("name").notNull(),
  apiKeyHash: text("api_key_hash").notNull(),    // hash of sk_machine_* key
  apiKeyPrefix: text("api_key_prefix").notNull(),// display prefix
  runtimes: text("runtimes", { mode: "json" }).$type<string[]>().default([]).notNull(), // ["claude","codex",...]
  hostname: text("hostname"),
  os: text("os"),
  daemonVersion: text("daemon_version"),
  lastHeartbeat: timestamp("last_heartbeat"),
  status: text("status").default("offline").notNull(), // online | offline
  isComputer: integer("is_computer", { mode: "boolean" }).default(false).notNull(), // false = local daemon, true = cloud sandbox
  createdAt: timestamp("created_at").default(now).notNull(),
}, (t) => ({ byServer: index("machines_server_idx").on(t.serverId) }));

// ── Agent (AI employee) ────────────────────────────────────────
export const agents = sqliteTable("agents", {
  id: id("id").primaryKey(),                     // also used as the workspace directory name ~/.kith-space/agents/<id>
  serverId: text("server_id").notNull().references(() => servers.id),
  machineId: text("machine_id").references(() => machines.id), // which machine this agent runs on
  name: text("name").notNull(),                   // @mention identifier
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  description: text("description"),               // role / system prompt seed
  status: text("status").default("inactive").notNull(),   // inactive | active | sleeping
  activity: text("activity").default("offline").notNull(),// offline|online|thinking|working
  sessionId: text("session_id"),                  // current runtime session (used with --resume)
  model: text("model"),                            // model alias or NULL → CLI uses its local default (~/.claude / ~/.codex)
  runtime: text("runtime").default("claude").notNull(),   // claude | codex | copilot | opencode | kimi | pi | cursor | hermes (registry: src/daemon/runtimes.ts REG)
  runtimeConfig: text("runtime_config", { mode: "json" }).$type<Record<string, unknown>>().default({}).notNull(),
  executionMode: text("execution_mode").default("auto").notNull(),
  envVars: text("env_vars", { mode: "json" }).$type<Record<string, string>>().default({}).notNull(),
  agentTokenHash: text("agent_token_hash"),       // hash of sk_agent_* token (used for CLI auth)
  scopes: text("scopes", { mode: "json" }).$type<{ granted: string[]; mode: "default" | "custom"; revision: number; updatedAt: string }>(), // null = default (all granted); see scopes.ts
  creatorType: text("creator_type").default("user").notNull(),
  creatorId: text("creator_id").references(() => users.id), // human creator; used in member profile "Created Agents" section. Null for historical records
  deletedAt: timestamp("deleted_at"), // soft delete: keep the row so historical message/DM names stay resolvable by-id
  createdAt: timestamp("created_at").default(now).notNull(),
}, (t) => ({
  byServer: index("agents_server_idx").on(t.serverId),
  // A live agent's name is the @mention / DM routing key (core.ts parseMentions/resolveTarget resolve by name),
  // so it must be unique per server — otherwise a same-named agent becomes an unreachable routing blind spot.
  // Partial index excludes soft-deleted rows, so a name frees up after delete and can be reused by a new agent.
  nameUniq: uniqueIndex("agents_name_uniq").on(t.serverId, t.name).where(sql`${t.deletedAt} is null`),
}));

// ── Channel / DM / Thread ───────────────────────────────────────
export const channels = sqliteTable("channels", {
  id: id("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull(),                   // channel | private | dm | thread
  parentMessageId: text("parent_message_id"),     // thread = a channel derived from a specific message
  lastMessageAt: timestamp("last_message_at"),
  archivedAt: timestamp("archived_at"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").default(now).notNull(),
}, (t) => ({
  byServer: index("channels_server_idx").on(t.serverId),
  // Partition-scoped uniqueness: prevents concurrent get-or-create from creating duplicate DM / thread channels (only one row per member pair for DMs, one row per parent message for threads).
  dmUniq: uniqueIndex("channels_dm_uniq").on(t.serverId, t.name).where(sql`${t.type} = 'dm'`),
  threadUniq: uniqueIndex("channels_thread_uniq").on(t.serverId, t.parentMessageId).where(sql`${t.type} = 'thread'`),
}));

// Members can be either users or agents; lastReadSeq is used for unread calculation
export const channelMembers = sqliteTable("channel_members", {
  channelId: text("channel_id").notNull().references(() => channels.id),
  memberType: text("member_type").notNull(),      // user | agent
  memberId: text("member_id").notNull(),
  lastReadSeq: integer("last_read_seq").default(0).notNull(),
  joinedAt: timestamp("joined_at").default(now).notNull(),
  threadDoneAt: timestamp("thread_done_at"), // per-user thread done mark (thread done → removed from inbox). Always null for non-thread channels
}, (t) => ({ pk: primaryKey({ columns: [t.channelId, t.memberType, t.memberId] }) }));

// ── Message (core; message-as-task) ─────────────────────────────────
export const messages = sqliteTable("messages", {
  id: id("id").primaryKey(),
  seq: integer("seq").notNull(),                  // monotonic within this workspace database
  serverId: text("server_id").notNull().references(() => servers.id),
  channelId: text("channel_id").notNull().references(() => channels.id),
  senderType: text("sender_type").notNull(),      // user | agent | system
  senderId: text("sender_id"),
  senderName: text("sender_name").notNull(),      // denormalized, used for rendering
  messageType: text("message_type").default("text").notNull(), // text | action | system
  content: text("content").notNull(),
  actionMetadata: text("action_metadata", { mode: "json" }), // system / platform action payload
  threadId: text("thread_id"),                    // owning thread channel
  // —— Task fields (a message can be promoted to a task) ——
  taskStatus: text("task_status"),                // null | todo | in_progress | in_review | done | closed (claiming is tracked via taskAssigneeId/taskClaimedAt, not status value)
  taskNumber: integer("task_number"),
  taskAssigneeType: text("task_assignee_type"),   // user | agent
  taskAssigneeId: text("task_assignee_id"),
  taskClaimedAt: timestamp("task_claimed_at"),
  taskCompletedAt: timestamp("task_completed_at"),
  taskParentId: text("task_parent_id"),           // nullable self-reference: direct parent task message
  taskRevision: integer("task_revision").default(0).notNull(), // optimistic concurrency token; 0 for plain messages
  taskExecutionMode: text("task_execution_mode").default("autopilot").notNull(), // autopilot | plan-first (task-only semantics; plain messages keep the harmless default)
  dispatchChainId: text("dispatch_chain_id"),
  dispatchDepth: integer("dispatch_depth"),
  searchText: text("search_text"),                // source text for full-text search (GIN to_tsvector index to be added later)
  createdAt: timestamp("created_at").default(now).notNull(),
  updatedAt: timestamp("updated_at").default(now).notNull(),
}, (t) => ({
  bySeq: index("messages_server_seq_idx").on(t.serverId, t.seq),     // primary index for incremental sync
  byChannel: index("messages_channel_idx").on(t.channelId, t.seq),
  // IDs are already text in SQLite; keep an ordinary index for short-prefix lookup.
  idTextPrefix: index("messages_id_text_prefix_idx").on(t.id),
  byTaskParent: index("messages_task_parent_idx").on(t.taskParentId),
}));

// Persistent task-number allocation. scopeKey is tasknum:<workspaceId> for public/private/thread
// channels and tasknum:dm:<channelId> for DMs. Keeping the increment in the task transaction avoids
// allocating a number without committing the corresponding task message/thread.
export const taskNumberCounters = sqliteTable("task_number_counters", {
  scopeKey: text("scope_key").primaryKey(),
  lastNumber: integer("last_number").notNull(),
});

// ── Dispatch guard (persistent orchestration budgets + emergency stops) ──
export const dispatchChains = sqliteTable("dispatch_chains", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
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
  byServer: index("dispatch_chains_server_idx").on(t.serverId),
  byTask: index("dispatch_chains_task_idx").on(t.taskMessageId),
}));

export const dispatchContexts = sqliteTable("dispatch_contexts", {
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  channelId: text("channel_id").notNull(),
  chainId: text("chain_id").notNull().references(() => dispatchChains.id, { onDelete: "cascade" }),
  dispatchDepth: integer("dispatch_depth").notNull(),
  updatedAt: timestamp("updated_at").default(now).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.serverId, t.agentId, t.channelId] }),
  byChain: index("dispatch_contexts_chain_idx").on(t.chainId),
}));

export const dispatchWakes = sqliteTable("dispatch_wakes", {
  id: id("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  chainId: text("chain_id").notNull().references(() => dispatchChains.id, { onDelete: "cascade" }),
  messageId: text("message_id").notNull(),
  targetAgentId: text("target_agent_id").notNull(),
  dispatchDepth: integer("dispatch_depth").notNull(),
  status: text("status").default("reserved").notNull(), // reserved | success; failed reservations are removed
  createdAt: timestamp("created_at").default(now).notNull(),
}, (t) => ({
  byChain: index("dispatch_wakes_chain_idx").on(t.chainId),
  byAgent: index("dispatch_wakes_agent_idx").on(t.targetAgentId),
}));

export const dispatchStops = sqliteTable("dispatch_stops", {
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  scopeType: text("scope_type").notNull(), // space | task
  scopeId: text("scope_id").notNull(),     // server id | task message id
  reason: text("reason"),
  stoppedAt: timestamp("stopped_at").default(now).notNull(),
  updatedAt: timestamp("updated_at").default(now).notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.serverId, t.scopeType, t.scopeId] }) }));

// @mentions: separate table for efficient "messages that mention me = inbox" queries + frontend highlighting
export const messageMentions = sqliteTable("message_mentions", {
  messageId: text("message_id").notNull().references(() => messages.id),
  mentionType: text("mention_type").notNull(),    // user | agent
  mentionId: text("mention_id").notNull(),
  mentionName: text("mention_name").notNull(),    // used for rendering
}, (t) => ({
  pk: primaryKey({ columns: [t.messageId, t.mentionType, t.mentionId] }),
  byMention: index("mentions_target_idx").on(t.mentionType, t.mentionId),
}));

export const reactions = sqliteTable("reactions", {
  id: id("id").primaryKey(),
  messageId: text("message_id").notNull().references(() => messages.id),
  memberType: text("member_type").notNull(),
  memberId: text("member_id").notNull(),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at").default(now).notNull(),
}, (t) => ({ uniq: uniqueIndex("reactions_uniq").on(t.messageId, t.memberType, t.memberId, t.emoji) }));

export const attachments = sqliteTable("attachments", {
  id: id("id").primaryKey(),
  messageId: text("message_id").references(() => messages.id), // back-filled after attaching to a message (null before attachment, not shown in files list)
  channelId: text("channel_id"),                  // recorded at upload time, used for /channels/:id/files
  serverId: text("server_id").notNull().references(() => servers.id),
  uploaderType: text("uploader_type"),            // user | agent
  uploaderId: text("uploader_id"),
  filename: text("filename").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  storageKey: text("storage_key").notNull(),      // opaque local filename under the app upload directory
  createdAt: timestamp("created_at").default(now).notNull(),
}, (t) => ({
  byChannel: index("attachments_channel_idx").on(t.channelId),
  idTextPrefix: index("attachments_id_text_prefix_idx").on(t.id),
}));

// ── Reminders / Knowledge base (tables created first, logic to follow) ────────────────────────
export const reminders = sqliteTable("reminders", {
  id: id("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id),
  ownerType: text("owner_type").notNull(),        // user | agent
  ownerId: text("owner_id").notNull(),
  channelId: text("channel_id").references(() => channels.id),
  content: text("content").notNull(),
  anchorMessageId: text("anchor_message_id"),     // anchor message (system reminder is posted in its channel/thread when fired)
  recurrence: text("recurrence"),                 // null = one-time; otherwise interval in seconds (simplified cadence)
  status: text("status").default("scheduled").notNull(), // scheduled | fired | cancelled
  remindAt: timestamp("remind_at").notNull(),
  firedAt: timestamp("fired_at"),
  createdAt: timestamp("created_at").default(now).notNull(),
}, (t) => ({ byDue: index("reminders_due_idx").on(t.remindAt) }));

export const knowledge = sqliteTable("knowledge", {
  id: id("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id),
  agentId: text("agent_id").references(() => agents.id),
  title: text("title").notNull(),
  content: text("content").notNull(),
  searchText: text("search_text"),
  createdAt: timestamp("created_at").default(now).notNull(),
});

// ── Agent activity log (activity-log: status|text|tool_start timeline) ──
export const agentActivityLog = sqliteTable("agent_activity_log", {
  id: id("id").primaryKey(),
  serverId: text("server_id").notNull(),
  agentId: text("agent_id").notNull(),
  ts: integer("ts").notNull(),                       // millisecond timestamp
  kind: text("kind").notNull(),                        // status | text | tool_start
  activity: text("activity"),                          // kind=status: online|working|thinking|offline
  detail: text("detail"),
  text: text("text"),                                  // kind=text: model output
  toolName: text("tool_name"),                         // kind=tool_start
  toolInput: text("tool_input"),
}, (t) => ({ byAgent: index("activity_agent_idx").on(t.agentId, t.ts) }));

// ── Sidebar preferences (GET/PUT /api/servers/:id/sidebar-order) ──
// One row per user per server: pinned items, sort order, hidden DMs, etc., stored as jsonb.
export const serverSidebarPrefs = sqliteTable("server_sidebar_prefs", {
  serverId: text("server_id").notNull().references(() => servers.id),
  userId: text("user_id").notNull().references(() => users.id),
  prefs: text("prefs", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at").default(now).notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.serverId, t.userId] }) }));

// ── Saved messages / bookmarks (GET/POST /channels/saved + DELETE /channels/saved/:id + POST /channels/saved/check) ──
// Private bookmark semantics: scoped per member, not broadcast to others; createdAt = savedAt.
export const savedMessages = sqliteTable("saved_messages", {
  id: id("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id),
  memberType: text("member_type").notNull(),   // user (primary) | agent (reserved)
  memberId: text("member_id").notNull(),
  messageId: text("message_id").notNull().references(() => messages.id),
  createdAt: timestamp("created_at").default(now).notNull(),
}, (t) => ({ uniq: uniqueIndex("saved_messages_uniq").on(t.memberType, t.memberId, t.messageId) }));

// ── Invite join links (POST /servers/:id/join-links) ──────
export const joinLinks = sqliteTable("join_links", {
  id: id("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id),
  token: text("token").notNull().unique(),            // URL invite token (sk-style random string)
  createdByUserId: text("created_by_user_id").references(() => users.id),
  role: text("role").default("member").notNull(),     // role assigned upon joining (owner-configurable at creation time, defaults to member)
  maxUses: integer("max_uses"),                       // null = unlimited
  useCount: integer("use_count").default(0).notNull(),
  expiresAt: timestamp("expires_at"), // null = never expires
  createdAt: timestamp("created_at").default(now).notNull(),
}, (t) => ({ byServer: index("join_links_server_idx").on(t.serverId) }));
