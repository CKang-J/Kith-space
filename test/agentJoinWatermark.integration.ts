// Agent join watermark contract:
// - an agent auto-joined by @mention sees the triggering message, not older backlog
// - a directly added agent starts caught up at the current channel watermark
// - messages sent after either join remain unread for that agent
import { and, desc, eq, gt, isNull, ne, or } from "drizzle-orm";
import { addChannelMembers, createMessage } from "../src/server/core.ts";
import { integrationDatabase } from "./helpers/workspace.ts";

const ts = Date.now();
const ghostName = `ghostA_${ts}`;
const directName = `botB_${ts}`;
const fixture = integrationDatabase("agent-join-watermark");
const { db, schema, spaceId } = fixture;

const humanId = fixture.human.id;
let ghostId = "";
let directId = "";
let mentionChannelId = "";
let directChannelId = "";
let failures = 0;

const check = (label: string, condition: boolean, detail = "") => {
  console.log(`  ${condition ? "PASS" : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`);
  if (!condition) failures++;
};

async function memberRow(channelId: string, agentId: string) {
  return (await db.select().from(schema.channelAgentMembers).where(and(
    eq(schema.channelAgentMembers.channelId, channelId),
    eq(schema.channelAgentMembers.agentId, agentId),
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
    spaceId,
    channelId,
    senderType: "human",
    senderId: humanId,
    senderName: "Ada",
    content,
  });
}

async function setup() {
  const [ghost, direct] = await db.insert(schema.agents).values([
    { spaceId, name: ghostName, displayName: "Ghost A", creatorId: humanId },
    { spaceId, name: directName, displayName: "Bot B", creatorId: humanId },
  ]).returning();
  ghostId = ghost!.id;
  directId = direct!.id;

  const [mentionChannel, directChannel] = await db.insert(schema.channels).values([
    { spaceId, name: `mention-${ts}`, type: "channel" },
    { spaceId, name: `direct-${ts}`, type: "channel" },
  ]).returning();
  mentionChannelId = mentionChannel!.id;
  directChannelId = directChannel!.id;
  for (const channelId of [mentionChannelId, directChannelId]) {
    for (const index of [1, 2, 3]) await post(channelId, `history ${index}`);
  }
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
  }
  await db.delete(schema.channels).where(eq(schema.channels.spaceId, spaceId));
  await db.delete(schema.agents).where(eq(schema.agents.spaceId, spaceId));
}

async function main() {
  await setup();
  const directPreJoinMax = await channelMaxSeq(directChannelId);

  const mention = await post(mentionChannelId, `@${ghostName} please look`);
  const autoJoined = await memberRow(mentionChannelId, ghostId);
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

  await addChannelMembers(spaceId, directChannelId, [{ type: "agent", id: directId }]);
  const directlyAdded = await memberRow(directChannelId, directId);
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
