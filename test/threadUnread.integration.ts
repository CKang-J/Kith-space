// Thread unread contract for one Human:
// - followed-thread replies contribute to the parent channel badge
// - thread ids do not appear as top-level sidebar unread keys
// - the Human's own replies and task transitions do not create unread
// - done threads stay out of followed-thread unread aggregation
import "../src/env.js";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { and, desc, eq } from "drizzle-orm";
import { initializeHumanProfile } from "../src/app-data/appDatabase.ts";
import { signUser } from "../src/server/auth.ts";
import { createMessage, getOrCreateThread, setTaskStatus } from "../src/server/core.ts";
import { handleApi } from "../src/server/routes-api/index.ts";
import { integrationDatabase } from "./helpers/workspace.ts";

const ts = Date.now();
const fixture = integrationDatabase("thread-unread");
const { db, schema, rootPath } = fixture;

let serverId = fixture.serverId;
let humanId = "";
let agentId = "";
let channelId = "";
let humanToken = "";
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
      authorization: `Bearer ${humanToken}`,
      "content-type": "application/json",
      "x-space-id": serverId,
    },
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
  await db.insert(schema.channelMembers).values({
    channelId: threadChannelId,
    memberType: "user",
    memberId: humanId,
    lastReadSeq,
  }).onConflictDoUpdate({
    target: [schema.channelMembers.channelId, schema.channelMembers.memberType, schema.channelMembers.memberId],
    set: { lastReadSeq, threadDoneAt: null },
  });
}

async function markChannelRead(parentChannelId: string) {
  const lastReadSeq = await latestSeq(parentChannelId);
  await db.insert(schema.channelMembers).values({
    channelId: parentChannelId,
    memberType: "user",
    memberId: humanId,
    lastReadSeq,
  }).onConflictDoUpdate({
    target: [schema.channelMembers.channelId, schema.channelMembers.memberType, schema.channelMembers.memberId],
    set: { lastReadSeq },
  });
}

async function agentMessage(containerId: string, content: string) {
  return createMessage({
    serverId,
    channelId: containerId,
    senderType: "agent",
    senderId: agentId,
    senderName: "Researcher",
    content,
  });
}

async function humanMessage(containerId: string, content: string, asTask = false) {
  return createMessage({
    serverId,
    channelId: containerId,
    senderType: "user",
    senderId: humanId,
    senderName: "Ada",
    content,
    asTask,
  });
}

async function setup() {
  const human = initializeHumanProfile({ name: "Ada", email: `ada-${ts}@test.local` });
  humanId = human.id;
  humanToken = signUser(humanId);
  await db.insert(schema.users).values({
    id: humanId,
    name: "you",
    displayName: human.name,
    email: human.email!,
  });
  await db.insert(schema.servers).values({
    id: serverId,
    name: "Thread Unread",
    slug: `thread-unread-${ts}`,
    ownerId: humanId,
    rootPath,
  });
  const [agent] = await db.insert(schema.agents).values({
    serverId,
    name: `researcher_${ts}`,
    displayName: "Researcher",
    creatorId: humanId,
  }).returning();
  agentId = agent!.id;
  const [channel] = await db.insert(schema.channels).values({
    serverId,
    name: `thread-unread-${ts}`,
    type: "channel",
  }).returning();
  channelId = channel!.id;
  await db.insert(schema.channelMembers).values([
    { channelId, memberType: "user", memberId: humanId },
    { channelId, memberType: "agent", memberId: agentId },
  ]);
}

async function cleanup() {
  const channels = await db.select({ id: schema.channels.id }).from(schema.channels)
    .where(eq(schema.channels.serverId, serverId));
  const messages = await db.select({ id: schema.messages.id }).from(schema.messages)
    .where(eq(schema.messages.serverId, serverId));
  for (const message of messages) {
    await db.delete(schema.messageMentions).where(eq(schema.messageMentions.messageId, message.id));
    await db.delete(schema.reactions).where(eq(schema.reactions.messageId, message.id));
    await db.delete(schema.savedMessages).where(eq(schema.savedMessages.messageId, message.id));
  }
  await db.delete(schema.messages).where(eq(schema.messages.serverId, serverId));
  for (const channel of channels) {
    await db.delete(schema.channelMembers).where(eq(schema.channelMembers.channelId, channel.id));
  }
  await db.delete(schema.channels).where(eq(schema.channels.serverId, serverId));
  await db.delete(schema.agents).where(eq(schema.agents.serverId, serverId));
  await db.delete(schema.servers).where(eq(schema.servers.id, serverId));
  await db.delete(schema.users).where(eq(schema.users.id, humanId));
}

async function main() {
  await setup();

  console.log("\n[1] followed-thread reply contributes to the parent badge");
  const parent = await agentMessage(channelId, "parent message");
  const thread = await getOrCreateThread(serverId, parent.id, { type: "user", id: humanId });
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
  await setTaskStatus(serverId, task.id, "in_progress", { type: "user", id: humanId });
  await markThreadRead(task.threadId);
  await setTaskStatus(serverId, task.id, "in_review", { type: "user", id: humanId });
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
  await setTaskStatus(serverId, task.id, "done", { type: "agent", id: agentId });
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
    serverId,
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
