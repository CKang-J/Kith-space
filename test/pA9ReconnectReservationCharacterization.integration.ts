import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import type { WebSocket } from "ws";
import { integrationDatabase } from "./helpers/workspace.ts";
import { closeAllDatabases } from "../src/db/index.ts";
import {
  registerWorker,
  resolveWorkerAdmission,
  unregisterWorker,
  updateWorkerSnapshot,
  type WorkerLease,
} from "../src/local-runtime/workerHub.ts";
import { catchUpAgentsOnWorker, computeBacklog } from "../src/server/reconnectCatchup.ts";

const { db, schema, spaceId, human } = integrationDatabase("p-a9-reconnect-reservation-characterization");
let currentLease: WorkerLease | null = null;

function connectWorker(messages: Record<string, unknown>[], autoAck = true): WorkerLease {
  let lease: WorkerLease;
  const socket = {
    readyState: 1,
    send(payload: string) {
      const message = JSON.parse(payload) as Record<string, unknown>;
      messages.push(message);
      if (autoAck && typeof message.generation === "number" && (typeof message.deliveryId === "string" || typeof message.commandId === "string")) {
        queueMicrotask(() => resolveWorkerAdmission(lease, {
          type: "worker:admission",
          generation: message.generation,
          ...(typeof message.deliveryId === "string" ? { deliveryId: message.deliveryId } : { commandId: message.commandId }),
          status: "admitted",
        }));
      }
    },
    close() { /* reconnect generations are controlled explicitly by the test */ },
  } as unknown as WebSocket;
  lease = registerWorker(socket);
  updateWorkerSnapshot(lease, { runtimes: ["fake"], runningAgents: [] });
  currentLease = lease;
  return lease;
}

async function waitForMessage(messages: Record<string, unknown>[]): Promise<void> {
  for (let attempt = 0; attempt < 100 && messages.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.ok(messages.length > 0, "Worker command was not sent");
}

try {
  const [channel] = await db.insert(schema.channels).values({
    spaceId,
    name: "reconnect-reservation",
    type: "channel",
  }).returning();
  const [agent] = await db.insert(schema.agents).values({
    spaceId,
    name: "reconnect-agent",
    displayName: "Reconnect Agent",
    runtime: "fake",
    defaultResponseMode: "mention_only",
  }).returning();
  assert.ok(channel && agent);
  await db.insert(schema.channelAgentMembers).values({
    channelId: channel.id,
    agentId: agent.id,
    lastReadSeq: 0,
    ambientWakeAfterSeq: 0,
    mentionWakeAfterSeq: 0,
  });
  const [message] = await db.insert(schema.messages).values({
    spaceId,
    channelId: channel.id,
    seq: 1,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "@reconnect-agent still unread",
  }).returning();
  assert.ok(message);
  await db.insert(schema.messageMentions).values({
    messageId: message.id,
    mentionType: "agent",
    mentionId: agent.id,
    mentionName: agent.name,
  });
  assert.equal((await computeBacklog(spaceId, agent.id, null))?.messageId, message.id);

  const firstMessages: Record<string, unknown>[] = [];
  const firstLease = connectWorker(firstMessages, false);
  const pendingCatchUp = catchUpAgentsOnWorker([], firstLease);
  await waitForMessage(firstMessages);
  assert.deepEqual(firstMessages.map(({ type, agentId }) => ({ type, agentId })), [{
    type: "agent:start",
    agentId: agent.id,
  }]);
  const [firstWake] = await db.select().from(schema.dispatchWakes).where(eq(
    schema.dispatchWakes.messageId,
    message.id,
  ));
  assert.equal(firstWake?.status, "reserved", "Core does not commit before a matching admission ack");
  assert.equal(unregisterWorker(firstLease), true);
  currentLease = null;
  await pendingCatchUp;

  const membershipBeforeRead = await db.select().from(schema.channelAgentMembers).where(and(
    eq(schema.channelAgentMembers.channelId, channel.id),
    eq(schema.channelAgentMembers.agentId, agent.id),
  )).get();
  assert.equal(membershipBeforeRead?.lastReadSeq, 0, "committing a reconnect wake does not advance the durable inbox cursor");

  const replayMessages: Record<string, unknown>[] = [];
  const replayLease = connectWorker(replayMessages);
  await catchUpAgentsOnWorker([], replayLease);
  assert.deepEqual(replayMessages.map(({ type, agentId }) => ({ type, agentId })), [{
    type: "agent:start",
    agentId: agent.id,
  }]);
  const wakes = await db.select().from(schema.dispatchWakes).where(eq(
    schema.dispatchWakes.messageId,
    message.id,
  ));
  assert.equal(wakes.length, 1);
  assert.equal(wakes[0]!.id, firstWake!.id, "unread reconnect replay reuses the durable reservation id");
  assert.deepEqual(wakes.map(({ chainId, targetAgentId, status }) => ({ chainId, targetAgentId, status })), [
    { chainId: message.id, targetAgentId: agent.id, status: "success" },
  ]);

  assert.equal(unregisterWorker(replayLease), true);
  currentLease = null;
  const admittedUnreadMessages: Record<string, unknown>[] = [];
  const admittedUnreadLease = connectWorker(admittedUnreadMessages);
  await catchUpAgentsOnWorker([], admittedUnreadLease);
  assert.equal(admittedUnreadMessages[0]?.deliveryId, firstWake!.id, "acknowledged but unread replay retains deliveryId");
  assert.equal((await db.select().from(schema.dispatchWakes).where(eq(schema.dispatchWakes.messageId, message.id))).length, 1);

  await db.update(schema.channelAgentMembers).set({ lastReadSeq: message.seq }).where(and(
    eq(schema.channelAgentMembers.channelId, channel.id),
    eq(schema.channelAgentMembers.agentId, agent.id),
  ));
  assert.equal(unregisterWorker(admittedUnreadLease), true);
  currentLease = null;
  const afterReadMessages: Record<string, unknown>[] = [];
  const afterReadLease = connectWorker(afterReadMessages);
  await catchUpAgentsOnWorker([], afterReadLease);
  assert.deepEqual(afterReadMessages, [], "advancing lastReadSeq closes the reconnect replay window");
  assert.equal((await db.select().from(schema.dispatchWakes).where(eq(
    schema.dispatchWakes.messageId,
    message.id,
  ))).length, 1);
} finally {
  if (currentLease) unregisterWorker(currentLease);
  closeAllDatabases();
}
