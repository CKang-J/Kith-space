import "../env.js";
import { randomUUID } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { closeAllDatabases, renameWorkspace, schema } from "./index.js";
import { findServerBySlug } from "./lookup.js";
import { createWorkspace } from "./workspace.js";

async function main() {
  const legacy = await findServerBySlug("demo") ?? await findServerBySlug("open-tag");
  if (legacy) {
    await legacy.db.update(schema.servers).set({ slug: "kith-space", name: "Kith-space" })
      .where(or(eq(schema.servers.slug, "demo"), eq(schema.servers.slug, "open-tag")));
    renameWorkspace(legacy.workspace.id, "Kith-space");
    console.log(`[seed] migrated workspace slug ${legacy.value.slug} -> kith-space`);
    return;
  }

  const existing = await findServerBySlug("kith-space");
  if (existing) {
    console.log("[seed] kith-space workspace already exists, nothing to do");
    return;
  }

  const owner = { id: randomUUID(), name: "you", displayName: "You", email: "you@kith-space.local" };
  const server = await createWorkspace("Kith-space", "kith-space", owner.id, { owner });
  const db = (await findServerBySlug("kith-space"))!.db;
  const [all] = await db.select().from(schema.channels).where(and(eq(schema.channels.serverId, server.id), eq(schema.channels.name, "all")));
  console.log("[seed] done:");
  console.log("  server:", server.id, "(slug=kith-space)");
  console.log("  user  :", owner.id, "(you)");
  console.log("  channel #all:", all?.id);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(closeAllDatabases);
