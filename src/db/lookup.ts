import { eq } from "drizzle-orm";
import { availableSpaceDbs, type SpaceDb } from "./index.js";
import type { SpaceRecord } from "../app-data/appDatabase.js";
import * as schema from "./schema.js";

type Located<T> = { space: SpaceRecord; db: SpaceDb; value: T };

async function firstInSpaces<T>(query: (db: SpaceDb) => Promise<T | undefined>): Promise<Located<T> | undefined> {
  for (const candidate of availableSpaceDbs()) {
    const value = await query(candidate.db);
    if (value !== undefined) return { ...candidate, value };
  }
  return undefined;
}

export const findAgentById = (id: string) => firstInSpaces(async (db) =>
  (await db.select().from(schema.agents).where(eq(schema.agents.id, id)))[0]);

export const findAttachmentById = (id: string) => firstInSpaces(async (db) =>
  (await db.select().from(schema.attachments).where(eq(schema.attachments.id, id)))[0]);
