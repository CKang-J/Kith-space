import "../src/env.ts";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { integrationDatabase } from "./helpers/workspace.ts";
import { setAgentDefaultResponseMode } from "../src/agents/agentResponseSettings.ts";
import { computeBacklog } from "../src/server/reconnectCatchup.ts";

const { db, schema, spaceId, human } = integrationDatabase("agent-response-reconnect");
const [channel] = await db.insert(schema.channels).values({ spaceId, name: "reconnect", type: "channel" }).returning();
const [responder, watermarkAgent, taskAgent] = await db.insert(schema.agents).values([
  { spaceId, name: "reconnect-responder", displayName: "Reconnect Responder", defaultResponseMode: "active" },
  { spaceId, name: "watermark", displayName: "Watermark", defaultResponseMode: "silent" },
  { spaceId, name: "task-only", displayName: "Task only", defaultResponseMode: "silent" },
]).returning();
assert.ok(channel && responder && watermarkAgent && taskAgent);
await db.insert(schema.channelAgentMembers).values([
  { channelId: channel.id, agentId: responder.id },
  { channelId: channel.id, agentId: watermarkAgent.id },
]);

const [ambient] = await db.insert(schema.messages).values({
  spaceId,
  channelId: channel.id,
  seq: 1,
  senderType: "human",
  senderId: human.id,
  senderName: human.name,
  content: "offline ambient",
}).returning();
assert.ok(ambient);
let backlog = await computeBacklog(spaceId, responder.id, null);
assert.equal(backlog?.responseDirective, "optional");
assert.equal(backlog?.responseReason, "human_ambient_message");

await setAgentDefaultResponseMode(spaceId, responder.id, "mention_only");
assert.equal(await computeBacklog(spaceId, responder.id, null), null, "disabled ambient backlog must not wake on reconnect");

const [mention] = await db.insert(schema.messages).values({
  spaceId,
  channelId: channel.id,
  seq: 2,
  senderType: "human",
  senderId: human.id,
  senderName: human.name,
  content: "@reconnect-responder required",
}).returning();
assert.ok(mention);
await db.insert(schema.messageMentions).values({
  messageId: mention.id,
  mentionType: "agent",
  mentionId: responder.id,
  mentionName: responder.name,
});
backlog = await computeBacklog(spaceId, responder.id, null);
assert.equal(backlog?.count, 1);
assert.equal(backlog?.responseDirective, "required");
assert.equal(backlog?.responseReason, "explicit_mention");

await setAgentDefaultResponseMode(spaceId, responder.id, "silent");
assert.equal(await computeBacklog(spaceId, responder.id, null), null);

const [dm] = await db.insert(schema.channels).values({ spaceId, name: `dm:${responder.id}`, type: "dm" }).returning();
assert.ok(dm);
await db.insert(schema.channelAgentMembers).values({ channelId: dm.id, agentId: responder.id });
await db.insert(schema.messages).values({
  spaceId,
  channelId: dm.id,
  seq: 3,
  senderType: "human",
  senderId: human.id,
  senderName: human.name,
  content: "offline direct request",
});
backlog = await computeBacklog(spaceId, responder.id, null);
assert.equal(backlog?.responseDirective, "required");
assert.equal(backlog?.responseReason, "direct_message");

await db.insert(schema.messages).values({
  spaceId,
  channelId: channel.id,
  seq: 4,
  senderType: "human",
  senderId: human.id,
  senderName: human.name,
  content: "before active was enabled",
});
await setAgentDefaultResponseMode(spaceId, watermarkAgent.id, "active");
assert.equal(await computeBacklog(spaceId, watermarkAgent.id, null), null, "mode enablement must not retroactively wake seq 4");
await db.insert(schema.messages).values({
  spaceId,
  channelId: channel.id,
  seq: 5,
  senderType: "human",
  senderId: human.id,
  senderName: human.name,
  content: "after active was enabled",
});
backlog = await computeBacklog(spaceId, watermarkAgent.id, null);
assert.equal(backlog?.responseDirective, "optional");
assert.equal(backlog?.messageId.length, 36);

const [task] = await db.insert(schema.messages).values({
  spaceId,
  channelId: channel.id,
  seq: 6,
  senderType: "human",
  senderId: human.id,
  senderName: human.name,
  content: "task for a thread-only Agent",
  taskStatus: "in_progress",
  taskNumber: 1,
  taskAssigneeType: "agent",
  taskAssigneeId: taskAgent.id,
  taskClaimedAt: new Date(),
  taskRevision: 1,
}).returning();
assert.ok(task);
const [thread] = await db.insert(schema.channels).values({
  spaceId,
  name: `thread-${task.id.slice(0, 8)}`,
  type: "thread",
  parentMessageId: task.id,
}).returning();
assert.ok(thread);
await db.update(schema.messages).set({ threadId: thread.id }).where(eq(schema.messages.id, task.id));
await db.insert(schema.channelAgentMembers).values({
  channelId: thread.id,
  agentId: taskAgent.id,
  lastReadSeq: 6,
  ambientWakeAfterSeq: 6,
  mentionWakeAfterSeq: 6,
});
await db.insert(schema.messages).values({
  spaceId,
  channelId: thread.id,
  seq: 7,
  senderType: "system",
  senderId: human.id,
  senderName: "system",
  messageType: "system",
  content: "task assigned",
});
backlog = await computeBacklog(spaceId, taskAgent.id, null);
assert.equal(backlog?.count, 1);
assert.equal(backlog?.responseDirective, "required");
assert.equal(backlog?.responseReason, "explicit_task_assignment");

const member = db.select().from(schema.channelAgentMembers).where(and(
  eq(schema.channelAgentMembers.channelId, channel.id),
  eq(schema.channelAgentMembers.agentId, watermarkAgent.id),
)).get();
assert.equal(member?.ambientWakeAfterSeq, 4);
