import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

const profileRoot = requiredAbsoluteOption("--profile");
if (existsSync(profileRoot)) {
  throw new Error("--profile must not already exist; choose a fresh absolute path");
}
const accessToken = stringOption("--access-token") ?? randomBytes(32).toString("base64url");
const port = integerOption("--port", 7777);

mkdirSync(profileRoot);
process.env.NODE_ENV = "test";
process.env.KITH_SPACE_HOME = path.join(profileRoot, "app-data");
process.env.KITH_SPACE_SPACES_DIR = path.join(profileRoot, "spaces");
process.env.KITH_SPACE_LOG_LEVEL = "error";

const [{ ensurePersonalApp }, database, { configureDevelopmentBrowserAccess }] = await Promise.all([
  import("../../src/db/personalApp.js"),
  import("../../src/db/index.js"),
  import("../../src/dev/browserAccessConfiguration.js"),
]);

try {
  const { human, home } = await ensurePersonalApp({
    name: "P-A9 Baseline Human",
    homeRootPath: path.join(profileRoot, "spaces", "Home"),
  });
  const db = database.dbForSpace(home.id);
  const datasets = [100, 500, 1000];
  let seq = 1;
  const channels: FixtureChannelSummary[] = [];
  const channelPairs: Array<{
    messageCount: number;
    a: FixtureChannelSummary;
    b: FixtureChannelSummary;
  }> = [];

  for (const messageCount of datasets) {
    const pair: FixtureChannelSummary[] = [];
    for (const variant of ["a", "b"] as const) {
      const name = variant === "a" ? `p-a9-ui-${messageCount}` : `p-a9-ui-${messageCount}-b`;
      const existing = db.select().from(database.schema.channels).all().find((channel) => channel.name === name);
      if (existing) throw new Error(`Baseline channel already exists: ${name}; use a fresh --profile directory`);
      const [channel] = await db.insert(database.schema.channels).values({
        spaceId: home.id,
        name,
        type: "channel",
      }).returning();
      if (!channel) throw new Error(`Failed to create ${name}`);

      for (let offset = 0; offset < messageCount; offset += 100) {
        const chunkSize = Math.min(100, messageCount - offset);
        await db.insert(database.schema.messages).values(Array.from({ length: chunkSize }, (_, index) => {
          const messageNumber = offset + index + 1;
          return {
            id: randomUUID(),
            seq: seq++,
            spaceId: home.id,
            channelId: channel.id,
            senderType: "human",
            senderId: human.id,
            senderName: human.name,
            messageType: "chat",
            content: fixtureText(messageCount, messageNumber, variant),
            searchText: `P-A9 UI fixture ${messageCount} ${variant.toUpperCase()} message ${messageNumber}`,
            createdAt: new Date(1_700_000_000_000 + seq * 1_000),
            updatedAt: new Date(1_700_000_000_000 + seq * 1_000),
          };
        }));
      }
      pair.push({
        id: channel.id,
        name,
        messageCount,
        targetText: fixtureText(messageCount, messageCount, variant),
      });
    }
    const [a, b] = pair;
    if (!a || !b) throw new Error(`Failed to create paired channels for ${messageCount}`);
    channels.push(a);
    channelPairs.push({ messageCount, a, b });
  }

  const appendChannels = await db.insert(database.schema.channels).values(
    Array.from({ length: 5 }, (_, index) => ({
      spaceId: home.id,
      name: `p-a9-ui-realtime-${index + 1}`,
      type: "channel",
    })),
  ).returning();
  if (appendChannels.length !== 5) throw new Error("Failed to create realtime baseline channels");

  await configureDevelopmentBrowserAccess({ mode: "local", port, accessToken });
  process.stdout.write(`${JSON.stringify({
    profileRoot,
    appDataRoot: process.env.KITH_SPACE_HOME,
    spacesRoot: process.env.KITH_SPACE_SPACES_DIR,
    humanId: human.id,
    spaceId: home.id,
    accessToken,
    port,
    channels,
    channelPairs,
    appendChannels: appendChannels.map((channel) => ({ id: channel.id, name: channel.name })),
  }, null, 2)}\n`);
} finally {
  database.closeAllDatabases();
}

function requiredAbsoluteOption(name: string): string {
  const value = stringOption(name);
  if (!value) throw new Error(`${name} is required`);
  if (!path.isAbsolute(value)) throw new Error(`${name} must be absolute`);
  return path.resolve(value);
}

function stringOption(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1]?.trim();
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function integerOption(name: string, fallback: number): number {
  const value = stringOption(name);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error(`${name} must be a valid port`);
  return parsed;
}

function fixtureText(messageCount: number, messageNumber: number, variant: "a" | "b"): string {
  const variantLabel = variant === "a" ? "A" : "B";
  return `P-A9 UI fixture ${messageCount} ${variantLabel} / message ${messageNumber}: deterministic text for rendering and scrolling.`;
}

interface FixtureChannelSummary {
  id: string;
  name: string;
  messageCount: number;
  targetText: string;
}
