import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { closeAllDatabases, schema } from "../src/db/index.ts";
import { handleApi } from "../src/server/routes-api/index.ts";
import { readObject, saveObject } from "../src/server/storage.ts";
import { integrationDatabase } from "./helpers/workspace.ts";

type ResponseCapture = { status: number; body: any };

function request(spaceId: string, method: string, pathname: string, body?: unknown): IncomingMessage {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const stream = Readable.from(raw ? [Buffer.from(raw)] : []);
  return Object.assign(stream, {
    method,
    url: pathname,
    headers: {
      "x-kith-desktop-token": process.env.KITH_SPACE_DESKTOP_TOKEN!,
      "content-type": "application/json",
      "x-space-id": spaceId,
    },
    socket: { remoteAddress: "127.0.0.1" },
  }) as unknown as IncomingMessage;
}

function response(): { res: ServerResponse; capture: () => ResponseCapture } {
  let status = 0;
  let raw = "";
  const emitter = new EventEmitter();
  const res = Object.assign(emitter, {
    statusCode: 0,
    headersSent: false,
    setHeader() {},
    writeHead(code: number) { status = code; this.statusCode = code; },
    end(payload?: string | Buffer) { raw = payload ? String(payload) : ""; emitter.emit("finish"); },
  }) as unknown as ServerResponse;
  return { res, capture: () => ({ status, body: raw ? JSON.parse(raw) : undefined }) };
}

async function api(spaceId: string, method: string, pathname: string, body?: unknown): Promise<ResponseCapture> {
  const output = response();
  await handleApi(request(spaceId, method, pathname, body), output.res, new URL(`http://localhost${pathname}`), method);
  return output.capture();
}

const { db, spaceId, human } = integrationDatabase("agent-deletion");

