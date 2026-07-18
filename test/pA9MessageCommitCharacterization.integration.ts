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
    content: "message survives later chain failure",
  }), /p-a9 dispatch chain failure/);
  const partialMessage = await db.select().from(schema.messages).where(eq(
    schema.messages.content,
    "message survives later chain failure",
  )).get();
  assert.ok(partialMessage, "current message insert commits before dispatch-chain persistence");
  assert.deepEqual(realtime.events().map((event) => event.type), [], "failure before publish returns after commit with no realtime event");
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
    content: "task survives audit failure",
    asTask: true,
  }), /p-a9 task audit failure/);
  const partialTask = await db.select().from(schema.messages).where(and(
    eq(schema.messages.content, "task survives audit failure"),
    isNotNull(schema.messages.taskStatus),
  )).get();
  assert.ok(partialTask?.threadId, "current task and owning thread commit before the system audit message");
  assert.ok(await db.select().from(schema.channels).where(eq(schema.channels.id, partialTask.threadId)).get());
  assert.deepEqual(
    realtime.events().map((event) => event.type),
    ["message", "task"],
    "task creation publishes message then task before the later audit failure is returned",
  );
  sqlite.exec("DROP TRIGGER p_a9_fail_task_audit;");

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
    () => assignTask(spaceId, partialTask.id, agent.id, { type: "human", id: human.id }),
    /p-a9 task assignment failure/,
  );
  const assignedBeforeFailure = await db.select().from(schema.messages).where(eq(
    schema.messages.id,
    partialTask.id,
  )).get();
  assert.deepEqual({
    assigneeType: assignedBeforeFailure?.taskAssigneeType,
    assigneeId: assignedBeforeFailure?.taskAssigneeId,
    status: assignedBeforeFailure?.taskStatus,
    revision: assignedBeforeFailure?.taskRevision,
  }, {
    assigneeType: "agent",
    assigneeId: agent.id,
    status: "in_progress",
    revision: 2,
  }, "assignment commits before its audit message fails");
  assert.deepEqual(
    realtime.events().map((event) => event.type),
    ["task"],
    "assignment publishes task updated before returning the later audit failure",
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
