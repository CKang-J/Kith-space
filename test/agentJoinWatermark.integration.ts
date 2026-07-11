// Agent join watermark contract:
// - an agent auto-joined by @mention sees the triggering message, not older backlog
// - a directly added agent starts caught up at the current channel watermark
// - messages sent after either join remain unread for that agent
import { and, desc, eq, gt, isNull, ne, or } from "drizzle-orm";
import { initializeHumanProfile } from "../src/app-data/appDatabase.ts";
import { addChannelMembers, createMessage } from "../src/server/core.ts";
import { integrationDatabase } from "./helpers/workspace.ts";

const ts = Date.now();
const ghostName = `ghostA_${ts}`;
const directName = `botB_${ts}`;
const fixture = integrationDatabase("agent-join-watermark");
const { db, schema, rootPath } = fixture;

let serverId = fixture.serverId;
let humanId = "";
let ghostId = "";
let directId = "";
let mentionChannelId = "";
let directChannelId = "";
let failures = 0;

const check = (label: string, condition: boolean, detail = "") => {
  console.log(`  ${condition ? "PASS" : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`);
  if (!condition) failures++;
};

async function memberRow(channelId: string, memberType: "agent" | "user", memberId: string) {
  return (await db.select().from(schema.channelMembers).where(and(
    eq(schema.channelMembers.channelId, channelId),
    eq(schema.channelMembers.memberType, memberType),
    eq(schema.channelMembers.memberId, memberId),
  )))[0];
}

async function channelMaxSeq(channelId: string): Promise<number> {
  const [row] = await db.select({ seq: schema.messages.seq }).from(schema.messages)
    .where(eq(schema.messages.channelId, channelId))
    .orderBy(desc(schema.messages.seq))
    .limit(1);
  return row?.seq ?? 0;
}

async function unreadCount(channelId: string, agentId: string, lastReadSeq: number): Promise<number> {
  const rows = await db.select({ id: schema.messages.id }).from(schema.messages).where(and(
    eq(schema.messages.channelId, channelId),
    gt(schema.messages.seq, lastReadSeq),
    or(isNull(schema.messages.senderId), ne(schema.messages.senderId, agentId)),
  ));
  return rows.length;
}

async function post(channelId: string, content: string) {
  return createMessage({
    serverId,
    channelId,
    senderType: "user",
    senderId: humanId,
    senderName: "Ada",
    content,
  });
}

async function setup() {
  const human = initializeHumanProfile({ name: "Ada", email: `ada-${ts}@test.local` });
  humanId = human.id;
  await db.insert(schema.users).values({
    id: humanId,
    name: "you",
    displayName: human.name,
    email: human.email!,
  });
  await db.insert(schema.servers).values({
    id: serverId,
    name: "Agent Join Watermark",
    slug: `agent-join-watermark-${ts}`,
    ownerId: humanId,
    rootPath,
  });

  const [ghost, direct] = await db.insert(schema.agents).values([
    { serverId, name: ghostName, displayName: "Ghost A", creatorId: humanId },
    { serverId, name: directName, displayName: "Bot B", creatorId: humanId },
  ]).returning();
  ghostId = ghost!.id;
  directId = direct!.id;

  const [mentionChannel, directChannel] = await db.insert(schema.channels).values([
    { serverId, name: `mention-${ts}`, type: "channel" },
    { serverId, name: `direct-${ts}`, type: "channel" },
  ]).returning();
  mentionChannelId = mentionChannel!.id;
  directChannelId = directChannel!.id;
  await db.insert(schema.channelMembers).values([
    { channelId: mentionChannelId, memberType: "user", memberId: humanId },
    { channelId: directChannelId, memberType: "user", memberId: humanId },
  ]);

  for (const channelId of [mentionChannelId, directChannelId]) {
    for (const index of [1, 2, 3]) await post(channelId, `history ${index}`);
  }
}

async function cleanup() {
  const channels = await db.select({ id: schema.channels.id }).from(schema.channels)
    .where(eq(schema.channels.serverId, serverId));
  const messages = await db.select({ id: schema.messages.id }).from(schema.messages)
    .where(eq(schema.messages.serverId, serverId));
  for (const message of messages) {
    await db.delete(schema.messageMentions).where(eq(schema.messageMentions.messageId, message.id));
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
  const directPreJoinMax = await channelMaxSeq(directChannelId);

  const mention = await post(mentionChannelId, `@${ghostName} please look`);
  const autoJoined = await memberRow(mentionChannelId, "agent", ghostId);
  check("mentioned agent auto-joined", Boolean(autoJoined));
  check(
    "mention watermark excludes the triggering message",
    autoJoined?.lastReadSeq === mention.seq - 1,
    `lastReadSeq=${autoJoined?.lastReadSeq} mentionSeq=${mention.seq}`,
  );
  check(
    "only the triggering mention is initially unread",
    await unreadCount(mentionChannelId, ghostId, autoJoined?.lastReadSeq ?? 0) === 1,
  );
  await post(mentionChannelId, "after auto-join");
  check(
    "post-join message remains unread for auto-joined agent",
    await unreadCount(mentionChannelId, ghostId, autoJoined?.lastReadSeq ?? 0) === 2,
  );

  await addChannelMembers(serverId, directChannelId, [{ type: "agent", id: directId }]);
  const directlyAdded = await memberRow(directChannelId, "agent", directId);
  check("directly added agent is a channel member", Boolean(directlyAdded));
  check(
    "direct add starts at the current channel watermark",
    directlyAdded?.lastReadSeq === directPreJoinMax,
    `lastReadSeq=${directlyAdded?.lastReadSeq} channelMax=${directPreJoinMax}`,
  );
  check(
    "directly added agent has no pre-join unread backlog",
    await unreadCount(directChannelId, directId, directlyAdded?.lastReadSeq ?? 0) === 0,
  );
  await post(directChannelId, "after direct add");
  check(
    "post-join message remains unread for directly added agent",
    await unreadCount(directChannelId, directId, directlyAdded?.lastReadSeq ?? 0) === 1,
  );
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
