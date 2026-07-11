import "../env.js";
import { getHumanProfile, getSpaceRecordBySlug } from "../app-data/appDatabase.js";
import { closeAllDatabases, dbForSpace, schema } from "./index.js";
import { createSpace } from "./space.js";

async function main() {
  if (getSpaceRecordBySlug("qa")) {
    console.log("[qa-seed] QA Space already exists; remove it before resetting");
    return;
  }
  const human = getHumanProfile();
  if (!human) throw new Error("[qa-seed] initialize the Human with `pnpm run seed` first");
  const space = await createSpace("QA Space", "qa");
  const db = dbForSpace(space.id);
  const [cody] = await db.insert(schema.agents).values({
    spaceId: space.id,
    name: "cody",
    displayName: "Cody",
    description: "Local full-stack assistant that can edit Space files and run commands.",
    model: "sonnet",
    runtime: "claude",
    creatorId: human.id,
  }).returning();
  const [ada] = await db.insert(schema.agents).values({
    spaceId: space.id,
    name: "ada",
    displayName: "Ada",
    description: "Research and writing assistant.",
    model: "sonnet",
    runtime: "claude",
    creatorId: human.id,
  }).returning();
  const [general] = await db.insert(schema.channels).values({
    spaceId: space.id,
    name: "general",
    description: "Main collaboration channel",
    type: "channel",
  }).returning();
  await db.insert(schema.channelAgentMembers).values([
    { channelId: general!.id, agentId: cody!.id },
    { channelId: general!.id, agentId: ada!.id },
  ]);
  console.log("[qa-seed] done:");
  console.log("  Space   :", space.id, "(slug=qa, name='QA Space')");
  console.log("  Human   :", human.id);
  console.log("  agents  : cody/ada (claude)");
  console.log("  channel : #general");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(closeAllDatabases);
