import { getTableColumns, getTableName, type Table } from "drizzle-orm";
import * as schema from "./schema.js";

export const SPACE_DATABASE_SCHEMA_VERSION = 6;
export const MIN_MIGRATABLE_SPACE_DATABASE_SCHEMA_VERSION = 2;

export interface WorkspaceMigrationHistoryEntry {
  version: number;
  tag: string;
  createdAt: number;
  hash: string;
}

export const WORKSPACE_MIGRATION_HISTORY: readonly WorkspaceMigrationHistoryEntry[] = [
  { version: 2, tag: "0000_personal_agent_os", createdAt: 1783764218492, hash: "621b4c50671d63338c7402838ce1fc3bdd403a448c42702a34218be818e77d62" },
  { version: 3, tag: "0001_agent_introduction", createdAt: 1783850095957, hash: "9d8c9e0685cc3dd27a88c98c465280ce9006759a05432483ac41f4640326f7ec" },
  { version: 4, tag: "0002_channel_notification_level", createdAt: 1783997806829, hash: "1772f58417d30a1d6ccbc697355a689332aa5b5d6ef744d49192393b8b874b92" },
  { version: 5, tag: "0003_agent_response_modes", createdAt: 1784024369419, hash: "e68d1bc76c3f3ab071fb460c130ddaba7f0adab64396e96deb4d9cccc192432e" },
  { version: 6, tag: "0004_agent_harness_sessions", createdAt: 1784457381025, hash: "9e9ffe6cd2fa1dd5953170e58f12eeacb84a98c21e4ec2bbaedb6479fab8ae1f" },
  { version: 6, tag: "0005_agent_durable_turns", createdAt: 1784458418697, hash: "25ec3ae6d1c99b89fbeacb6a69228ca9bf910974d78ab2b18512fea3e833a656" },
];

/** Immutable v2 baseline. Later schema entries are layered on explicitly below. */
const WORKSPACE_V2_SCHEMA = new Map<string, string[]>([
  ["agent_activity_log", ["id", "space_id", "agent_id", "ts", "kind", "activity", "detail", "text", "tool_name", "tool_input"]],
  ["agents", ["id", "space_id", "name", "display_name", "avatar_url", "description", "status", "activity", "session_id", "model", "runtime", "runtime_config", "execution_mode", "env_vars", "agent_token_hash", "scopes", "creator_type", "creator_id", "deleted_at", "created_at"]],
  ["attachments", ["id", "message_id", "channel_id", "space_id", "uploader_type", "uploader_id", "filename", "mime_type", "size_bytes", "storage_key", "created_at"]],
  ["channel_agent_members", ["channel_id", "agent_id", "last_read_seq", "joined_at"]],
  ["channels", ["id", "space_id", "name", "description", "type", "parent_message_id", "last_message_at", "archived_at", "deleted_at", "created_at"]],
  ["dispatch_chains", ["id", "space_id", "root_message_id", "task_message_id", "channel_id", "wake_count", "max_depth_seen", "last_rejection_code", "last_rejection_reason", "last_rejected_at", "last_rejected_message_id", "last_rejected_agent_id", "created_at", "updated_at"]],
  ["dispatch_contexts", ["space_id", "agent_id", "channel_id", "chain_id", "dispatch_depth", "updated_at"]],
  ["dispatch_stops", ["space_id", "scope_type", "scope_id", "reason", "stopped_at", "updated_at"]],
  ["dispatch_wakes", ["id", "space_id", "chain_id", "message_id", "target_agent_id", "dispatch_depth", "status", "created_at"]],
  ["human_channel_states", ["channel_id", "last_read_seq", "dm_agent_id", "thread_followed_at", "thread_done_at", "updated_at"]],
  ["human_saved_messages", ["space_id", "message_id", "created_at"]],
  ["human_space_preferences", ["space_id", "prefs", "updated_at"]],
  ["knowledge", ["id", "space_id", "agent_id", "title", "content", "search_text", "created_at"]],
  ["message_mentions", ["message_id", "mention_type", "mention_id", "mention_name"]],
  ["messages", ["id", "seq", "space_id", "channel_id", "sender_type", "sender_id", "sender_name", "message_type", "content", "action_metadata", "thread_id", "task_status", "task_number", "task_assignee_type", "task_assignee_id", "task_claimed_at", "task_completed_at", "task_parent_id", "task_revision", "task_execution_mode", "dispatch_chain_id", "dispatch_depth", "search_text", "created_at", "updated_at"]],
  ["reactions", ["id", "message_id", "actor_type", "actor_id", "emoji", "created_at"]],
  ["reminders", ["id", "space_id", "owner_type", "owner_id", "channel_id", "content", "anchor_message_id", "recurrence", "status", "remind_at", "fired_at", "created_at"]],
  ["spaces", ["id", "name", "slug", "avatar_url", "created_at"]],
  ["task_number_counters", ["scope_key", "last_number"]],
]);

