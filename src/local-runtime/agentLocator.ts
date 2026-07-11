import { eq } from "drizzle-orm";
import { allSpaceDbs, schema, type SpaceDb } from "../db/index.js";

export interface LocatedAgent {
  spaceId: string;
  db: SpaceDb;
  agent: typeof schema.agents.$inferSelect;
}

/** Agent ids are installation-unique UUIDs; scan the local Space registry to find their owning DB. */
export async function locateAgent(agentId: string): Promise<LocatedAgent | null> {
  for (const { space, db } of allSpaceDbs()) {
    const agent = (await db.select().from(schema.agents)
      .where(eq(schema.agents.id, agentId)))[0];
    if (agent && agent.deletedAt === null) return { spaceId: space.id, db, agent };
  }
  return null;
}
