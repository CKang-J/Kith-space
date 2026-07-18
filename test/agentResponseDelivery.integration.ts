import "../src/env.ts";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { integrationDatabase } from "./helpers/workspace.ts";
import { addChannelMembers, createMessage, getOrCreateThread } from "../src/server/core.ts";
import { admittedWakeDeliveries, connectAdmittingWorker } from "./helpers/admittingWorker.ts";
import { CHANNEL_ALL_MENTION_TYPE } from "../src/channels/channelAllMention.ts";

const { db, schema, spaceId, human } = integrationDatabase("agent-response-delivery");
const [channel] = await db.insert(schema.channels).values({ spaceId, name: "response-delivery", type: "channel" }).returning();
const [active, passive, silent] = await db.insert(schema.agents).values([
  { spaceId, name: "active", displayName: "Active", defaultResponseMode: "active" },
  { spaceId, name: "passive", displayName: "Passive", defaultResponseMode: "mention_only" },
  { spaceId, name: "silent", displayName: "Silent", defaultResponseMode: "silent" },
]).returning();
assert.ok(channel && active && passive && silent);
await addChannelMembers(spaceId, channel.id, [active, passive, silent].map((agent) => ({ type: "agent", id: agent.id })));

const worker = connectAdmittingWorker({ runtimes: ["claude"] });
const deliveries = () => admittedWakeDeliveries(worker.messages);
const reset = () => worker.clear();

try {
  await createMessage({
    spaceId,
    channelId: channel.id,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "ordinary channel update",
  });
  assert.deepEqual(deliveries().map((message) => [message.agentId, message.responseDirective, message.responseReason]), [
    [active.id, "optional", "human_ambient_message"],
  ]);

  reset();
  await createMessage({
    spaceId,
    channelId: channel.id,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "@passive please inspect; @silent keep this as context",
  });
  assert.deepEqual(deliveries().map((message) => [message.agentId, message.responseDirective, message.responseReason]).sort(), [
    [active.id, "optional", "human_ambient_message"],
    [passive.id, "required", "explicit_mention"],
  ].sort());

  reset();
  const broadcast = await createMessage({
    spaceId,
    channelId: channel.id,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "@all please review",
  });
  assert.deepEqual(deliveries().map((message) => [message.agentId, message.responseDirective, message.responseReason]).sort(), [
    [active.id, "required", "explicit_mention"],
    [passive.id, "required", "explicit_mention"],
  ].sort());
  const broadcastMentions = await db.select().from(schema.messageMentions).where(eq(schema.messageMentions.messageId, broadcast.id));
  assert.deepEqual(broadcastMentions.filter((mention) => mention.mentionType === "agent").map((mention) => mention.mentionId).sort(), [
    active.id,
    passive.id,
    silent.id,
  ].sort(), "recipient rows snapshot every Agent who belonged to the channel at send time");
  assert.ok(broadcastMentions.some((mention) => mention.mentionType === CHANNEL_ALL_MENTION_TYPE && mention.mentionId === channel.id));

  reset();
  await createMessage({
    spaceId,
    channelId: channel.id,
    senderType: "agent",
    senderId: active.id,
    senderName: active.name,
    content: "@all ambient agent progress",
  });
  assert.equal(deliveries().length, 0, "Agent ambient chatter must not create response loops");

  const root = await createMessage({
    spaceId,
    channelId: channel.id,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "thread root",
  });
  const thread = await getOrCreateThread(spaceId, root.id, { type: "human", id: human.id });
  reset();
  await createMessage({
    spaceId,
    channelId: thread.id,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "@all join this topic",
  });
  assert.deepEqual(deliveries().map((message) => [message.agentId, message.responseDirective, message.responseReason]).sort(), [
    [active.id, "required", "explicit_mention"],
    [passive.id, "required", "explicit_mention"],
  ].sort());
  const broadcastThreadMembers = await db.select().from(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.channelId, thread.id));
  assert.deepEqual(broadcastThreadMembers.map((member) => member.agentId).sort(), [active.id, passive.id, silent.id].sort());
  reset();
  await createMessage({
    spaceId,
    channelId: thread.id,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "Human follow-up in a joined thread",
  });
  assert.deepEqual(deliveries().map((message) => [message.agentId, message.responseDirective, message.responseReason]).sort(), [
    [active.id, "optional", "participating_thread_follow_up"],
    [passive.id, "optional", "participating_thread_follow_up"],
  ].sort());

  const [dm] = await db.insert(schema.channels).values({ spaceId, name: `dm:${silent.id}`, type: "dm" }).returning();
  assert.ok(dm);
  await addChannelMembers(spaceId, dm.id, [{ type: "agent", id: silent.id }]);
  await db.insert(schema.humanChannelStates).values({ channelId: dm.id, dmAgentId: silent.id });
  reset();
  await createMessage({
    spaceId,
    channelId: dm.id,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "@all direct request",
  });
  assert.deepEqual(deliveries().map((message) => [message.agentId, message.responseDirective, message.responseReason]), [
    [silent.id, "required", "direct_message"],
  ]);
  const dmBroadcastMarkers = await db.select().from(schema.messageMentions).where(eq(schema.messageMentions.mentionType, CHANNEL_ALL_MENTION_TYPE));
  assert.equal(dmBroadcastMarkers.some((mention) => mention.mentionId === dm.id), false, "DM text must not create a channel-all mention");

  reset();
  const assigned = await createMessage({
    spaceId,
    channelId: channel.id,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "@silent own this task",
    asTask: true,
  });
  assert.equal(assigned.taskAssigneeId, silent.id);
  assert.equal(assigned.taskStatus, "in_progress");
  assert.deepEqual(deliveries().map((message) => [message.agentId, message.responseDirective, message.responseReason]), [
    [silent.id, "required", "explicit_task_assignment"],
  ]);

  reset();
  const unassigned = await createMessage({
    spaceId,
    channelId: channel.id,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "unassigned task",
    asTask: true,
  });
  assert.equal(unassigned.taskAssigneeId, null);
  assert.deepEqual(deliveries().map((message) => [message.agentId, message.responseDirective, message.responseReason]), [
    [active.id, "optional", "human_unassigned_task"],
  ]);

  const assignedThreadMembers = await db.select().from(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.channelId, assigned.threadId!));
  assert.ok(assignedThreadMembers.some((member) => member.agentId === silent.id));
} finally {
  worker.disconnect();
}