const ADDITIONS_BY_VERSION = new Map<number, Array<[string, string]>>([
  [3, [["agents", "introduced_at"]]],
  [4, [["human_channel_states", "notification_level"]]],
  [5, [
    ["agents", "default_response_mode"],
    ["channel_agent_members", "response_mode_override"],
    ["channel_agent_members", "ambient_wake_after_seq"],
    ["channel_agent_members", "mention_wake_after_seq"],
  ]],
]);

const TABLES_BY_MIGRATION = new Map<string, Array<[string, string[]]>>([
  ["0004_agent_harness_sessions", [
    ["agent_harness_state", ["agent_id", "mode", "cutover_at", "rollback_until", "migration_audit_json"]],
    ["runtime_sessions", [
      "id", "space_id", "agent_id", "surface_kind", "surface_id", "session_generation",
      "runtime", "model", "runtime_config_fingerprint", "adapter_version", "engine_session_id",
      "engine_host_fingerprint", "workspace_root_fingerprint", "status", "last_turn_id",
      "last_active_at", "last_compacted_at", "retired_at", "snapshot_version", "snapshot_json",
      "snapshot_checksum", "snapshot_saved_at", "created_at", "updated_at",
    ]],
  ]],
  ["0005_agent_durable_turns", [
    ["agent_delivery_items", [
      "id", "space_id", "agent_id", "message_id", "source_channel_id", "source_seq",
      "cursor_owner_channel_id", "target_surface_kind", "target_surface_id", "target_runtime_session_id",
      "directive", "reason", "policy_snapshot_json", "disposition", "turn_id", "dispatch_wake_id",
      "created_at", "settled_at",
    ]],
    ["agent_turns", [
      "id", "runtime_session_id", "session_generation", "space_id", "agent_id", "status", "outcome",
      "effective_directive", "context_envelope_json", "max_attempts", "next_attempt_at", "created_at", "completed_at",
    ]],
    ["agent_turn_attempts", [
      "id", "turn_id", "attempt_no", "status", "worker_generation", "lease_owner", "lease_expires_at",
      "heartbeat_at", "engine_session_id_before", "engine_session_id_after", "usage_json", "error_code",
      "error_detail_redacted", "event_count", "event_payload_bytes", "claimed_at", "admitted_at", "started_at", "completed_at",
    ]],
    ["agent_turn_events", ["attempt_id", "ordinal", "kind", "payload_json", "created_at"]],
    ["turn_operations", [
      "id", "turn_id", "tool_name", "idempotency_key", "request_hash", "operation_slot", "status",
      "result_ref_json", "error_code", "created_at", "updated_at",
    ]],
    ["turn_outputs", ["id", "turn_id", "operation_id", "output_kind", "message_id", "created_at"]],
    ["turn_output_inputs", ["output_id", "delivery_item_id"]],
    ["turn_context_sources", [
      "id", "turn_id", "phase", "ordinal", "source_kind", "source_id", "source_revision", "snapshot_id",
      "visibility", "disclosure_projection", "injection_mode", "reason", "token_estimate", "content_hmac", "created_at",
    ]],
    ["turn_context_snapshots", ["id", "payload_json_redacted", "payload_hmac", "retention_class", "created_at", "expires_at"]],
    ["turn_capability_activations", [
      "id", "turn_id", "attempt_id", "session_generation", "worker_generation", "claims_digest", "status",
      "expires_at", "activated_at", "revoked_at",
    ]],
    ["disclosure_grants", [
      "id", "turn_id", "source_refs_json", "target_surface_id", "action_digest", "allowed_projection", "status",
      "expires_at", "consumed_at", "created_by",
    ]],
    ["session_checklist_items", [
      "id", "runtime_session_id", "text", "status", "sort_order", "source_turn_id", "row_version", "created_at", "updated_at",
    ]],
    ["session_wakeups", [
      "id", "runtime_session_id", "session_generation", "owner_agent_id", "due_at", "reason", "status",
      "idempotency_key", "source_turn_id", "lease_owner", "lease_expires_at", "created_at", "fired_at",
    ]],
  ]],
]);

const ADDITIONS_BY_MIGRATION = new Map<string, Array<[string, string]>>([
  ["0005_agent_durable_turns", [
    ["messages", "memory_policy"],
    ["messages", "context_snapshot_json"],
    ["messages", "produced_by_turn_id"],
    ["channel_agent_members", "access_kind"],
    ["channel_agent_members", "task_scope_json"],
    ["channel_agent_members", "access_expires_at"],
  ]],
]);

function cloneSchema(source: Map<string, string[]>): Map<string, string[]> {
  return new Map([...source].map(([table, columns]) => [table, [...columns]]));
}

function appliedEntries(version: number, migrationCount?: number): readonly WorkspaceMigrationHistoryEntry[] {
  const eligible = WORKSPACE_MIGRATION_HISTORY.filter((entry) => entry.version <= version);
  return eligible.slice(0, migrationCount ?? eligible.length);
}

