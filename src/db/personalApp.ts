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
import {
  createDefaultSpaceRoot,
  initializeAttachedSpaceRoot,
  inspectAttachedSpaceRoot,
  SpaceRootError,
} from "../spaces/spaceRootService.js";
import { dbForSpace, schema } from "./index.js";

const HOME_SLUG = "home";

function initializedHome(record: SpaceRecord, allowCreate = false): typeof schema.spaces.$inferSelect {
  const db = dbForSpace(record.id, { allowCreate });
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

  const requestedRoot = input.homeRootPath ?? defaultSpaceRoot("Home");
  let rootPath: string;
  let spaceId: string = randomUUID();
  let allowCreate = false;
  try {
    const attached = inspectAttachedSpaceRoot(requestedRoot);
    rootPath = attached.rootPath;
    if (attached.kind === "existing") {
      spaceId = attached.identity.id;
    } else {
      initializeAttachedSpaceRoot(rootPath);
      allowCreate = true;
    }
  } catch (error) {
    if (!(error instanceof SpaceRootError) || error.code !== "SPACE_ROOT_MISSING") throw error;
    rootPath = createDefaultSpaceRoot(requestedRoot);
    allowCreate = true;
  }

  const home = registerHomeSpace({
    id: spaceId,
    name: "Home",
    slug: HOME_SLUG,
    rootPath,
  });
  return { human, home: initializedHome(home, allowCreate) };
}
