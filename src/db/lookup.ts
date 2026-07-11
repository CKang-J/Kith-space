import { eq } from "drizzle-orm";
import { allWorkspaceDbs, type WorkspaceDb, type WorkspaceRecord } from "./index.js";
import * as schema from "./schema.js";

type Located<T> = { workspace: WorkspaceRecord; db: WorkspaceDb; value: T };

async function firstInWorkspaces<T>(query: (db: WorkspaceDb) => Promise<T | undefined>): Promise<Located<T> | undefined> {
  for (const candidate of allWorkspaceDbs()) {
    const value = await query(candidate.db);
    if (value !== undefined) return { ...candidate, value };
  }
  return undefined;
}

export const findUserById = (id: string) => firstInWorkspaces(async (db) =>
  (await db.select().from(schema.users).where(eq(schema.users.id, id)))[0]);

export const findUserByName = (name: string) => firstInWorkspaces(async (db) =>
  (await db.select().from(schema.users).where(eq(schema.users.name, name)))[0]);

export const findAgentById = (id: string) => firstInWorkspaces(async (db) =>
  (await db.select().from(schema.agents).where(eq(schema.agents.id, id)))[0]);

export const findAttachmentById = (id: string) => firstInWorkspaces(async (db) =>
  (await db.select().from(schema.attachments).where(eq(schema.attachments.id, id)))[0]);

export const findServerBySlug = (slug: string) => firstInWorkspaces(async (db) =>
  (await db.select().from(schema.servers).where(eq(schema.servers.slug, slug)))[0]);

export async function updateUserCopies(userId: string, patch: Partial<typeof schema.users.$inferInsert>): Promise<void> {
  for (const { db } of allWorkspaceDbs()) {
    await db.update(schema.users).set(patch).where(eq(schema.users.id, userId));
  }
}