export function requiredSpaceSchema(version: number, migrationCount?: number): Map<string, string[]> {
  const required = cloneSchema(WORKSPACE_V2_SCHEMA);
  for (let next = 3; next <= version; next++) {
    for (const [table, column] of ADDITIONS_BY_VERSION.get(next) ?? []) {
      const columns = required.get(table);
      if (!columns) throw new Error(`workspace schema history references unknown table ${table}`);
      columns.push(column);
    }
  }
  for (const entry of appliedEntries(version, migrationCount)) {
    for (const [table, columns] of TABLES_BY_MIGRATION.get(entry.tag) ?? []) {
      if (required.has(table)) throw new Error(`workspace schema history redefines table ${table}`);
      required.set(table, [...columns]);
    }
    for (const [table, column] of ADDITIONS_BY_MIGRATION.get(entry.tag) ?? []) {
      const columns = required.get(table);
      if (!columns) throw new Error(`workspace schema history references unknown table ${table}`);
      columns.push(column);
    }
  }
  return required;
}

export function requiredSpaceIndexes(version: number, migrationCount?: number): string[] {
  const tags = new Set(appliedEntries(version, migrationCount).map((entry) => entry.tag));
  return [
    ...(tags.has("0004_agent_harness_sessions") ? [
      "runtime_sessions_generation_uniq", "runtime_sessions_current_uniq", "runtime_sessions_agent_status_idx",
    ] : []),
    ...(tags.has("0005_agent_durable_turns") ? [
      "agent_delivery_items_agent_message_uniq", "agent_delivery_items_agent_disposition_seq_idx",
      "agent_delivery_items_cursor_owner_seq_idx", "agent_turns_active_session_uniq", "agent_turns_schedule_idx",
      "agent_turn_attempts_lease_idx", "turn_operations_key_uniq", "session_wakeups_due_idx",
    ] : []),
  ];
}

export function requiredSpaceForeignKeys(version: number, migrationCount?: number): Array<{
  table: string;
  from: string;
  targetTable: string;
  onDelete: string;
}> {
  const tags = new Set(appliedEntries(version, migrationCount).map((entry) => entry.tag));
  return [
    ...(tags.has("0004_agent_harness_sessions") ? [
    { table: "agent_harness_state", from: "agent_id", targetTable: "agents", onDelete: "CASCADE" },
    { table: "runtime_sessions", from: "space_id", targetTable: "spaces", onDelete: "CASCADE" },
    { table: "runtime_sessions", from: "agent_id", targetTable: "agents", onDelete: "CASCADE" },
    ] : []),
    ...(tags.has("0005_agent_durable_turns") ? [
      { table: "agent_turns", from: "runtime_session_id", targetTable: "runtime_sessions", onDelete: "CASCADE" },
      { table: "agent_turns", from: "space_id", targetTable: "spaces", onDelete: "CASCADE" },
      { table: "agent_turns", from: "agent_id", targetTable: "agents", onDelete: "CASCADE" },
      { table: "agent_turn_attempts", from: "turn_id", targetTable: "agent_turns", onDelete: "CASCADE" },
      { table: "agent_turn_events", from: "attempt_id", targetTable: "agent_turn_attempts", onDelete: "CASCADE" },
      { table: "agent_delivery_items", from: "message_id", targetTable: "messages", onDelete: "CASCADE" },
      { table: "agent_delivery_items", from: "target_runtime_session_id", targetTable: "runtime_sessions", onDelete: "SET NULL" },
      { table: "agent_delivery_items", from: "turn_id", targetTable: "agent_turns", onDelete: "SET NULL" },
      { table: "turn_operations", from: "turn_id", targetTable: "agent_turns", onDelete: "CASCADE" },
      { table: "turn_outputs", from: "operation_id", targetTable: "turn_operations", onDelete: "CASCADE" },
      { table: "turn_output_inputs", from: "delivery_item_id", targetTable: "agent_delivery_items", onDelete: "CASCADE" },
      { table: "turn_context_sources", from: "snapshot_id", targetTable: "turn_context_snapshots", onDelete: "SET NULL" },
      { table: "turn_capability_activations", from: "attempt_id", targetTable: "agent_turn_attempts", onDelete: "CASCADE" },
      { table: "session_checklist_items", from: "runtime_session_id", targetTable: "runtime_sessions", onDelete: "CASCADE" },
      { table: "session_wakeups", from: "runtime_session_id", targetTable: "runtime_sessions", onDelete: "CASCADE" },
    ] : []),
  ];
}

const CURRENT_SCHEMA = new Map<string, string[]>(
  (Object.values(schema) as Table[]).map((table) => [
    getTableName(table),
    Object.values(getTableColumns(table)).map((column) => column.name),
  ]),
);
const CURRENT_MANIFEST = requiredSpaceSchema(SPACE_DATABASE_SCHEMA_VERSION);
for (const [table, columns] of CURRENT_SCHEMA) {
  const registered = CURRENT_MANIFEST.get(table);
  if (!registered || [...registered].sort().join("\0") !== [...columns].sort().join("\0")) {
    throw new Error(`workspace schema history is not synchronized with current table ${table}`);
  }
}
for (const table of CURRENT_MANIFEST.keys()) {
  if (!CURRENT_SCHEMA.has(table)) throw new Error(`workspace schema history contains removed table ${table}`);
}
