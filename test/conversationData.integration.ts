// Conversation aggregate data contract:
// - thread summaries enumerate every live thread in the readable base channel/DM, independent of message paging/follow state
// - summaries preserve unread/follow metadata and sort by last reply, falling back to thread creation
// - channel files include their source message text in the bounded, permission-checked response
import "../src/env.js";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { createMessage } from "../src/server/core.ts";
import { handleApi } from "../src/server/routes-api/index.ts";
import { integrationDatabase } from "./helpers/workspace.ts";

const fixture = integrationDatabase("conversation-data");
const otherFixture = integrationDatabase("conversation-data-other-space");
const { db, schema, spaceId, human } = fixture;
const ts = Date.now();

let failures = 0;
let agentId = "";
let channelId = "";
let emptyChannelId = "";
let dmChannelId = "";

const check = (label: string, condition: boolean) => {
  console.log(`  ${condition ? "PASS" : "FAIL"} ${label}`);
  if (!condition) failures++;
};

function makeReq(options: { method: string; path: string }): IncomingMessage {
  const stream = Readable.from([]);
  return Object.assign(stream, {
    method: options.method,
    url: options.path,
    headers: {
      "x-kith-desktop-token": process.env.KITH_SPACE_DESKTOP_TOKEN!,
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

async function apiCall(path: string) {
  const { res, status, body } = makeRes();
  await handleApi(makeReq({ method: "GET", path }), res, new URL(path, "http://localhost"), "GET");
  return { status: status(), body: body() };
}

async function createParent(targetChannelId: string, content: string, sender: "human" | "agent" = "agent") {
  return createMessage({
    spaceId,
    channelId: targetChannelId,
    senderType: sender,
    senderId: sender === "human" ? human.id : agentId,
    senderName: sender === "human" ? human.name : "Researcher",
    content,
  });
}

async function insertThread(parentMessageId: string, createdAt: Date, extra: { deletedAt?: Date } = {}) {
  const id = randomUUID();
  await db.insert(schema.channels).values({
    id,
    spaceId,
    name: `thread-${parentMessageId.slice(0, 8)}`,
    type: "thread",
    parentMessageId,
    createdAt,
    deletedAt: extra.deletedAt ?? null,
  });
  return id;
}

async function setup() {
  const [agent] = await db.insert(schema.agents).values({
    spaceId,
    name: `researcher-${ts}`,
    displayName: "Researcher",
    creatorId: human.id,
  }).returning();
  agentId = agent!.id;

  const [channel, empty, dm] = await db.insert(schema.channels).values([
    { spaceId, name: `conversation-${ts}`, type: "channel" },
    { spaceId, name: `empty-${ts}`, type: "private" },
    { spaceId, name: `dm-${ts}`, type: "dm" },
  ]).returning();
  channelId = channel!.id;
  emptyChannelId = empty!.id;
  dmChannelId = dm!.id;
  await db.insert(schema.channelAgentMembers).values([
    { channelId, agentId },
    { channelId: dmChannelId, agentId },
  ]);
  await db.insert(schema.humanChannelStates).values({ channelId: dmChannelId, dmAgentId: agentId });
}

async function cleanup() {
  await db.delete(schema.attachments).where(eq(schema.attachments.spaceId, spaceId));
  const messages = await db.select({ id: schema.messages.id }).from(schema.messages)
    .where(eq(schema.messages.spaceId, spaceId));
  for (const message of messages) {
    await db.delete(schema.messageMentions).where(eq(schema.messageMentions.messageId, message.id));
    await db.delete(schema.reactions).where(eq(schema.reactions.messageId, message.id));
    await db.delete(schema.humanSavedMessages).where(eq(schema.humanSavedMessages.messageId, message.id));
  }
  await db.delete(schema.messages).where(eq(schema.messages.spaceId, spaceId));
  const channels = await db.select({ id: schema.channels.id }).from(schema.channels)
    .where(eq(schema.channels.spaceId, spaceId));
  for (const channel of channels) {
    await db.delete(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.channelId, channel.id));
    await db.delete(schema.humanChannelStates).where(eq(schema.humanChannelStates.channelId, channel.id));
  }
  await db.delete(schema.channels).where(eq(schema.channels.spaceId, spaceId));
  await db.delete(schema.agents).where(eq(schema.agents.spaceId, spaceId));
}

async function main() {
  await setup();

  console.log("\n[1] empty and permission-bounded thread summaries");
  const empty = await apiCall(`/api/channels/${emptyChannelId}/thread-summaries`);
  check("empty readable channel returns 200", empty.status === 200);
  check("empty readable channel returns an empty list", Array.isArray(empty.body?.threads) && empty.body.threads.length === 0);
  const foreign = await apiCall(`/api/channels/${otherFixture.all.id}/thread-summaries`);
  check("another Space's channel is not readable by raw id", foreign.status === 404);
  const [deletedBase] = await db.insert(schema.channels).values({
    spaceId,
    name: `deleted-base-${ts}`,
    type: "channel",
    deletedAt: new Date(),
  }).returning();
  const deletedBaseResult = await apiCall(`/api/channels/${deletedBase!.id}/thread-summaries`);
  check("deleted base channel is not readable", deletedBaseResult.status === 404);

  console.log("\n[2] all live channel threads are returned with stable metadata and ordering");
  const oldParent = await createParent(channelId, "old topic parent from Researcher");
  const recentParent = await createParent(channelId, "recent topic parent from the Human", "human");
  const repliedParent = await createParent(channelId, "active topic parent from Researcher");
  const deletedParent = await createParent(channelId, "deleted topic parent");
  const otherParent = await createParent(emptyChannelId, "another channel's topic parent");

  const oldThreadId = await insertThread(oldParent.id, new Date("2026-01-02T00:00:00.000Z"));
  const recentThreadId = await insertThread(recentParent.id, new Date("2026-01-03T00:00:00.000Z"));
  const repliedThreadId = await insertThread(repliedParent.id, new Date("2026-01-01T00:00:00.000Z"));
  const deletedThreadId = await insertThread(deletedParent.id, new Date("2026-01-05T00:00:00.000Z"), { deletedAt: new Date("2026-01-06T00:00:00.000Z") });
  await insertThread(otherParent.id, new Date("2026-01-07T00:00:00.000Z"));

  await db.insert(schema.humanChannelStates).values({
    channelId: repliedThreadId,
    lastReadSeq: 0,
    threadFollowedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  const reply = await createMessage({
    spaceId,
    channelId: repliedThreadId,
    senderType: "agent",
    senderId: agentId,
    senderName: "Researcher",
    content: "new activity in the topic",
  });
  await db.update(schema.messages).set({ createdAt: new Date("2026-01-04T00:00:00.000Z") })
    .where(eq(schema.messages.id, reply.id));

  const summaries = await apiCall(`/api/channels/${channelId}/thread-summaries`);
  const threads = summaries.body?.threads ?? [];
  check("thread summaries return 200", summaries.status === 200);
  check("threads sort by last reply then creation fallback", JSON.stringify(threads.map((item: any) => item.threadChannelId)) === JSON.stringify([repliedThreadId, recentThreadId, oldThreadId]));
  check("unfollowed old thread is included", threads.some((item: any) => item.threadChannelId === oldThreadId && item.followed === false));
  check("deleted thread is excluded", !threads.some((item: any) => item.threadChannelId === deletedThreadId));
  check("thread from another base channel is excluded", threads.length === 3);
  const active = threads.find((item: any) => item.threadChannelId === repliedThreadId);
  check("parent message and channel are summarized", active?.parentMessageId === repliedParent.id && active?.parentChannelId === channelId && active?.parentMessageText === "active topic parent from Researcher");
  check("parent sender is summarized", active?.parentSender?.type === "agent" && active?.parentSender?.id === agentId && active?.parentSender?.name === "Researcher");
  check("reply, unread, and follow metadata are preserved", active?.replyCount === 1 && active?.unreadCount === 1 && active?.followed === true);
  check("last reply and creation timestamps are returned", active?.lastReplyAt === "2026-01-04T00:00:00.000Z" && active?.createdAt === "2026-01-01T00:00:00.000Z");

  console.log("\n[3] DM conversations expose their own threads only");
  const dmParent = await createParent(dmChannelId, "DM topic parent");
  const dmThreadId = await insertThread(dmParent.id, new Date("2026-02-01T00:00:00.000Z"));
  const dmSummaries = await apiCall(`/api/channels/${dmChannelId}/thread-summaries`);
  check("tracked Human-Agent DM returns 200", dmSummaries.status === 200);
  check("DM returns only its own topic", dmSummaries.body?.threads?.length === 1 && dmSummaries.body.threads[0]?.threadChannelId === dmThreadId);

  console.log("\n[4] channel files carry their source message text");
  const fileMessage = await createParent(channelId, "source message searchable in the aggregate panel", "human");
  const [attachment] = await db.insert(schema.attachments).values({
    spaceId,
    channelId,
    messageId: fileMessage.id,
    uploaderType: "human",
    uploaderId: human.id,
    filename: "design-notes.md",
    mimeType: "text/markdown",
    sizeBytes: 42,
    storageKey: `test/${randomUUID()}`,
  }).returning();
  await db.insert(schema.attachments).values({
    spaceId,
    channelId,
    messageId: null,
    uploaderType: "human",
    uploaderId: human.id,
    filename: "pending.txt",
    storageKey: `test/${randomUUID()}`,
  });
  const files = await apiCall(`/api/channels/${channelId}/files`);
  const listed = files.body?.files?.find((item: any) => item.id === attachment!.id);
  check("files endpoint returns 200", files.status === 200);
  check("attached file remains listed", Boolean(listed));
  check("file includes its source message text", listed?.sourceMessageText === "source message searchable in the aggregate panel");
  check("pending uploads remain excluded", files.body?.files?.every((item: any) => item.filename !== "pending.txt") === true);
  const foreignFiles = await apiCall(`/api/channels/${otherFixture.all.id}/files`);
  check("files remain scoped to a readable channel in this Space", foreignFiles.status === 404);
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
