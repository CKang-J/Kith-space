import assert from "node:assert/strict";
import { and, eq, isNotNull } from "drizzle-orm";
import { integrationDatabase } from "./helpers/workspace.ts";
import { closeAllDatabases } from "../src/db/index.ts";
import { addChannelMembers, assignTask, createMessage, getOrCreateThread } from "../src/server/core.ts";
import { fireReminder } from "../src/server/reminders.ts";
import { createInMemoryEventAdapter } from "../src/server/testing/inMemoryEventAdapter.ts";

const { db, schema, spaceId, human, all } = integrationDatabase("p-a9-message-commit-characterization");
const sqlite = db.$client;
const realtime = createInMemoryEventAdapter();

try {
  const [channel] = await db.insert(schema.channels).values({ spaceId, name: "commit-facts", type: "channel" }).returning();
  assert.ok(channel);
  const [agent] = await db.insert(schema.agents).values({
    spaceId,
    name: "offline-agent",
    displayName: "Offline Agent",
    runtime: "claude",
    defaultResponseMode: "mention_only",
  }).returning();
  assert.ok(agent);

  realtime.clear();
  sqlite.exec(`
    CREATE TRIGGER p_a9_fail_dispatch_chain
    BEFORE INSERT ON dispatch_chains
    BEGIN
      SELECT RAISE(ABORT, 'p-a9 dispatch chain failure');
    END;
  `);
  await assert.rejects(() => createMessage({
    spaceId,
    channelId: channel.id,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "message rolls back with chain failure",
  }), /p-a9 dispatch chain failure/);
  const rolledBackMessage = await db.select().from(schema.messages).where(eq(
    schema.messages.content,
    "message rolls back with chain failure",
  )).get();
  assert.equal(rolledBackMessage, undefined, "message and dispatch-chain persistence commit atomically");
  assert.deepEqual(realtime.events().map((event) => event.type), [], "failed durable work emits no realtime event");
  sqlite.exec("DROP TRIGGER p_a9_fail_dispatch_chain;");

  realtime.clear();
  sqlite.exec(`
    CREATE TRIGGER p_a9_fail_task_audit
    BEFORE INSERT ON messages
    WHEN NEW.message_type = 'system'
    BEGIN
      SELECT RAISE(ABORT, 'p-a9 task audit failure');
    END;
  `);
  await assert.rejects(() => createMessage({
    spaceId,
    channelId: channel.id,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "task rolls back with audit failure",
    asTask: true,
  }), /p-a9 task audit failure/);
  const rolledBackTask = await db.select().from(schema.messages).where(and(
    eq(schema.messages.content, "task rolls back with audit failure"),
    isNotNull(schema.messages.taskStatus),
  )).get();
  assert.equal(rolledBackTask, undefined, "task, owning thread, and system audit commit atomically");
  assert.equal(
    (await db.select().from(schema.channels).where(eq(schema.channels.type, "thread"))).length,
    0,
    "a rolled-back task leaves no owning thread",
  );
  assert.deepEqual(
    realtime.events().map((event) => event.type),
    [],
    "a rolled-back task emits no realtime event",
  );
  sqlite.exec("DROP TRIGGER p_a9_fail_task_audit;");

  const assignmentTask = await createMessage({
    spaceId,
    channelId: channel.id,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "task for assignment audit",
    asTask: true,
  });
  assert.ok(assignmentTask.threadId);

  realtime.clear();
  sqlite.exec(`
    CREATE TRIGGER p_a9_fail_task_assignment_audit
    BEFORE INSERT ON messages
    WHEN NEW.message_type = 'system' AND NEW.content LIKE '% assigned #%'
    BEGIN
      SELECT RAISE(ABORT, 'p-a9 task assignment failure');
    END;
  `);
  await assert.rejects(
    () => assignTask(spaceId, assignmentTask.id, agent.id, { type: "human", id: human.id }),
    /p-a9 task assignment failure/,
  );
  const rolledBackAssignment = await db.select().from(schema.messages).where(eq(
    schema.messages.id,
    assignmentTask.id,
  )).get();
  assert.deepEqual({
    assigneeType: rolledBackAssignment?.taskAssigneeType,
    assigneeId: rolledBackAssignment?.taskAssigneeId,
    status: rolledBackAssignment?.taskStatus,
    revision: rolledBackAssignment?.taskRevision,
  }, {
    assigneeType: null,
    assigneeId: null,
    status: "todo",
    revision: 1,
  }, "assignment and its audit message commit atomically");
  assert.deepEqual(
    realtime.events().map((event) => event.type),
    [],
    "a rolled-back assignment emits no realtime event",
  );
  sqlite.exec("DROP TRIGGER p_a9_fail_task_assignment_audit;");

  await addChannelMembers(spaceId, channel.id, [{ type: "agent", id: agent.id }]);
  const offlineDelivery = await createMessage({
    spaceId,
    channelId: channel.id,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "offline reservation is released",
  });
  assert.equal((await db.select().from(schema.dispatchWakes).where(eq(
    schema.dispatchWakes.messageId,
    offlineDelivery.id,
  ))).length, 0);
  assert.equal((await db.select().from(schema.dispatchChains).where(eq(
    schema.dispatchChains.id,
    offlineDelivery.dispatchChainId,
  )).get())?.wakeCount, 0);

  const [pendingAttachment] = await db.insert(schema.attachments).values({
    spaceId,
    uploaderType: "human",
    uploaderId: human.id,
    filename: "pending.txt",
    mimeType: "text/plain",
    sizeBytes: 7,
    storageKey: "p-a9-pending.txt",
  }).returning();
  assert.ok(pendingAttachment);
  const attachmentMessage = await createMessage({
    spaceId,
    channelId: channel.id,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "bind attachment",
    attachmentIds: [pendingAttachment.id],
  });
  const boundAttachment = await db.select().from(schema.attachments).where(eq(
    schema.attachments.id,
    pendingAttachment.id,
  )).get();
  assert.deepEqual({ messageId: boundAttachment?.messageId, channelId: boundAttachment?.channelId }, {
    messageId: attachmentMessage.id,
    channelId: channel.id,
  });

  const parent = await createMessage({
    spaceId,
    channelId: channel.id,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "thread parent",
  });
  const thread = await getOrCreateThread(spaceId, parent.id, { type: "agent", id: agent.id });
  await createMessage({
    spaceId,
    channelId: thread.id,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "human follows by replying",
  });
  const humanThreadState = await db.select().from(schema.humanChannelStates).where(eq(
    schema.humanChannelStates.channelId,
    thread.id,
  )).get();
  assert.ok(humanThreadState?.threadFollowedAt);

  const [reminder] = await db.insert(schema.reminders).values({
    spaceId,
    ownerType: "agent",
    ownerId: agent.id,
    content: "review the frozen behavior",
    remindAt: new Date(Date.now() - 1_000),
    channelId: all.id,
    anchorMessageId: parent.id,
  }).returning();
  assert.ok(reminder);
  realtime.clear();
  await fireReminder(reminder);
  const firedReminder = await db.select().from(schema.reminders).where(eq(
    schema.reminders.id,
    reminder.id,
  )).get();
  assert.equal(firedReminder?.status, "fired");
  const reminderMessage = await db.select().from(schema.messages).where(and(
    eq(schema.messages.senderName, "reminder"),
    eq(schema.messages.content, "⏰ @offline-agent reminder: review the frozen behavior"),
  )).get();
  assert.deepEqual({
    channelId: reminderMessage?.channelId,
    senderType: reminderMessage?.senderType,
    messageType: reminderMessage?.messageType,
  }, {
    channelId: channel.id,
    senderType: "system",
    messageType: "chat",
  }, "a due reminder uses its anchor channel and posts the current visible system message");
  assert.equal(realtime.events()[0]?.type, "message");
} finally {
  realtime.disconnect();
  try {
    sqlite.exec("DROP TRIGGER IF EXISTS p_a9_fail_dispatch_chain; DROP TRIGGER IF EXISTS p_a9_fail_task_audit; DROP TRIGGER IF EXISTS p_a9_fail_task_assignment_audit;");
  } catch { /* database may already be closed */ }
  closeAllDatabases();
}
