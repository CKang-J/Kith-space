// Read cursor contract for the one Human:
// - a channel badge aggregates its own unread messages and followed-thread unread
// - reading one container clears only that source
// - POST /read returns the authoritative remaining parent-channel unread count
import "../src/env.js";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { desc, eq } from "drizzle-orm";
import { createMessage, getOrCreateThread } from "../src/server/core.ts";
import { handleApi } from "../src/server/routes-api/index.ts";
import { integrationDatabase } from "./helpers/workspace.ts";

const ts = Date.now();
const fixture = integrationDatabase("read-remaining-unread");
const { db, schema, spaceId, human } = fixture;

const humanId = human.id;
let agentId = "";
let channelId = "";
let failures = 0;

const check = (label: string, condition: boolean) => {
  console.log(`  ${condition ? "PASS" : "FAIL"} ${label}`);
  if (!condition) failures++;
};

function makeReq(options: { method: string; path: string; body?: object }): IncomingMessage {
  const body = options.body ? JSON.stringify(options.body) : "";
  const stream = Readable.from(body ? [Buffer.from(body)] : []);
  return Object.assign(stream, {
    method: options.method,
    url: options.path,
    headers: {
      "x-kith-desktop-token": process.env.KITH_SPACE_DESKTOP_TOKEN!,
      "content-type": "application/json",
      "x-space-id": spaceId,
    },
    socket: { remoteAddress: "127.0.0.1" },
  }) as unknown as IncomingMessage;
}

function makeRes(): { res: ServerResponse; status: () => number; body: () => any } {
  let status = 0;
  let raw = "";
  const emitter = new EventEmitter();
  const res = Object.assign(emitter, {
    statusCode: 0,
    headersSent: false,
    setHeader() {},
    writeHead(code: number) {
      status = code;
      this.statusCode = code;
    },
    end(data?: string | Buffer) {
      raw = data ? String(data) : "";
      emitter.emit("finish");
    },
  }) as unknown as ServerResponse;
  return {
    res,
    status: () => status,
    body: () => {
      try { return JSON.parse(raw); } catch { return raw; }
    },
  };
}

async function apiCall(options: { method: string; path: string; body?: object }) {
  const { res, status, body } = makeRes();
  await handleApi(makeReq(options), res, new URL(options.path, "http://localhost"), options.method);
  return { status: status(), body: body() };
}

async function badge(parentChannelId: string): Promise<number> {
  const response = await apiCall({ method: "GET", path: "/api/channels/unread" });
  return response.body?.[parentChannelId] ?? 0;
}

async function readContainer(containerId: string) {
  return apiCall({ method: "POST", path: `/api/channels/${containerId}/read`, body: {} });
}

async function latestSeq(containerId: string): Promise<number> {
  const [row] = await db.select({ seq: schema.messages.seq }).from(schema.messages)
    .where(eq(schema.messages.channelId, containerId))
    .orderBy(desc(schema.messages.seq))
    .limit(1);
  return Number(row?.seq ?? 0);
}

// Establish a baseline independently of the endpoint under test.
async function dbMarkRead(containerId: string, followedThread = false) {
  const lastReadSeq = await latestSeq(containerId);
  await db.insert(schema.humanChannelStates).values({
    channelId: containerId,
    lastReadSeq,
    ...(followedThread ? { threadFollowedAt: new Date() } : {}),
  }).onConflictDoUpdate({
    target: schema.humanChannelStates.channelId,
    set: { lastReadSeq, threadDoneAt: null, ...(followedThread ? { threadFollowedAt: new Date() } : {}) },
  });
}

async function agentMessage(containerId: string, content: string) {
  return createMessage({
    spaceId,
    channelId: containerId,
    senderType: "agent",
    senderId: agentId,
    senderName: "Researcher",
    content,
  });
}

async function setup() {
  const [agent] = await db.insert(schema.agents).values({
    spaceId,
    name: `researcher_${ts}`,
    displayName: "Researcher",
    creatorId: humanId,
  }).returning();
  agentId = agent!.id;
  const [channel] = await db.insert(schema.channels).values({
    spaceId,
    name: `general-${ts}`,
    type: "channel",
  }).returning();
  channelId = channel!.id;
  await db.insert(schema.channelAgentMembers).values({ channelId, agentId });
}

async function cleanup() {
  const channels = await db.select({ id: schema.channels.id }).from(schema.channels)
    .where(eq(schema.channels.spaceId, spaceId));
  const messages = await db.select({ id: schema.messages.id }).from(schema.messages)
    .where(eq(schema.messages.spaceId, spaceId));
  for (const message of messages) {
    await db.delete(schema.messageMentions).where(eq(schema.messageMentions.messageId, message.id));
  }
  await db.delete(schema.messages).where(eq(schema.messages.spaceId, spaceId));
  for (const channel of channels) {
    await db.delete(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.channelId, channel.id));
    await db.delete(schema.humanChannelStates).where(eq(schema.humanChannelStates.channelId, channel.id));
  }
  await db.delete(schema.channels).where(eq(schema.channels.spaceId, spaceId));
  await db.delete(schema.agents).where(eq(schema.agents.spaceId, spaceId));
}

async function main() {
  await setup();

  const parent = await agentMessage(channelId, "parent message");
  const thread = await getOrCreateThread(spaceId, parent.id, { type: "human", id: humanId });
  await dbMarkRead(channelId);
  await dbMarkRead(thread.id, true);
  check("caught-up baseline has no unread", await badge(channelId) === 0);

  await agentMessage(thread.id, "thread-source unread");
  await agentMessage(channelId, "channel-source unread");

  console.log("\n[1] badge aggregates channel and followed-thread unread");
  check("badge equals two", await badge(channelId) === 2);

  console.log("\n[2] reading the channel preserves thread unread");
  const channelRead = await readContainer(channelId);
  check("channel read returns 200", channelRead.status === 200);
  check("channel read reports the parent channel", channelRead.body?.channelId === channelId);
  check("channel read reports one remaining unread", channelRead.body?.unread === 1);
  check("unread endpoint agrees", await badge(channelId) === 1);

  console.log("\n[3] reading the thread clears the remaining source");
  const threadRead = await readContainer(thread.id);
  check("thread read returns 200", threadRead.status === 200);
  check("thread read reports the parent channel", threadRead.body?.channelId === channelId);
  check("thread read reports zero remaining", threadRead.body?.unread === 0);
  check("unread endpoint is clear", await badge(channelId) === 0);

  console.log("\n[4] reading an already-read channel does not resurrect unread");
  const reread = await readContainer(channelId);
  check("re-read reports zero remaining", reread.body?.unread === 0);
  check("unread endpoint remains clear", await badge(channelId) === 0);
}

main()
  .catch((error) => {
    console.error("ERROR", error);
    failures++;
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error("cleanup error", error));
    console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
    process.exit(failures ? 1 : 0);
  });
