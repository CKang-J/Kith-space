import { randomUUID } from "node:crypto";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { getHumanProfile, initializeHumanProfile, type HumanProfile } from "../../src/app-data/appDatabase.ts";
import { dbForSpace, registerSpace, schema, type SpaceDb } from "../../src/db/index.ts";
import { kithSpaceHome } from "../../src/paths.ts";

export interface IntegrationDatabase {
  db: SpaceDb;
  spaceId: string;
  rootPath: string;
  schema: typeof schema;
  human: HumanProfile;
  all: typeof schema.channels.$inferSelect;
}

/** Register one isolated Space DB for a standalone integration-test process. */
export function integrationDatabase(name: string): IntegrationDatabase {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "test-spaces", spaceId);
  registerSpace({ id: spaceId, name, slug: `${name}-${spaceId.slice(0, 8)}`, rootPath });
  const db = dbForSpace(spaceId);
  const all = db.select().from(schema.channels).where(and(
    eq(schema.channels.spaceId, spaceId),
    eq(schema.channels.name, "all"),
  )).get();
  if (!all) throw new Error(`Space baseline did not create #all: ${spaceId}`);
  const human = getHumanProfile() ?? initializeHumanProfile({ name: "Test Human" });
  return { db, spaceId, rootPath, schema, human, all };
}
