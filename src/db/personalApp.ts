import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  getHomeSpaceRecord,
  getHumanProfile,
  initializeHumanProfile,
  registerHomeSpace,
  type HumanProfile,
  type SpaceRecord,
} from "../app-data/appDatabase.js";
import { defaultSpaceRoot } from "../paths.js";
import { dbForSpace, schema } from "./index.js";

const HOME_SLUG = "home";

function initializedHome(record: SpaceRecord): typeof schema.spaces.$inferSelect {
  const db = dbForSpace(record.id);
  const home = db.select().from(schema.spaces).where(eq(schema.spaces.id, record.id)).get();
  if (!home) throw new Error(`Home Space registry is inconsistent: ${record.id}`);
  return home;
}

/** Initialize the installation-level Human and its idempotent Home Space. */
export async function ensurePersonalApp(input: {
  name: string;
  email?: string | null;
  description?: string | null;
  homeRootPath?: string;
}): Promise<{ human: HumanProfile; home: typeof schema.spaces.$inferSelect }> {
  const human = getHumanProfile() ?? initializeHumanProfile(input);
  const registeredHome = getHomeSpaceRecord();
  if (registeredHome) {
    return { human, home: initializedHome(registeredHome) };
  }

  const home = registerHomeSpace({
    id: randomUUID(),
    name: "Home",
    slug: HOME_SLUG,
    rootPath: input.homeRootPath ?? defaultSpaceRoot("Home"),
  });
  return { human, home: initializedHome(home) };
}
