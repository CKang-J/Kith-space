import "../env.js";
import { randomUUID } from "node:crypto";
import { closeAllDatabases, schema } from "./index.js";
import { findServerBySlug, findUserByName } from "./lookup.js";
import { createWorkspace } from "./workspace.js";

async function main() {
  if (await findServerBySlug("qa")) {
    console.log("[qa-seed] QA workspace already exists; remove it before resetting");
    return;
  }
  const existing = (await findUserByName("qa"))?.value;
  const qa = existing ?? { id: randomUUID(), name: "qa", displayName: "QA", email: "qa@dev.local" };
  const server = await createWorkspace("QA Workspace", "qa", qa.id, { owner: qa });
  const found = (await findServerBySlug("qa"))!;
  const db = found.db;
  const [cody] = await db.insert(schema.agents).values({ serverId: server.id, name: "cody", displayName: "Cody", description: "Local full-stack assistant that can edit workspace files and run commands.", model: "sonnet", runtime: "claude" }).returning();
  const [ada] = await db.insert(schema.agents).values({ serverId: server.id, name: "ada", displayName: "Ada", description: "Research and writing assistant.", model: "sonnet", runtime: "claude" }).returning();
  const [general] = await db.insert(schema.channels).values({ serverId: server.id, name: "general", description: "Main collaboration channel", type: "channel" }).returning();
  await db.insert(schema.channelMembers).values([
    { channelId: general!.id, memberType: "user", memberId: qa.id },
    { channelId: general!.id, memberType: "agent", memberId: cody!.id },
    { channelId: general!.id, memberType: "agent", memberId: ada!.id },
  ]);
  console.log("[qa-seed] done:");
  console.log("  server  :", server.id, "(slug=qa, name='QA Workspace')");
  console.log("  user    :", qa.id, "(qa, owner)");
  console.log("  agents  : cody/ada (claude)");
  console.log("  channel : #general");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(closeAllDatabases);
