import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export const REQUIRED_CHANNEL_NAME = "all";

export interface RequiredChannelCandidate {
  name: string;
  type: string;
}

export function isRequiredChannel(channel: RequiredChannelCandidate | null | undefined): boolean {
  return channel?.name === REQUIRED_CHANNEL_NAME && channel.type === "channel";
}

/**
 * Restore the one required #all channel, preferring an already-live row when a
 * previous release created a replacement beside a soft-deleted original.
 */
export function ensureRequiredChannels(sqlite: Database.Database, spaceId: string): string {
  const existing = sqlite.prepare(`
    SELECT id
    FROM channels
    WHERE space_id = ? AND name = ? AND type = 'channel'
    ORDER BY CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END, created_at ASC, id ASC
    LIMIT 1
  `).get(spaceId, REQUIRED_CHANNEL_NAME) as { id: string } | undefined;

  if (existing) {
    sqlite.prepare("UPDATE channels SET archived_at = NULL, deleted_at = NULL WHERE id = ?").run(existing.id);
    return existing.id;
  }

  const id = randomUUID();
  sqlite.prepare(`
    INSERT INTO channels (id, space_id, name, description, type, created_at)
    VALUES (?, ?, ?, ?, 'channel', unixepoch() * 1000)
  `).run(id, spaceId, REQUIRED_CHANNEL_NAME, "General channel for the Human and all agents");
  return id;
}
