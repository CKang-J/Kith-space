import "../env.js";
import { and, eq } from "drizzle-orm";
import { closeAllDatabases, dbFor, schema } from "./index.js";
import { ensurePersonalApp } from "./personalApp.js";

async function main() {
  const { human, home } = await ensurePersonalApp({ name: "You" });
  const db = dbFor(home.id);
  const [all] = await db.select().from(schema.channels)
    .where(and(eq(schema.channels.serverId, home.id), eq(schema.channels.name, "all")));
  console.log("[seed] personal app ready:");
  console.log("  human:", human.id, `(${human.name})`);
  console.log("  space:", home.id, "(slug=home, name=Home)");
  console.log("  channel #all:", all?.id);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(closeAllDatabases);
