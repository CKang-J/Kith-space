import { eq } from "drizzle-orm";
import {
  getHumanProfile,
  getSpaceRecordBySlug,
  initializeHumanProfile,
  type HumanProfile,
} from "../app-data/appDatabase.js";
import { defaultWorkspaceRoot } from "../paths.js";
import { dbFor, schema } from "./index.js";
import { createWorkspace } from "./workspace.js";

const HOME_SLUG = "home";

/** Temporary workspace.db projection; remove with Human membership in A2.3. */
export function legacyHumanRow(human: HumanProfile): typeof schema.users.$inferInsert {
  return {
    id: human.id,
    name: "you",
    displayName: human.name,
    email: human.email ?? `${human.id}@human.kith-space.invalid`,
    description: human.description,
  };
}

/**
 * Transitional A2 bootstrap: app.db is the canonical Human/Space registry, while
 * workspace.db still receives one compatibility user/owner row until A2.3 removes
 * the inherited multi-human schema.
 */
export async function ensurePersonalApp(input: {
  name: string;
  email?: string | null;
  description?: string | null;
  homeRootPath?: string;
}): Promise<{ human: HumanProfile; home: typeof schema.servers.$inferSelect }> {
  const human = getHumanProfile() ?? initializeHumanProfile(input);
  const registeredHome = getSpaceRecordBySlug(HOME_SLUG);
  if (registeredHome) {
    const db = dbFor(registeredHome.id);
    const home = (await db.select().from(schema.servers).where(eq(schema.servers.id, registeredHome.id)))[0];
    if (!home) throw new Error(`Home Space registry is inconsistent: ${registeredHome.id}`);
    if (home.ownerId !== human.id) throw new Error(`Home Space owner is inconsistent: ${registeredHome.id}`);
    return { human, home };
  }

  const home = await createWorkspace("Home", HOME_SLUG, human.id, {
    rootPath: input.homeRootPath ?? defaultWorkspaceRoot(HOME_SLUG),
    owner: legacyHumanRow(human),
  });
  return { human, home };
}
