import "../env.js";
import { and, eq } from "drizzle-orm";
import { getSpaceRecordBySlug } from "../app-data/appDatabase.js";
import { closeAllDatabases, dbForSpace, schema } from "./index.js";

async function main() {
  const space = getSpaceRecordBySlug("home");
  if (!space) throw new Error("[seed:dev] no Home Space - run `pnpm run seed` first");
  const db = dbForSpace(space.id);
  const existing = await db.select().from(schema.agents).where(and(
    eq(schema.agents.spaceId, space.id),
    eq(schema.agents.name, "dev-bot"),
  ));
  if (existing.length && !existing[0]!.deletedAt) {
    console.log("[seed:dev] dev-bot already exists, skipping");
    return;
  }
  const [bot] = await db.insert(schema.agents).values({
    spaceId: space.id,
    name: "dev-bot",
    displayName: "Dev Bot",
    description: "Local dev E2E agent - claude/sonnet. Created by `pnpm run seed:dev`.",
    model: "sonnet",
    runtime: "claude",
  }).returning();
  const [all] = await db.select().from(schema.channels).where(and(
    eq(schema.channels.spaceId, space.id),
    eq(schema.channels.name, "all"),
  ));
  if (all) {
    await db.insert(schema.channelAgentMembers).values({ channelId: all.id, agentId: bot!.id }).onConflictDoNothing();
  }
  console.log(`[seed:dev] created dev-bot (${bot!.id}) in #all`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(closeAllDatabases);