try {
  const [agent] = await db.insert(schema.agents).values({
    spaceId,
    name: "retired-agent",
    displayName: "Retired Agent",
    creatorId: human.id,
  }).returning();
  assert.ok(agent);
  const [peerAgent] = await db.insert(schema.agents).values({
    spaceId,
    name: "peer-agent",
    displayName: "Peer Agent",
    creatorId: human.id,
  }).returning();
  assert.ok(peerAgent);

  const [publicChannel, dm, agentDm] = await db.insert(schema.channels).values([
    { spaceId, name: "history", type: "channel" },
    { spaceId, name: `dm:${agent.id}`, type: "dm" },
    { spaceId, name: `dm:${agent.id}:${peerAgent.id}`, type: "dm" },
  ]).returning();
  assert.ok(publicChannel && dm && agentDm);
  await db.insert(schema.humanChannelStates).values({ channelId: dm.id, dmAgentId: agent.id });
  await db.insert(schema.channelAgentMembers).values([
    { channelId: dm.id, agentId: agent.id },
    { channelId: agentDm.id, agentId: agent.id },
    { channelId: agentDm.id, agentId: peerAgent.id },
  ]);

  const [publicMessage, dmMessage] = await db.insert(schema.messages).values([
    {
      spaceId,
      channelId: publicChannel.id,
      seq: 1,
      senderType: "agent",
      senderId: agent.id,
      senderName: agent.displayName,
      content: "public history remains searchable",
    },
    {
      spaceId,
      channelId: dm.id,
      seq: 2,
      senderType: "agent",
      senderId: agent.id,
      senderName: agent.displayName,
      content: "private history is removed",
    },
  ]).returning();
  assert.ok(publicMessage && dmMessage);
  const [publicThread] = await db.insert(schema.channels).values({
    spaceId,
    name: `thread:${publicMessage.id}`,
    type: "thread",
    parentMessageId: publicMessage.id,
  }).returning();
  assert.ok(publicThread);
  await db.insert(schema.messages).values({
    spaceId,
    channelId: publicThread.id,
    seq: 3,
    senderType: "agent",
    senderId: agent.id,
    senderName: agent.displayName,
    content: "public topic history remains searchable",
  });
  await db.insert(schema.attachments).values({
    spaceId,
    channelId: dm.id,
    messageId: dmMessage.id,
    uploaderType: "agent",
    uploaderId: agent.id,
    filename: "private.md",
    storageKey: "private.md",
  });
  const [agentDmMessage] = await db.insert(schema.messages).values({
    spaceId,
    channelId: agentDm.id,
    seq: 4,
    senderType: "agent",
    senderId: peerAgent.id,
    senderName: peerAgent.displayName,
    content: "agent private history is removed",
  }).returning();
  assert.ok(agentDmMessage);
  const privateObject = await saveObject(spaceId, "private-agent.md", Readable.from(["secret"]));
  await db.insert(schema.attachments).values({
    spaceId,
    channelId: null,
    messageId: agentDmMessage.id,
    uploaderType: "agent",
    uploaderId: peerAgent.id,
    filename: "private-agent.md",
    storageKey: privateObject.key,
  });

  const deleted = await api(spaceId, "DELETE", `/api/agents/${agent.id}`);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.ok, true);

  const persistedAgent = (await db.select().from(schema.agents).where(eq(schema.agents.id, agent.id)))[0];
  assert.ok(persistedAgent?.deletedAt, "agent identity is soft-deleted for public-history attribution");
  assert.equal((await db.select().from(schema.channels).where(eq(schema.channels.id, dm.id))).length, 0);
  assert.equal((await db.select().from(schema.channels).where(eq(schema.channels.id, agentDm.id))).length, 0);
  assert.equal((await db.select().from(schema.messages).where(eq(schema.messages.channelId, dm.id))).length, 0);
  assert.equal((await db.select().from(schema.attachments).where(eq(schema.attachments.channelId, dm.id))).length, 0);
  assert.equal((await db.select().from(schema.attachments).where(eq(schema.attachments.messageId, agentDmMessage.id))).length, 0);
  await assert.rejects(() => readObject(spaceId, privateObject.key));
  assert.equal((await db.select().from(schema.messages).where(eq(schema.messages.id, publicMessage.id))).length, 1);
  assert.equal((await db.select().from(schema.channels).where(eq(schema.channels.id, publicThread.id))).length, 1);

  const dms = await api(spaceId, "GET", "/api/channels/dm");
  assert.equal(dms.status, 200);
  assert.deepEqual(dms.body, []);

  const history = await api(spaceId, "GET", `/api/messages/channel/${publicChannel.id}`);
  assert.equal(history.status, 200);
  assert.equal(history.body.messages[0].senderDeleted, true);

  const topics = await api(spaceId, "GET", `/api/channels/${publicChannel.id}/threads?parentMessageIds=${publicMessage.id}`);
  assert.equal(topics.status, 200);
  assert.equal(topics.body[publicMessage.id].previews[0].senderDeleted, true);

  const search = await api(spaceId, "GET", "/api/messages/search?q=public%20history");
  assert.equal(search.status, 200);
  assert.equal(search.body.results[0].senderDeleted, true);
  assert.equal(search.body.results.some((result: any) => result.content.includes("private history")), false);
  const topicSearch = await api(spaceId, "GET", "/api/messages/search?q=public%20topic");
  assert.equal(topicSearch.body.results[0].channelType, "thread");
  assert.equal(topicSearch.body.results[0].parentChannelId, publicChannel.id);
  assert.equal(topicSearch.body.results[0].senderDeleted, true);

  const activeAgents = await api(spaceId, "GET", "/api/agents");
  assert.equal(activeAgents.status, 200);
  assert.equal(activeAgents.body.some((candidate: any) => candidate.id === agent.id), false);

  assert.equal((await db.select().from(schema.humanChannelStates).where(and(
    eq(schema.humanChannelStates.dmAgentId, agent.id),
    eq(schema.humanChannelStates.channelId, dm.id),
  ))).length, 0);
} finally {
  closeAllDatabases();
}
