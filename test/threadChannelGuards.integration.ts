// Internal thread channels are not ordinary top-level channel resources:
// - agent space/info must not expose them in its channel list
// - Human channel lifecycle endpoints must not rename, archive, or delete them
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { and, eq } from "drizzle-orm";
import { createMessage, getOrCreateThread } from "../src/server/core.ts";
import { handleAgentApi } from "../src/server/routes-agent.ts";
import { handleChannels } from "../src/server/routes-api/channels.ts";
import { integrationDatabase } from "./helpers/workspace.ts";

const ts = Date.now();
const fixture = integrationDatabase("thread-channel-guards");
const { db, schema, spaceId, human } = fixture;
const rawAgentToken = `sk_agent_test_${ts}`;

const humanId = human.id;
let agentId = "";
let publicChannelId = "";
let failures = 0;

const check = (label: string, condition: boolean) => {
  console.log(`  ${condition ? "PASS" : "FAIL"} ${label}`);
  if (!condition) failures++;
};

function mockAgentReq(method: string): IncomingMessage {
  const stream = Readable.from([]) as unknown as IncomingMessage;
  (stream as any).method = method;
  (stream as any).headers = {
    authorization: `Bearer ${rawAgentToken}`,
    "x-agent-id": agentId,
  };
  (stream as any).url = "";
  return stream;
}

function mockHumanReq(method: string, body: object = {}): IncomingMessage {
  const stream = Readable.from([JSON.stringify(body)]) as unknown as IncomingMessage;
  (stream as any).method = method;
  (stream as any).headers = {};
  (stream as any).url = "";
  return stream;
}

function mockRes(): { res: ServerResponse; status: () => number; body: () => any } {
  let status = 0;
  let raw = "";
  const res = {
    writeHead(code: number) { status = code; },
    end(payload?: string) { raw = payload ?? ""; },
  } as unknown as ServerResponse;
  return {
    res,
    status: () => status,
    body: () => {
      try { return JSON.parse(raw); } catch { return {}; }
    },
  };
}

function ctx(method: string, pathname: string, req: IncomingMessage, res: ServerResponse) {
  return {
    req,
    res,
    url: new URL(`http://localhost${pathname}`),
    method,
    p: pathname,
    humanId,
    spaceId,
  };
}

async function setup() {
  const [agent] = await db.insert(schema.agents).values({
    spaceId,
    name: `agent_${ts}`,
    displayName: "Agent",
    creatorId: humanId,
    agentTokenHash: createHash("sha256").update(rawAgentToken).digest("hex"),
  }).returning();
  agentId = agent!.id;
  const [channel] = await db.insert(schema.channels).values({
    spaceId,
    name: `channel-${ts}`,
    type: "channel",
  }).returning();
  publicChannelId = channel!.id;
  await db.insert(schema.channelAgentMembers).values({ channelId: publicChannelId, agentId });
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
  const parent = await createMessage({
    spaceId,
    channelId: publicChannelId,
    senderType: "human",
    senderId: humanId,
    senderName: "Ada",
    content: "parent message",
  });
  const thread = await getOrCreateThread(spaceId, parent.id, { type: "agent", id: agentId });
  await db.insert(schema.channelAgentMembers).values({ channelId: thread.id, agentId }).onConflictDoNothing();

  console.log("\n[1] agent space/info excludes internal thread channels");
  const info = mockRes();
  await handleAgentApi(
    mockAgentReq("GET"),
    info.res,
    new URL("http://localhost/agent-api/space/info"),
    "GET",
  );
  const visibleChannels: { name: string }[] = info.body().channels ?? [];
  check("space/info returns 200", info.status() === 200);
  check("thread channel is not listed", !visibleChannels.some((channel) => channel.name === thread.name));
  check("ordinary public channel remains listed", visibleChannels.some((channel) => channel.name === `channel-${ts}`));

  console.log("\n[2] PATCH cannot turn a thread into a top-level channel");
  const patch = mockRes();
  await handleChannels(ctx(
    "PATCH",
    `/api/channels/${thread.id}`,
    mockHumanReq("PATCH", { visibility: "channel" }),
    patch.res,
  ));
  check("PATCH thread returns 403", patch.status() === 403);
  check("error identifies a thread guard", String(patch.body().error ?? "").toLowerCase().includes("thread"));
  const afterPatch = (await db.select({ type: schema.channels.type }).from(schema.channels)
    .where(eq(schema.channels.id, thread.id)))[0];
  check("thread type was not changed", afterPatch?.type === "thread");

  console.log("\n[3] archive cannot act on a thread directly");
  const archive = mockRes();
  await handleChannels(ctx(
    "POST",
    `/api/channels/${thread.id}/archive`,
    mockHumanReq("POST"),
    archive.res,
  ));
  check("archive thread returns 403", archive.status() === 403);
  const afterArchive = (await db.select({ archivedAt: schema.channels.archivedAt }).from(schema.channels)
    .where(eq(schema.channels.id, thread.id)))[0];
  check("thread was not archived", afterArchive?.archivedAt == null);

  console.log("\n[4] delete cannot act on a thread directly");
  const remove = mockRes();
  await handleChannels(ctx(
    "DELETE",
    `/api/channels/${thread.id}`,
    mockHumanReq("DELETE"),
    remove.res,
  ));
  check("delete thread returns 403", remove.status() === 403);
  const afterDelete = (await db.select({ deletedAt: schema.channels.deletedAt }).from(schema.channels)
    .where(eq(schema.channels.id, thread.id)))[0];
  check("thread was not soft-deleted", afterDelete?.deletedAt == null);

  console.log("\n[5] ordinary channel lifecycle remains available");
  const ordinaryArchive = mockRes();
  await handleChannels(ctx(
    "POST",
    `/api/channels/${publicChannelId}/archive`,
    mockHumanReq("POST"),
    ordinaryArchive.res,
  ));
  check("ordinary channel archive returns 200", ordinaryArchive.status() === 200);
  const ordinaryUnarchive = mockRes();
  await handleChannels(ctx(
    "POST",
    `/api/channels/${publicChannelId}/unarchive`,
    mockHumanReq("POST"),
    ordinaryUnarchive.res,
  ));
  check("ordinary channel unarchive returns 200", ordinaryUnarchive.status() === 200);
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
