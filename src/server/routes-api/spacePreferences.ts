import { eq } from "drizzle-orm";
import { dbForSpace, schema } from "../../db/index.js";
import { readJson, sendJson } from "../util.js";
import type { SpaceCtx } from "./ctx.js";

const DEFAULTS = {
  channelOrder: [] as string[], agentOrder: [] as string[], dmOrder: [] as string[],
  channelSortMode: "manual", jointChannelSortMode: "manual", dmSortMode: "manual", pinnedSortMode: "manual",
  pinnedChannelIds: [] as string[], pinnedAgentIds: [] as string[], pinnedOrder: [] as string[],
  hiddenDmIds: [] as string[], channelPanelTabOrder: [] as string[], agentPanelTabOrder: [] as string[],
};

export async function handleSpacePreferences(ctx: SpaceCtx): Promise<boolean> {
  const match = /^\/api\/spaces\/([^/]+)\/sidebar-order$/.exec(ctx.p);
  if (!match || !["GET", "PUT", "PATCH"].includes(ctx.method)) return false;

  const db = dbForSpace(ctx.spaceId);
  const row = db.select().from(schema.humanSpacePreferences)
    .where(eq(schema.humanSpacePreferences.spaceId, ctx.spaceId)).get();
  if (ctx.method === "GET") {
    return (sendJson(ctx.res, 200, { ...DEFAULTS, ...(row?.prefs as object ?? {}) }), true);
  }

  const body = await readJson(ctx.req).catch(() => ({}));
  const prefs = { ...DEFAULTS, ...(row?.prefs as object ?? {}), ...(body && typeof body === "object" ? body : {}) };
  db.insert(schema.humanSpacePreferences).values({ spaceId: ctx.spaceId, prefs })
    .onConflictDoUpdate({
      target: schema.humanSpacePreferences.spaceId,
      set: { prefs, updatedAt: new Date() },
    }).run();
  return (sendJson(ctx.res, 200, prefs), true);
}
