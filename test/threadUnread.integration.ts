// Thread unread contract for one Human:
// - followed-thread replies contribute to the parent channel badge
// - thread ids do not appear as top-level sidebar unread keys
// - the Human's own replies and task transitions do not create unread
// - done threads stay out of followed-thread unread aggregation
import "../src/env.js";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { desc, eq } from "drizzle-orm";
import { createMessage, getOrCreateThread, setTaskStatus } from "../src/server/core.ts";
import { handleApi } from "../src/server/routes-api/index.ts";
import { integrationDatabase } from "./helpers/workspace.ts";

const ts = Date.now();
const fixture = integrationDatabase("thread-unread");
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

async function latestSeq(containerId: string): Promise<number> {
  const [row] = await db.select({ seq: schema.messages.seq }).from(schema.messages)
    .where(eq(schema.messages.channelId, containerId))
    .orderBy(desc(schema.messages.seq))
    .limit(1);
  return Number(row?.seq ?? 0);
}

async function markThreadRead(threadChannelId: string) {
  const lastReadSeq = await latestSeq(threadChannelId);
  await db.insert(schema.humanChannelStates).values({
    channelId: threadChannelId,
    lastReadSeq,
    threadFollowedAt: new Date(),
  }).onConflictDoUpdate({
    target: schema.humanChannelStates.channelId,
    set: { lastReadSeq, threadFollowedAt: new Date(), threadDoneAt: null },
  });
}

async function markChannelRead(parentChannelId: string) {
  const lastReadSeq = await latestSeq(parentChannelId);
  await db.insert(schema.humanChannelStates).values({
    channelId: parentChannelId,
    lastReadSeq,
  }).onConflictDoUpdate({
    target: schema.humanChannelStates.channelId,
    set: { lastReadSeq },
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

async function humanMessage(containerId: string, content: string, asTask = false) {
  return createMessage({
    spaceId,
    channelId: containerId,
    senderType: "human",
    senderId: humanId,
    senderName: "Ada",
    content,
    asTask,
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
    name: `thread-unread-${ts}`,
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
    await db.delete(schema.reactions).where(eq(schema.reactions.messageId, message.id));
    await db.delete(schema.humanSavedMessages).where(eq(schema.humanSavedMessages.messageId, message.id));
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

  console.log("\n[1] followed-thread reply contributes to the parent badge");
  const parent = await agentMessage(channelId, "parent message");
  const thread = await getOrCreateThread(spaceId, parent.id, { type: "human", id: humanId });
  await markChannelRead(channelId);
  await markThreadRead(thread.id);
  await agentMessage(thread.id, "incoming thread reply");
  const unread = await apiCall({ method: "GET", path: "/api/channels/unread" });
  check("unread endpoint returns 200", unread.status === 200);
  check("parent channel has one unread from the thread", unread.body?.[channelId] === 1);
  check("raw thread id is not a sidebar unread key", unread.body?.[thread.id] == null);

  console.log("\n[2] the Human's own thread reply is not unread");
  await markThreadRead(thread.id);
  await humanMessage(thread.id, "my own thread reply");
  const threadMetadata = await apiCall({
    method: "GET",
    path: `/api/channels/${channelId}/threads?parentMessageIds=${parent.id}`,
  });
  check("thread metadata returns 200", threadMetadata.status === 200);
  check("own reply leaves unreadCount at zero", threadMetadata.body?.[parent.id]?.unreadCount === 0);

  console.log("\n[3] the Human's own task transition is not unread");
  const task = await humanMessage(channelId, "task owned by the Human", true);
  if (!task.threadId) throw new Error("task thread was not created");
  await setTaskStatus(spaceId, task.id, "in_progress", { type: "human", id: humanId });
  await markThreadRead(task.threadId);
  await setTaskStatus(spaceId, task.id, "in_review", { type: "human", id: humanId });
  const taskMetadata = await apiCall({
    method: "GET",
    path: `/api/channels/${channelId}/threads?parentMessageIds=${task.id}`,
  });
  check("task thread metadata returns 200", taskMetadata.status === 200);
  check("own task transition leaves unreadCount at zero", taskMetadata.body?.[task.id]?.unreadCount === 0);

  console.log("\n[4] done thread remains outside followed-thread unread");
  await markThreadRead(task.threadId);
  const done = await apiCall({
    method: "POST",
    path: "/api/channels/threads/done",
    body: { threadChannelId: task.threadId },
  });
  check("mark thread done returns 200", done.status === 200);
  await setTaskStatus(spaceId, task.id, "done", { type: "agent", id: agentId });
  const afterDoneUnread = await apiCall({ method: "GET", path: "/api/channels/unread" });
  check("done thread does not light the parent badge", afterDoneUnread.body?.[channelId] == null);
  const followed = await apiCall({ method: "GET", path: "/api/channels/threads/followed" });
  check(
    "done thread is hidden from followed threads",
    !(followed.body?.threads ?? []).some((item: any) => item.threadChannelId === task.threadId),
  );

  console.log("\n[5] null-sender system unread is consistent with inbox");
  await markChannelRead(channelId);
  await createMessage({
    spaceId,
    channelId,
    senderType: "system",
    senderId: null,
    senderName: "system",
    content: "system notice",
  });
  const systemUnread = await apiCall({ method: "GET", path: "/api/channels/unread" });
  check("system message counts in channel unread", systemUnread.body?.[channelId] === 1);
  const inbox = await apiCall({ method: "GET", path: "/api/channels/inbox?filter=unread" });
  const inboxItem = (inbox.body?.items ?? []).find((item: any) => item.channelId === channelId);
  check("system message appears in unread inbox", inboxItem?.unreadCount === 1);
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
