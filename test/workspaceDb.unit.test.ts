import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { initializeHumanProfile } from "../src/app-data/appDatabase.ts";
import { dbForSpace, listSpaces, registerSpace, schema } from "../src/db/index.ts";
import { forgetSpaceCounters, nextSeq } from "../src/counters.ts";
import { kithSpaceHome, workspaceDbFile } from "../src/paths.ts";

const firstId = randomUUID();
const secondId = randomUUID();
const firstRoot = path.join(kithSpaceHome(), "workspace-db-test", firstId);
const secondRoot = path.join(kithSpaceHome(), "workspace-db-test", secondId);
registerSpace({ id: firstId, name: "First", rootPath: firstRoot });
registerSpace({ id: secondId, name: "Second", rootPath: secondRoot });
const firstDb = dbForSpace(firstId);
const secondDb = dbForSpace(secondId);
const human = initializeHumanProfile({ name: "Owner" });
const firstAll = firstDb.select().from(schema.channels).where(and(
  eq(schema.channels.spaceId, firstId),
  eq(schema.channels.name, "all"),
)).get()!;

test("app.db records Space roots and dbForSpace keeps Space connections isolated", async () => {
  await firstDb.insert(schema.messages).values({ spaceId: firstId, channelId: firstAll.id, senderType: "human", senderId: human.id, senderName: human.name, content: "first only", seq: 41 });

  assert.ok(existsSync(workspaceDbFile(firstRoot)));
  assert.ok(existsSync(workspaceDbFile(secondRoot)));
  assert.equal((await firstDb.select().from(schema.messages)).length, 1);
  assert.equal((await secondDb.select().from(schema.messages)).length, 0);
  assert.deepEqual(new Set(listSpaces().map((space) => space.id)), new Set([firstId, secondId]));
});

test("counter lazy alignment resumes from the persisted workspace maximum", async () => {
  forgetSpaceCounters(firstId);
  assert.equal(await nextSeq(firstId), 42);
  const persisted = (await firstDb.select().from(schema.messages).where(eq(schema.messages.spaceId, firstId)))[0];
  assert.equal(persisted?.seq, 41);
});
