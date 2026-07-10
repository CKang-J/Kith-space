import "../env.js";
import { and, eq } from "drizzle-orm";
import { closeAllDatabases, schema } from "./index.js";
import { findServerBySlug } from "./lookup.js";

async function main() {
  const found = await findServerBySlug("kith-space");
  if (!found) throw new Error("[seed:dev] no 'kith-space' workspace — run `pnpm run seed` first");
  const { db, value: server } = found;
  const existing = await db.select().from(schema.agents).where(and(eq(schema.agents.serverId, server.id), eq(schema.agents.name, "dev-bot")));
  if (existing.length && !existing[0]!.deletedAt) { console.log("[seed:dev] dev-bot already exists, skipping"); return; }
  const [bot] = await db.insert(schema.agents).values({
    serverId: server.id, name: "dev-bot", displayName: "Dev Bot",
    description: "Local dev E2E agent — claude/sonnet. Created by `pnpm run seed:dev`.",
    model: "sonnet", runtime: "claude",
  }).returning();
  const [all] = await db.select().from(schema.channels).where(and(eq(schema.channels.serverId, server.id), eq(schema.channels.name, "all")));
  if (all) await db.insert(schema.channelMembers).values({ channelId: all.id, memberType: "agent", memberId: bot!.id }).onConflictDoNothing();
  console.log(`[seed:dev] created dev-bot (${bot!.id}) in #all`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(closeAllDatabases);
