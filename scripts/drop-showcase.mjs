#!/usr/bin/env node
// One-off, idempotent cleanup of legacy DB-backed showcase fixtures across all registered workspaces.
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const home = process.env.KITH_SPACE_HOME ?? path.join(os.homedir(), ".kith-space");
const registryPath = path.join(home, "registry.db");
const uploadsDir = () => process.env.KITH_SPACE_UPLOAD_DIR ?? path.join(home, "uploads");

async function deleteBlob(storageKey) {
  if ((process.env.KITH_SPACE_STORAGE ?? "local") === "s3") {
    const mod = await import("@aws-sdk/client-s3");
    const client = new mod.S3Client({
      endpoint: process.env.KITH_SPACE_S3_ENDPOINT,
      region: process.env.KITH_SPACE_S3_REGION ?? "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId: process.env.KITH_SPACE_S3_KEY, secretAccessKey: process.env.KITH_SPACE_S3_SECRET },
    });
    await client.send(new mod.DeleteObjectCommand({ Bucket: process.env.KITH_SPACE_S3_BUCKET, Key: storageKey }));
    return;
  }
  await unlink(path.isAbsolute(storageKey) ? storageKey : path.join(uploadsDir(), storageKey));
}

const placeholders = (values) => values.map(() => "?").join(",");

function cleanWorkspace(rootPath) {
  const dbPath = path.join(rootPath, ".kith", "workspace.db");
  if (!existsSync(dbPath)) return { counts: { channels: 0, agents: 0, messages: 0, attachments: 0 }, blobKeys: [] };
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  const counts = { channels: 0, agents: 0, messages: 0, attachments: 0 };
  const blobKeys = [];
  db.transaction(() => {
    const showcaseIds = db.prepare("SELECT id FROM channels WHERE type = 'showcase'").all().map((row) => row.id);
    const threadIds = showcaseIds.length
      ? db.prepare(`SELECT id FROM channels WHERE type = 'thread' AND parent_message_id IN (SELECT id FROM messages WHERE channel_id IN (${placeholders(showcaseIds)}))`).all(...showcaseIds).map((row) => row.id)
      : [];
    const channelIds = [...showcaseIds, ...threadIds];
    if (channelIds.length) {
      const marks = placeholders(channelIds);
      const messageIds = db.prepare(`SELECT id FROM messages WHERE channel_id IN (${marks})`).all(...channelIds).map((row) => row.id);
      blobKeys.push(...db.prepare(`SELECT storage_key FROM attachments WHERE channel_id IN (${marks})`).all(...channelIds).map((row) => row.storage_key));
      if (messageIds.length) {
        const messageMarks = placeholders(messageIds);
        db.prepare(`DELETE FROM message_mentions WHERE message_id IN (${messageMarks})`).run(...messageIds);
        db.prepare(`DELETE FROM reactions WHERE message_id IN (${messageMarks})`).run(...messageIds);
        db.prepare(`DELETE FROM saved_messages WHERE message_id IN (${messageMarks})`).run(...messageIds);
      }
      counts.attachments += db.prepare(`DELETE FROM attachments WHERE channel_id IN (${marks})`).run(...channelIds).changes;
      counts.messages += db.prepare(`DELETE FROM messages WHERE channel_id IN (${marks})`).run(...channelIds).changes;
      db.prepare(`DELETE FROM channel_members WHERE channel_id IN (${marks})`).run(...channelIds);
      db.prepare(`DELETE FROM reminders WHERE channel_id IN (${marks})`).run(...channelIds);
      counts.channels += db.prepare(`DELETE FROM channels WHERE id IN (${marks})`).run(...channelIds).changes;
    }
    db.prepare("DELETE FROM knowledge WHERE agent_id IN (SELECT id FROM agents WHERE creator_type = 'system')").run();
    counts.agents += db.prepare("DELETE FROM agents WHERE creator_type = 'system'").run().changes;
  })();
  db.close();
  return { counts, blobKeys };
}

async function main() {
  if (!existsSync(registryPath)) throw new Error(`registry not found: ${registryPath}`);
  const registry = new Database(registryPath, { readonly: true });
  const workspaces = registry.prepare("SELECT name, root_path FROM workspaces").all();
  registry.close();
  const total = { channels: 0, agents: 0, messages: 0, attachments: 0 };
  let blobsDeleted = 0;
  let blobCount = 0;
  for (const workspace of workspaces) {
    const result = cleanWorkspace(workspace.root_path);
    for (const key of Object.keys(total)) total[key] += result.counts[key];
    blobCount += result.blobKeys.length;
    for (const key of result.blobKeys) {
      try { await deleteBlob(key); blobsDeleted++; }
      catch (error) { console.warn(`[drop-showcase] WARN could not delete blob "${key}": ${error?.message ?? error}`); }
    }
    console.log(`[drop-showcase] scanned ${workspace.name}`);
  }
  console.log("[drop-showcase] done:");
  console.log(`  channels deleted    : ${total.channels}`);
  console.log(`  agents deleted      : ${total.agents}`);
  console.log(`  messages deleted    : ${total.messages}`);
  console.log(`  attachments deleted : ${total.attachments} (blobs removed: ${blobsDeleted}/${blobCount})`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
