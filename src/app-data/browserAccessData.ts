import { appDataConnection } from "./appDatabase.js";

export type StoredBrowserAccessMode = "off" | "local" | "lan";

export interface BrowserAccessSettingsRecord {
  mode: StoredBrowserAccessMode;
  port: number;
  accessTokenHash: string | null;
  tokenRevision: number;
}

export interface BrowserSessionRecord {
  tokenRevision: number;
  createdAt: Date;
  lastSeenAt: Date;
}

type BrowserAccessSettingsRow = {
  mode: StoredBrowserAccessMode;
  port: number;
  access_token_hash: string | null;
  token_revision: number;
};

type BrowserSessionRow = {
  token_revision: number;
  created_at: number;
  last_seen_at: number;
};

function mapSettings(row: BrowserAccessSettingsRow): BrowserAccessSettingsRecord {
  return {
    mode: row.mode,
    port: row.port,
    accessTokenHash: row.access_token_hash,
    tokenRevision: row.token_revision,
  };
}

function mapSession(row: BrowserSessionRow): BrowserSessionRecord {
  return {
    tokenRevision: row.token_revision,
    createdAt: new Date(row.created_at),
    lastSeenAt: new Date(row.last_seen_at),
  };
}

export function readBrowserAccessSettings(): BrowserAccessSettingsRecord {
  const row = appDataConnection().prepare(`
    SELECT mode, port, access_token_hash, token_revision
    FROM browser_access_settings
    WHERE singleton_key = 1
  `).get() as BrowserAccessSettingsRow;
  return mapSettings(row);
}

export function writeBrowserAccessPolicy(input: {
  mode: StoredBrowserAccessMode;
  port: number;
}): BrowserAccessSettingsRecord {
  appDataConnection().prepare(`
    UPDATE browser_access_settings
    SET mode = @mode, port = @port
    WHERE singleton_key = 1
  `).run(input);
  return readBrowserAccessSettings();
}

export function rotateStoredAccessToken(accessTokenHash: string): number {
  const sqlite = appDataConnection();
  return sqlite.transaction(() => {
    const current = sqlite.prepare(`
      SELECT token_revision FROM browser_access_settings WHERE singleton_key = 1
    `).get() as { token_revision: number };
    const revision = current.token_revision + 1;
    sqlite.prepare(`
      UPDATE browser_access_settings
      SET access_token_hash = ?, token_revision = ?
      WHERE singleton_key = 1
    `).run(accessTokenHash, revision);
    sqlite.prepare("DELETE FROM browser_sessions").run();
    return revision;
  })();
}

export function insertBrowserSession(input: {
  tokenHash: string;
  tokenRevision: number;
  createdAt: Date;
}): boolean {
  const sqlite = appDataConnection();
  return sqlite.transaction(() => {
    const settings = sqlite.prepare(`
      SELECT token_revision FROM browser_access_settings WHERE singleton_key = 1
    `).get() as { token_revision: number };
    if (settings.token_revision !== input.tokenRevision) return false;
    const timestamp = input.createdAt.getTime();
    const result = sqlite.prepare(`
      INSERT INTO browser_sessions (token_hash, token_revision, created_at, last_seen_at)
      VALUES (@tokenHash, @tokenRevision, @timestamp, @timestamp)
    `).run({ ...input, timestamp });
    return result.changes === 1;
  })();
}

export function findActiveBrowserSession(tokenHash: string): BrowserSessionRecord | undefined {
  const row = appDataConnection().prepare(`
    SELECT session.token_revision, session.created_at, session.last_seen_at
    FROM browser_sessions AS session
    INNER JOIN browser_access_settings AS settings
      ON settings.singleton_key = 1
      AND settings.token_revision = session.token_revision
    WHERE session.token_hash = ?
  `).get(tokenHash) as BrowserSessionRow | undefined;
  return row ? mapSession(row) : undefined;
}

export function touchActiveBrowserSession(tokenHash: string, touchedAt: Date): boolean {
  const result = appDataConnection().prepare(`
    UPDATE browser_sessions
    SET last_seen_at = @touchedAt
    WHERE token_hash = @tokenHash
      AND token_revision = (
        SELECT token_revision FROM browser_access_settings WHERE singleton_key = 1
      )
  `).run({ tokenHash, touchedAt: touchedAt.getTime() });
  return result.changes === 1;
}

export function revokeBrowserSession(tokenHash: string): boolean {
  return appDataConnection().prepare(`
    DELETE FROM browser_sessions WHERE token_hash = ?
  `).run(tokenHash).changes === 1;
}

export function revokeAllBrowserSessions(): number {
  return appDataConnection().prepare("DELETE FROM browser_sessions").run().changes;
}

export function countActiveBrowserSessions(): number {
  const row = appDataConnection().prepare(`
    SELECT COUNT(*) AS count
    FROM browser_sessions AS session
    INNER JOIN browser_access_settings AS settings
      ON settings.singleton_key = 1
      AND settings.token_revision = session.token_revision
  `).get() as { count: number };
  return row.count;
}
