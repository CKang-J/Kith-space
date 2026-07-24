import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../src/db/index.ts";
import { kithSpaceHome } from "../src/paths.ts";
import { createMessage } from "../src/server/core.ts";
import { TaskOperationError } from "../src/tasks/taskTypes.ts";

async function withChannel(
  run: (fixture: { spaceId: string; channelId: string; targetId: string; otherId: string }) => Promise<void>,
): Promise<void> {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "agent-response-task-test", spaceId);
  registerSpace({ id: spaceId, name: "Response task", slug: `response-task-${spaceId}`, rootPath });
  const db = dbForSpace(spaceId);
  const targetId = randomUUID();
  const otherId = randomUUID();
  try {
    await db.insert(schema.agents).values([
      { id: targetId, spaceId, name: "target", displayName: "Target" },
      { id: otherId, spaceId, name: "other", displayName: "Other" },
    ]);
    const [channel] = await db.insert(schema.channels).values({ spaceId, name: "work", type: "channel" }).returning();
    await run({ spaceId, channelId: channel!.id, targetId, otherId });
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
}

test("As Task with one addressable Agent persists a real assignee and grants thread-only access", async () => {
  await withChannel(async ({ spaceId, channelId, targetId }) => {
    const db = dbForSpace(spaceId);
    const task = await createMessage({
      spaceId,
      channelId,
      senderType: "human",
      senderId: "human-1",
      senderName: "human",
      content: "@target prepare the release notes",
      asTask: true,
    });

    assert.equal(task.taskAssigneeType, "agent");
    assert.equal(task.taskAssigneeId, targetId);
    assert.equal(task.taskStatus, "in_progress");
    assert.ok(task.taskClaimedAt);
    assert.ok(task.threadId);
    const parentMembership = await db.select().from(schema.channelAgentMembers).where(and(
      eq(schema.channelAgentMembers.channelId, channelId),
      eq(schema.channelAgentMembers.agentId, targetId),
    ));
    assert.equal(parentMembership.length, 0, "targeted task must not grant parent-channel membership");
    const threadMembership = await db.select().from(schema.channelAgentMembers).where(and(
      eq(schema.channelAgentMembers.channelId, task.threadId!),
      eq(schema.channelAgentMembers.agentId, targetId),
    ));
    assert.equal(threadMembership.length, 1);
    const mentions = await db.select().from(schema.messageMentions).where(eq(schema.messageMentions.messageId, task.id));
    assert.deepEqual(mentions.map((mention) => mention.mentionId), [targetId]);
  });
});

test("As Task with multiple addressable Agents rejects before message or membership persistence", async () => {
  await withChannel(async ({ spaceId, channelId }) => {
    const db = dbForSpace(spaceId);
    await assert.rejects(createMessage({
      spaceId,
      channelId,
      senderType: "human",
      senderId: "human-1",
      senderName: "human",
      content: "@target and @other prepare the release notes",
      asTask: true,
    }), (error: unknown) => error instanceof TaskOperationError && error.code === "INVALID_ARGUMENT");

    assert.equal((await db.select().from(schema.messages)).length, 0);
    assert.equal((await db.select().from(schema.channelAgentMembers)).length, 0);
  });
});

test("As Task with @all rejects before message or membership persistence", async () => {
  await withChannel(async ({ spaceId, channelId }) => {
    const db = dbForSpace(spaceId);
    await assert.rejects(createMessage({
      spaceId,
      channelId,
      senderType: "human",
      senderId: "human-1",
      senderName: "human",
      content: "@all prepare the release notes",
      asTask: true,
    }), (error: unknown) => error instanceof TaskOperationError && error.code === "INVALID_ARGUMENT");

    assert.equal((await db.select().from(schema.messages)).length, 0);
    assert.equal((await db.select().from(schema.channelAgentMembers)).length, 0);
  });
});

test("DM As Task with a manually typed @all token also rejects without side effects", async () => {
  await withChannel(async ({ spaceId }) => {
    const db = dbForSpace(spaceId);
    const [dm] = await db.insert(schema.channels).values({ spaceId, name: "direct", type: "dm" }).returning();
    await assert.rejects(createMessage({
      spaceId,
      channelId: dm!.id,
      senderType: "human",
      senderId: "human-1",
      senderName: "human",
      content: "@all prepare the release notes",
      asTask: true,
    }), (error: unknown) => error instanceof TaskOperationError && error.code === "INVALID_ARGUMENT");

    assert.equal((await db.select().from(schema.messages)).length, 0);
    assert.equal((await db.select().from(schema.channelAgentMembers)).length, 0);
  });
});
