import { eq } from "drizzle-orm";
import {
  getHumanProfile,
  getSpaceRecordBySlug,
  initializeHumanProfile,
  type HumanProfile,
} from "../app-data/appDatabase.js";
import { defaultSpaceRoot } from "../paths.js";
import { dbForSpace, schema } from "./index.js";
import { createSpace } from "./space.js";

const HOME_SLUG = "home";

/** Initialize the installation-level Human and its idempotent Home Space. */
export async function ensurePersonalApp(input: {
  name: string;
  email?: string | null;
  description?: string | null;
  homeRootPath?: string;
}): Promise<{ human: HumanProfile; home: typeof schema.spaces.$inferSelect }> {
  const human = getHumanProfile() ?? initializeHumanProfile(input);
  const registeredHome = getSpaceRecordBySlug(HOME_SLUG);
  if (registeredHome) {
    const db = dbForSpace(registeredHome.id);
    const home = db.select().from(schema.spaces).where(eq(schema.spaces.id, registeredHome.id)).get();
    if (!home) throw new Error(`Home Space registry is inconsistent: ${registeredHome.id}`);
    return { human, home };
  }

  const home = await createSpace("Home", HOME_SLUG, {
    rootPath: input.homeRootPath ?? defaultSpaceRoot(HOME_SLUG),
  });
  return { human, home };
}
