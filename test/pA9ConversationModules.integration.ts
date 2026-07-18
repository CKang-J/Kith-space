import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeAllDatabases } from "../src/db/index.ts";
import {
  createConversationModules,
  type ConversationEventSink,
  type WakeDispatchPort,
} from "../src/messages/messagePostingModule.ts";
import { integrationDatabase } from "./helpers/workspace.ts";

const { db, schema, spaceId, human } = integrationDatabase("p-a9-conversation-modules");

try {
  const [channel] = await db.insert(schema.channels).values({
    spaceId,
    name: "module-contract",
    type: "channel",
  }).returning();
  assert.ok(channel);

  const events: unknown[] = [];
  const eventSink: ConversationEventSink = {
    async publish(_spaceId, event) { events.push(event); },
  };
  const wakeDispatch: WakeDispatchPort = {
    async resolveMessageContext(input) {
      return {
        chainId: `chain-${input.messageId}`,
        dispatchDepth: 0,
        taskMessageId: input.taskMessageId,
      };
    },
    async ensureChain() {},
    async prepareTargets() { return { async dispatch() { return { status: "sent" }; } }; },
    async dispatch() { return { status: "sent" }; },
  };
  const modules = createConversationModules({
    eventSink,
    wakeDispatch,
    introductionProof: {
      consume: () => true,
      complete() {},
      restore() {},
    },
  });

  const message = await modules.messagePosting.post({
    kind: "chat",
    context: {
      spaceId,
      channelId: channel.id,
      sender: { type: "human", id: human.id, name: human.name },
    },
    content: "module message",
  });
  assert.equal(message.content, "module message");
  assert.equal((await db.select().from(schema.messages).where(eq(schema.messages.id, message.id)).get())?.id, message.id);

  const task = await modules.tasks.create({
    context: {
      spaceId,
      channelId: channel.id,
      sender: { type: "human", id: human.id, name: human.name },
    },
    title: "module task",
    executionMode: "autopilot",
  });
  assert.equal(task.taskStatus, "todo");
  assert.ok(task.threadId);
  assert.equal(
    (await db.select().from(schema.messages).where(eq(schema.messages.content, "module task")).get())?.id,
    task.id,
  );
  assert.equal(
    (await db.select().from(schema.messages).where(eq(
      schema.messages.content,
      `${human.name} created task #${task.taskNumber} "module task"`,
    )).get())?.messageType,
    "system",
  );
  assert.equal(events.some((event) => (event as { type?: unknown }).type === "message"), true);
  assert.equal(events.some((event) => (event as { type?: unknown }).type === "task"), true);
} finally {
  closeAllDatabases();
}
