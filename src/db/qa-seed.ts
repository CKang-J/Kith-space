// Clean QA environment: qa workspace + owner + dedicated machine key + two Claude agents + #general.
// The QA daemon uses QA_KEY, so it remains isolated from the default workspace bootstrap key.
// Run this seed, then start the daemon with --api-key qa-machine-key.
import { db, schema, sql } from "./index.js";
import { hashToken } from "../server/auth.js";
import { eq, and } from "drizzle-orm";

export const QA_KEY = "qa-machine-key";

async function main() {
  const { users, servers, serverMembers, machines, agents, channels, channelMembers } = schema;
  const ex = await db.select().from(servers).where(eq(servers.slug, "qa"));
  if (ex.length) { console.log("[qa-seed] QA workspace already exists; delete the server with slug=qa before resetting"); await sql.end(); return; }

  // Reuse a dev-login QA user if present, but remove its default-workspace membership to keep the fixture isolated.
  let qa = (await db.select().from(users).where(eq(users.name, "qa")))[0];
  if (!qa) qa = (await db.insert(users).values({ name: "qa", displayName: "QA", email: "qa@dev.local" }).returning())[0]!;
  const defaultWorkspace = (await db.select().from(servers).where(eq(servers.slug, "open-tag")))[0];
  if (defaultWorkspace) await db.delete(serverMembers).where(and(eq(serverMembers.userId, qa.id), eq(serverMembers.serverId, defaultWorkspace.id)));

  const [srv] = await db.insert(servers).values({ name: "QA Workspace", slug: "qa", ownerId: qa.id, plan: "free" }).returning();
  await db.insert(serverMembers).values({ serverId: srv!.id, userId: qa.id, role: "owner" });

  const [m] = await db.insert(machines).values({
    serverId: srv!.id, userId: qa.id, name: "qa-local",
    apiKeyHash: hashToken(QA_KEY), apiKeyPrefix: QA_KEY.slice(0, 14), runtimes: ["claude", "codex"],
  }).returning();

  const [cody] = await db.insert(agents).values({ serverId: srv!.id, machineId: m!.id, name: "cody", displayName: "Cody", description: "Local full-stack assistant that can edit workspace files and run commands.", model: "sonnet", runtime: "claude" }).returning();
  const [ada] = await db.insert(agents).values({ serverId: srv!.id, machineId: m!.id, name: "ada", displayName: "Ada", description: "Research and writing assistant.", model: "sonnet", runtime: "claude" }).returning();

  const [gen] = await db.insert(channels).values({ serverId: srv!.id, name: "general", description: "Main collaboration channel", type: "channel" }).returning();
  await db.insert(channelMembers).values([
    { channelId: gen!.id, memberType: "user", memberId: qa.id },
    { channelId: gen!.id, memberType: "agent", memberId: cody!.id },
    { channelId: gen!.id, memberType: "agent", memberId: ada!.id },
  ]);

  console.log("[qa-seed] done:");
  console.log("  server  :", srv!.id, "(slug=qa, name='QA Workspace')");
  console.log("  user    :", qa.id, "(qa, owner)");
  console.log("  machine :", m!.id, "(key=" + QA_KEY + ")");
  console.log("  agents  : cody/ada (claude)");
  console.log("  channel : #general");
  console.log("  start daemon: tsx src/daemon/index.ts --server-url http://localhost:7777 --api-key " + QA_KEY);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
