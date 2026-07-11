import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { defaultWorkspaceRoot } from "../paths.js";
import { allWorkspaceDbs, dbFor, registerWorkspace, unregisterWorkspace } from "./index.js";
import * as schema from "./schema.js";

export async function createWorkspace(
  name: string,
  slug: string,
  ownerId: string,
  options: { rootPath?: string; owner?: typeof schema.users.$inferInsert } = {},
) {
  const workspaceId = randomUUID();
  const rootPath = options.rootPath ?? defaultWorkspaceRoot(slug);
  let owner = options.owner;
  if (!owner) {
    for (const candidate of allWorkspaceDbs()) {
      owner = (await candidate.db.select().from(schema.users).where(eq(schema.users.id, ownerId)))[0];
      if (owner) break;
    }
  }
  if (!owner) throw new Error(`workspace owner not found: ${ownerId}`);
  registerWorkspace({ id: workspaceId, name, slug, rootPath });
  try {
    const db = dbFor(workspaceId);
    await db.insert(schema.users).values({ ...owner, id: ownerId }).onConflictDoNothing();
    const [workspace] = await db.insert(schema.servers).values({ id: workspaceId, name, slug, ownerId, rootPath, plan: "free" }).returning();
    await db.insert(schema.serverMembers).values({ serverId: workspaceId, userId: ownerId, role: "owner" });
    const [all] = await db.insert(schema.channels).values({ serverId: workspaceId, name: "all", description: "General channel for all members", type: "channel" }).returning();
    await db.insert(schema.channelMembers).values({ channelId: all!.id, memberType: "user", memberId: ownerId }).onConflictDoNothing();
    return workspace!;
  } catch (error) {
    unregisterWorkspace(workspaceId);
    throw error;
  }
}
