// Slack-style mention contract for one Human and local agents:
// - public channels may auto-join an addressed local agent
// - private channels and DMs do not admit an agent outside their current scope
// - threads inherit the parent channel's mention reach
import { eq } from "drizzle-orm";
import { initializeHumanProfile } from "../src/app-data/appDatabase.ts";
import { createMessage, getOrCreateThread } from "../src/server/core.ts";
import { integrationDatabase } from "./helpers/workspace.ts";

const ts = Date.now();
const ghostName = `ghost_${ts}`;
const outsiderName = `outsider_${ts}`;
const fixture = integrationDatabase("mention");
const { db, schema, rootPath } = fixture;

let serverId = fixture.serverId;
let humanId = "";
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
  return db.select().from(schema.channelMembers).where(eq(schema.channelMembers.channelId, channelId));
}

async function mentionsOf(messageId: string) {
  return db.select().from(schema.messageMentions).where(eq(schema.messageMentions.messageId, messageId));
}

const inChannel = (rows: any[], type: "user" | "agent", id: string) =>
  rows.some((row) => row.memberType === type && row.memberId === id);

const mentioned = (rows: any[], type: "user" | "agent", id: string) =>
  rows.some((row) => row.mentionType === type && row.mentionId === id);

async function humanMessage(channelId: string, content: string) {
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
    name: "Mention Scope",
    slug: `mention-${ts}`,
    ownerId: humanId,
    rootPath,
  });

  const [ghost, outsider] = await db.insert(schema.agents).values([
    { serverId, name: ghostName, displayName: "Ghost", creatorId: humanId },
    { serverId, name: outsiderName, displayName: "Outsider", creatorId: humanId },
  ]).returning();
  ghostId = ghost!.id;
  outsiderId = outsider!.id;

  const [publicChannel, privateChannel, dmChannel] = await db.insert(schema.channels).values([
    { serverId, name: `public-${ts}`, type: "channel" },
    { serverId, name: `private-${ts}`, type: "private" },
    { serverId, name: `dm-${ts}`, type: "dm" },
  ]).returning();
  publicChannelId = publicChannel!.id;
  privateChannelId = privateChannel!.id;
  dmChannelId = dmChannel!.id;
  await db.insert(schema.channelMembers).values([
    { channelId: publicChannelId, memberType: "user", memberId: humanId },
    { channelId: privateChannelId, memberType: "user", memberId: humanId },
    { channelId: dmChannelId, memberType: "user", memberId: humanId },
    { channelId: dmChannelId, memberType: "agent", memberId: ghostId },
  ]);
}

async function cleanup() {
  const messages = await db.select({ id: schema.messages.id }).from(schema.messages)
    .where(eq(schema.messages.serverId, serverId));
  for (const message of messages) {
    await db.delete(schema.messageMentions).where(eq(schema.messageMentions.messageId, message.id));
  }
  await db.delete(schema.messages).where(eq(schema.messages.serverId, serverId));
  const channels = await db.select({ id: schema.channels.id }).from(schema.channels)
    .where(eq(schema.channels.serverId, serverId));
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

  console.log("\n[1] public channel mention auto-joins a local agent");
  const publicMention = await humanMessage(publicChannelId, `@${ghostName} please investigate`);
  check("addressed agent joined the public channel", inChannel(await members(publicChannelId), "agent", ghostId));
  check("agent mention was recorded", mentioned(await mentionsOf(publicMention.id), "agent", ghostId));

  console.log("\n[2] re-mentioning the joined agent is idempotent");
  const before = (await members(publicChannelId)).length;
  await humanMessage(publicChannelId, `@${ghostName} follow up`);
  check("channel membership count did not change", (await members(publicChannelId)).length === before);

  console.log("\n[3] private channel mention does not admit an out-of-scope agent");
  const privateMention = await humanMessage(privateChannelId, `@${ghostName} private work`);
  check("agent was not added to the private channel", !inChannel(await members(privateChannelId), "agent", ghostId));
  check("out-of-scope private mention was not recorded", !mentioned(await mentionsOf(privateMention.id), "agent", ghostId));

  console.log("\n[4] DM mention does not add a third party");
  const dmMention = await humanMessage(dmChannelId, `@${outsiderName} look here`);
  check("third agent was not added to the DM", !inChannel(await members(dmChannelId), "agent", outsiderId));
  check("out-of-scope DM mention was not recorded", !mentioned(await mentionsOf(dmMention.id), "agent", outsiderId));

  console.log("\n[5] thread under a public channel inherits public mention reach");
  const publicParent = await humanMessage(publicChannelId, "public thread parent");
  const publicThread = await getOrCreateThread(serverId, publicParent.id, { type: "user", id: humanId });
  const publicThreadMention = await humanMessage(publicThread.id, `@${ghostName} pick up this thread`);
  check("parent-channel agent joined the public thread", inChannel(await members(publicThread.id), "agent", ghostId));
  check("public-thread mention was recorded", mentioned(await mentionsOf(publicThreadMention.id), "agent", ghostId));

  console.log("\n[6] thread under a private channel inherits private mention reach");
  const privateParent = await humanMessage(privateChannelId, "private thread parent");
  const privateThread = await getOrCreateThread(serverId, privateParent.id, { type: "user", id: humanId });
  const privateThreadMention = await humanMessage(privateThread.id, `@${ghostName} secret thread work`);
  check("agent was not added to the private thread", !inChannel(await members(privateThread.id), "agent", ghostId));
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
