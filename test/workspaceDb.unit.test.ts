import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { dbFor, listWorkspaces, registerWorkspace, schema } from "../src/db/index.ts";
import { forgetWorkspaceCounters, nextSeq } from "../src/counters.ts";
import { kithSpaceHome, workspaceDbFile } from "../src/paths.ts";

const firstId = randomUUID();
const secondId = randomUUID();
const firstRoot = path.join(kithSpaceHome(), "workspace-db-test", firstId);
const secondRoot = path.join(kithSpaceHome(), "workspace-db-test", secondId);
registerWorkspace({ id: firstId, name: "First", rootPath: firstRoot });
registerWorkspace({ id: secondId, name: "Second", rootPath: secondRoot });
const firstDb = dbFor(firstId);
const secondDb = dbFor(secondId);

async function seed(db: typeof firstDb, id: string, rootPath: string, suffix: string) {
  const userId = randomUUID();
  const channelId = randomUUID();
  await db.insert(schema.users).values({ id: userId, name: `owner-${suffix}`, displayName: "Owner", email: `${suffix}@test.local` });
  await db.insert(schema.servers).values({ id, name: suffix, slug: suffix, ownerId: userId, rootPath });
  await db.insert(schema.channels).values({ id: channelId, serverId: id, name: "all", type: "channel" });
  return { userId, channelId };
}

test("app.db records Space roots and dbFor keeps workspace connections isolated", async () => {
  const first = await seed(firstDb, firstId, firstRoot, "first");
  await seed(secondDb, secondId, secondRoot, "second");
  await firstDb.insert(schema.messages).values({ serverId: firstId, channelId: first.channelId, senderType: "user", senderId: first.userId, senderName: "owner", content: "first only", seq: 41 });

  assert.ok(existsSync(workspaceDbFile(firstRoot)));
  assert.ok(existsSync(workspaceDbFile(secondRoot)));
  assert.equal((await firstDb.select().from(schema.messages)).length, 1);
  assert.equal((await secondDb.select().from(schema.messages)).length, 0);
  assert.deepEqual(new Set(listWorkspaces().map((workspace) => workspace.id)), new Set([firstId, secondId]));
});

test("counter lazy alignment resumes from the persisted workspace maximum", async () => {
  forgetWorkspaceCounters(firstId);
  assert.equal(await nextSeq(firstId), 42);
  const persisted = (await firstDb.select().from(schema.messages).where(eq(schema.messages.serverId, firstId)))[0];
  assert.equal(persisted?.seq, 41);
});
