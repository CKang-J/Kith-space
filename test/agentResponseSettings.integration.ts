import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import {
  listChannelAgentResponseModes,
  resolveAgentResponseMode,
  setAgentDefaultResponseMode,
  setChannelAgentResponseModeOverride,
} from "../src/agents/agentResponseSettings.ts";
import { closeAllDatabases, schema } from "../src/db/index.ts";
import { integrationDatabase } from "./helpers/workspace.ts";

const { db, spaceId, human } = integrationDatabase("agent-response-settings");

try {
  const [agent] = await db.insert(schema.agents).values({
    spaceId,
    name: "responder",
    displayName: "Responder",
    creatorId: human.id,
  }).returning();
  assert.ok(agent);

  const [channel, explicitChannel] = await db.insert(schema.channels).values([
    { spaceId, name: "response-policy", type: "channel" },
    { spaceId, name: "response-explicit", type: "private" },
  ]).returning();
  assert.ok(channel && explicitChannel);

  const [parent] = await db.insert(schema.messages).values({
    spaceId,
    channelId: channel.id,
    seq: 10,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "root",
  }).returning();
  assert.ok(parent);
  const [thread] = await db.insert(schema.channels).values({
    spaceId,
    name: `thread:${parent.id}`,
    type: "thread",
    parentMessageId: parent.id,
  }).returning();
  assert.ok(thread);

  await db.insert(schema.channelAgentMembers).values([
    { channelId: channel.id, agentId: agent.id },
    { channelId: thread.id, agentId: agent.id },
    { channelId: explicitChannel.id, agentId: agent.id, responseModeOverride: "active" },
  ]);
  await db.insert(schema.messages).values([
    {
      spaceId,
      channelId: thread.id,
      seq: 11,
      senderType: "human",
      senderId: human.id,
      senderName: human.name,
      content: "thread reply",
    },
    {
      spaceId,
      channelId: explicitChannel.id,
      seq: 12,
      senderType: "human",
      senderId: human.id,
      senderName: human.name,
      content: "explicit channel",
    },
  ]);

  assert.deepEqual(await resolveAgentResponseMode(spaceId, channel.id, agent.id), {
    agentId: agent.id,
    channelId: channel.id,
    defaultResponseMode: "active",
    responseModeOverride: null,
    effectiveResponseMode: "active",
    responseModeSource: "agent_default",
    ambientWakeAfterSeq: 0,
    mentionWakeAfterSeq: 0,
  });

  const defaultToPassive = await setAgentDefaultResponseMode(spaceId, agent.id, "mention_only");
  assert.equal(defaultToPassive.changed, true);
  assert.equal(defaultToPassive.defaultResponseMode, "mention_only");

  const explicitBefore = await resolveAgentResponseMode(spaceId, explicitChannel.id, agent.id);
  assert.equal(explicitBefore?.effectiveResponseMode, "active");
  assert.equal(explicitBefore?.responseModeSource, "channel_override");

  await setChannelAgentResponseModeOverride(spaceId, channel.id, agent.id, "silent");
  const reset = await setChannelAgentResponseModeOverride(spaceId, channel.id, agent.id, null);
  assert.equal(reset.changed, true);
  assert.equal(reset.setting.effectiveResponseMode, "mention_only");
  assert.equal(reset.setting.mentionWakeAfterSeq, 12);

  const inheritedThread = await resolveAgentResponseMode(spaceId, thread.id, agent.id);
  assert.equal(inheritedThread?.effectiveResponseMode, "mention_only");
  assert.equal(inheritedThread?.responseModeSource, "agent_default");
  assert.equal(inheritedThread?.mentionWakeAfterSeq, 12);

  await db.insert(schema.messages).values({
    spaceId,
    channelId: channel.id,
    seq: 13,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "after reset",
  });
  const defaultToActive = await setAgentDefaultResponseMode(spaceId, agent.id, "active");
  assert.equal(defaultToActive.changed, true);

  const inheritedActive = await resolveAgentResponseMode(spaceId, channel.id, agent.id);
  assert.equal(inheritedActive?.ambientWakeAfterSeq, 13);
  assert.equal(inheritedActive?.mentionWakeAfterSeq, 12);

  await db.insert(schema.messages).values({
    spaceId,
    channelId: channel.id,
    seq: 14,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "idempotency guard",
  });
  const idempotent = await setAgentDefaultResponseMode(spaceId, agent.id, "active");
  assert.equal(idempotent.changed, false);
  assert.equal((await resolveAgentResponseMode(spaceId, channel.id, agent.id))?.ambientWakeAfterSeq, 13);

  const explicitEqualDefault = await setChannelAgentResponseModeOverride(spaceId, channel.id, agent.id, "active");
  assert.equal(explicitEqualDefault.setting.responseModeOverride, "active");
  assert.equal(explicitEqualDefault.setting.responseModeSource, "channel_override");
  assert.equal(explicitEqualDefault.setting.ambientWakeAfterSeq, 13);

  const threadWithParentOverride = await resolveAgentResponseMode(spaceId, thread.id, agent.id);
  assert.equal(threadWithParentOverride?.responseModeOverride, "active");
  assert.equal(threadWithParentOverride?.responseModeSource, "channel_override");

  const [threadOnlyAgent] = await db.insert(schema.agents).values({
    spaceId,
    name: "thread-only-responder",
    displayName: "Thread-only responder",
    creatorId: human.id,
    defaultResponseMode: "silent",
  }).returning();
  assert.ok(threadOnlyAgent);
  await db.insert(schema.channelAgentMembers).values({ channelId: thread.id, agentId: threadOnlyAgent.id });
  const threadOnlyMode = await resolveAgentResponseMode(spaceId, thread.id, threadOnlyAgent.id);
  assert.equal(threadOnlyMode?.effectiveResponseMode, "silent");
  assert.equal(threadOnlyMode?.responseModeSource, "agent_default");
  assert.ok((await listChannelAgentResponseModes(spaceId, thread.id)).some((setting) => setting.agentId === threadOnlyAgent.id));

  const listed = await listChannelAgentResponseModes(spaceId, channel.id);
  assert.deepEqual(listed, [explicitEqualDefault.setting]);

  const stored = db.select().from(schema.channelAgentMembers).where(and(
    eq(schema.channelAgentMembers.channelId, channel.id),
    eq(schema.channelAgentMembers.agentId, agent.id),
  )).get();
  assert.equal(stored?.lastReadSeq, 0, "response mode changes must not mutate the read cursor");
} finally {
  closeAllDatabases();
}
