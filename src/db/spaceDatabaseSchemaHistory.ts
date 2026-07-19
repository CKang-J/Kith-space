import { getTableColumns, getTableName, type Table } from "drizzle-orm";
import * as schema from "./schema.js";

export const SPACE_DATABASE_SCHEMA_VERSION = 5;
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

function cloneSchema(source: Map<string, string[]>): Map<string, string[]> {
  return new Map([...source].map(([table, columns]) => [table, [...columns]]));
}

export function requiredSpaceSchema(version: number): Map<string, string[]> {
  const required = cloneSchema(WORKSPACE_V2_SCHEMA);
  for (let next = 3; next <= version; next++) {
    for (const [table, column] of ADDITIONS_BY_VERSION.get(next) ?? []) {
      const columns = required.get(table);
      if (!columns) throw new Error(`workspace schema history references unknown table ${table}`);
      columns.push(column);
    }
  }
  return required;
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
