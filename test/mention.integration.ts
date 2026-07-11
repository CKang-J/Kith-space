// Slack-style mention contract for one Human and local agents:
// - public channels may auto-join an addressed local agent
// - private channels and DMs do not admit an agent outside their current scope
// - threads inherit the parent channel's mention reach
import { eq } from "drizzle-orm";
import { createMessage, getOrCreateDM, getOrCreateThread } from "../src/server/core.ts";
import { integrationDatabase } from "./helpers/workspace.ts";

const ts = Date.now();
const ghostName = `ghost_${ts}`;
const outsiderName = `outsider_${ts}`;
const fixture = integrationDatabase("mention");
const { db, schema, spaceId } = fixture;

const humanId = fixture.human.id;
let ghostId = "";
let outsiderId = "";
let publicChannelId = "";
let privateChannelId = "";
let dmChannelId = "";
let failures = 0;

const check = (label: string, condition: boolean) => {
  console.log(`  ${condition ? "PASS" : "FAIL"} ${label}`);
  if (!condition) failures++;
};

async function members(channelId: string) {
  return db.select().from(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.channelId, channelId));
}

async function mentionsOf(messageId: string) {
  return db.select().from(schema.messageMentions).where(eq(schema.messageMentions.messageId, messageId));
}

const inChannel = (rows: any[], id: string) => rows.some((row) => row.agentId === id);

const mentioned = (rows: any[], type: "human" | "agent", id: string) =>
  rows.some((row) => row.mentionType === type && row.mentionId === id);

async function humanMessage(channelId: string, content: string) {
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
  const [ghost, outsider] = await db.insert(schema.agents).values([
    { spaceId, name: ghostName, displayName: "Ghost", creatorId: humanId },
    { spaceId, name: outsiderName, displayName: "Outsider", creatorId: humanId },
  ]).returning();
  ghostId = ghost!.id;
  outsiderId = outsider!.id;

  const [publicChannel, privateChannel] = await db.insert(schema.channels).values([
    { spaceId, name: `public-${ts}`, type: "channel" },
    { spaceId, name: `private-${ts}`, type: "private" },
  ]).returning();
  publicChannelId = publicChannel!.id;
  privateChannelId = privateChannel!.id;
  dmChannelId = await getOrCreateDM(spaceId, humanId, "human", ghostId, "agent");
}

async function cleanup() {
  const messages = await db.select({ id: schema.messages.id }).from(schema.messages)
    .where(eq(schema.messages.spaceId, spaceId));
  for (const message of messages) {
    await db.delete(schema.messageMentions).where(eq(schema.messageMentions.messageId, message.id));
  }
  await db.delete(schema.messages).where(eq(schema.messages.spaceId, spaceId));
  const channels = await db.select({ id: schema.channels.id }).from(schema.channels)
    .where(eq(schema.channels.spaceId, spaceId));
  for (const channel of channels) {
    await db.delete(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.channelId, channel.id));
  }
  await db.delete(schema.channels).where(eq(schema.channels.spaceId, spaceId));
  await db.delete(schema.agents).where(eq(schema.agents.spaceId, spaceId));
}

async function main() {
  await setup();

  console.log("\n[1] public channel mention auto-joins a local agent");
  const publicMention = await humanMessage(publicChannelId, `@${ghostName} please investigate`);
  check("addressed agent joined the public channel", inChannel(await members(publicChannelId), ghostId));
  check("agent mention was recorded", mentioned(await mentionsOf(publicMention.id), "agent", ghostId));

  console.log("\n[2] re-mentioning the joined agent is idempotent");
  const before = (await members(publicChannelId)).length;
  await humanMessage(publicChannelId, `@${ghostName} follow up`);
  check("channel membership count did not change", (await members(publicChannelId)).length === before);

  console.log("\n[3] private channel mention does not admit an out-of-scope agent");
  const privateMention = await humanMessage(privateChannelId, `@${ghostName} private work`);
  check("agent was not added to the private channel", !inChannel(await members(privateChannelId), ghostId));
  check("out-of-scope private mention was not recorded", !mentioned(await mentionsOf(privateMention.id), "agent", ghostId));

  console.log("\n[4] DM mention does not add a third party");
  const dmMention = await humanMessage(dmChannelId, `@${outsiderName} look here`);
  check("third agent was not added to the DM", !inChannel(await members(dmChannelId), outsiderId));
  check("out-of-scope DM mention was not recorded", !mentioned(await mentionsOf(dmMention.id), "agent", outsiderId));

  console.log("\n[5] thread under a public channel inherits public mention reach");
  const publicParent = await humanMessage(publicChannelId, "public thread parent");
  const publicThread = await getOrCreateThread(spaceId, publicParent.id, { type: "human", id: humanId });
  const publicThreadMention = await humanMessage(publicThread.id, `@${ghostName} pick up this thread`);
  check("parent-channel agent joined the public thread", inChannel(await members(publicThread.id), ghostId));
  check("public-thread mention was recorded", mentioned(await mentionsOf(publicThreadMention.id), "agent", ghostId));

  console.log("\n[6] thread under a private channel inherits private mention reach");
  const privateParent = await humanMessage(privateChannelId, "private thread parent");
  const privateThread = await getOrCreateThread(spaceId, privateParent.id, { type: "human", id: humanId });
  const privateThreadMention = await humanMessage(privateThread.id, `@${ghostName} secret thread work`);
  check("agent was not added to the private thread", !inChannel(await members(privateThread.id), ghostId));
  check("out-of-scope private-thread mention was not recorded", !mentioned(await mentionsOf(privateThreadMention.id), "agent", ghostId));
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
