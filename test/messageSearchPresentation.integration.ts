import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { closeAllDatabases, schema } from "../src/db/index.ts";
import { handleApi } from "../src/server/routes-api/index.ts";
import { integrationDatabase } from "./helpers/workspace.ts";

function request(spaceId: string, pathname: string): IncomingMessage {
  return Object.assign(Readable.from([]), {
    method: "GET",
    url: pathname,
    headers: {
      "x-kith-desktop-token": process.env.KITH_SPACE_DESKTOP_TOKEN!,
      "x-space-id": spaceId,
    },
    socket: { remoteAddress: "127.0.0.1" },
  }) as unknown as IncomingMessage;
}

async function get(spaceId: string, pathname: string) {
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
  await handleApi(request(spaceId, pathname), res, new URL(`http://localhost${pathname}`), "GET");
  return { status, body: raw ? JSON.parse(raw) : undefined };
}

const { db, spaceId, human } = integrationDatabase("message-search-presentation");

try {
  const [agent] = await db.insert(schema.agents).values({
    spaceId,
    name: "search-agent",
    displayName: "搜索助手",
    creatorId: human.id,
  }).returning();
  const [channel, dm] = await db.insert(schema.channels).values([
    { spaceId, name: "讨论", type: "channel" },
    { spaceId, name: `dm:${agent!.id}`, type: "dm" },
  ]).returning();
  await db.insert(schema.humanChannelStates).values({ channelId: dm!.id, dmAgentId: agent!.id });

  const [channelMessage, dmMessage, topicParent, literalPatternMessage] = await db.insert(schema.messages).values([
    { spaceId, channelId: channel!.id, seq: 1, senderType: "human", senderId: human.id, senderName: human.name, content: "频道里的检索词" },
    { spaceId, channelId: dm!.id, seq: 1, senderType: "agent", senderId: agent!.id, senderName: agent!.displayName, content: "私信里的检索词" },
    { spaceId, channelId: channel!.id, seq: 2, senderType: "human", senderId: human.id, senderName: human.name, content: "根据这个文件写一份 HTML 版" },
    { spaceId, channelId: channel!.id, seq: 3, senderType: "human", senderId: human.id, senderName: human.name, content: "进度达到 100%" },
  ]).returning();
  const [thread] = await db.insert(schema.channels).values({
    spaceId,
    name: `thread:${topicParent!.id}`,
    type: "thread",
    parentMessageId: topicParent!.id,
  }).returning();
  const [topicReply] = await db.insert(schema.messages).values({
    spaceId,
    channelId: thread!.id,
    seq: 1,
    senderType: "agent",
    senderId: agent!.id,
    senderName: agent!.displayName,
    content: "话题回复里的检索词",
  }).returning();

  const response = await get(spaceId, "/api/messages/search?q=%E6%A3%80%E7%B4%A2%E8%AF%8D");
  assert.equal(response.status, 200);
  const byId = new Map(response.body.results.map((result: any) => [result.id, result]));

  assert.equal(byId.get(channelMessage!.id).conversationName, "讨论");
  assert.equal(byId.get(dmMessage!.id).conversationName, "搜索助手");
  assert.equal(byId.get(dmMessage!.id).channelName, "搜索助手");
  assert.doesNotMatch(byId.get(dmMessage!.id).conversationName, /^dm:/);

  const topic = byId.get(topicReply!.id);
  assert.equal(topic.channelName, "讨论");
  assert.equal(topic.parentChannelName, "讨论");
  assert.equal(topic.parentPreview, "根据这个文件写一份 HTML 版");
  assert.equal(topic.conversationName, "根据这个文件写一份 HTML 版");
  assert.equal(topic.replyCount, 1);

  const literalPatternResponse = await get(spaceId, "/api/messages/search?q=%25");
  assert.equal(literalPatternResponse.status, 200);
  assert.deepEqual(literalPatternResponse.body.results.map((result: any) => result.id), [literalPatternMessage!.id]);
} finally {
  closeAllDatabases();
}
