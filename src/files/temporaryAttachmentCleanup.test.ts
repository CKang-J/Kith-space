import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { utimes } from "node:fs/promises";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { kithSpaceHome } from "../paths.js";
import { readObject, saveObject } from "./localObjectStorage.js";
import { cleanupTemporaryAttachments, runTemporaryAttachmentMaintenance } from "./temporaryAttachmentCleanup.js";

test("expired and crash-claimed temporary attachments are removed without touching live uploads", async () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "temporary-attachments", spaceId);
  registerSpace({ id: spaceId, name: "Temporary attachments", slug: `temporary-${spaceId}`, rootPath });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "uploader", displayName: "Uploader", status: "active" }).run();
    const expiredObject = await saveObject(spaceId, "expired.txt", Readable.from("expired"));
    const deletingObject = await saveObject(spaceId, "deleting.txt", Readable.from("deleting"));
    const liveObject = await saveObject(spaceId, "live.txt", Readable.from("live"));
    const orphanObject = await saveObject(spaceId, "orphan.txt", Readable.from("orphan"));
    await utimes(path.join(rootPath, ".kith", "uploads", orphanObject.key), new Date(0), new Date(0));
    const rows = db.insert(schema.attachments).values([
      { spaceId, uploaderType: "agent", uploaderId: agentId, filename: "expired.txt", storageKey: expiredObject.key, uploadState: "temporary", sourceTurnId: randomUUID(), sourceActivationId: randomUUID(), expiresAt: new Date(999) },
      { spaceId, uploaderType: "agent", uploaderId: agentId, filename: "deleting.txt", storageKey: deletingObject.key, uploadState: "deleting", sourceTurnId: randomUUID(), sourceActivationId: randomUUID(), expiresAt: new Date(999) },
      { spaceId, uploaderType: "agent", uploaderId: agentId, filename: "live.txt", storageKey: liveObject.key, uploadState: "temporary", sourceTurnId: randomUUID(), sourceActivationId: randomUUID(), expiresAt: new Date(10_000_000) },
    ]).returning().all();
    assert.deepEqual(await cleanupTemporaryAttachments(spaceId, db, () => 4_000_000), { claimed: 2, deleted: 2, orphaned: 1 });
    assert.equal(db.select().from(schema.attachments).all().length, 1);
    await assert.rejects(() => readObject(spaceId, expiredObject.key));
    await assert.rejects(() => readObject(spaceId, deletingObject.key));
    await assert.rejects(() => readObject(spaceId, orphanObject.key));
    assert.equal((await readObject(spaceId, liveObject.key)).toString(), "live");
    assert.equal(db.select().from(schema.attachments).all()[0]?.id, rows[2]!.id);
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});

test("attachment maintenance fails open when storage inspection is unavailable", async () => {
  const failure = new Error("uploads directory unavailable");
  assert.deepEqual(await runTemporaryAttachmentMaintenance("space", async () => { throw failure; }), { ok: false, error: failure });
});
