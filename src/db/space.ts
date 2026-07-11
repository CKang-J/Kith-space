import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { defaultSpaceRoot } from "../paths.js";
import { dbForSpace, registerSpace, schema, unregisterSpace } from "./index.js";

export async function createSpace(
  name: string,
  slug: string,
  options: { rootPath?: string } = {},
) {
  const spaceId = randomUUID();
  const rootPath = options.rootPath ?? defaultSpaceRoot(slug);
  registerSpace({ id: spaceId, name, slug, rootPath });
  try {
    const db = dbForSpace(spaceId);
    const space = db.select().from(schema.spaces).where(eq(schema.spaces.id, spaceId)).get();
    if (!space) throw new Error(`Space baseline was not initialized: ${spaceId}`);
    return space;
  } catch (error) {
    unregisterSpace(spaceId);
    throw error;
  }
}
