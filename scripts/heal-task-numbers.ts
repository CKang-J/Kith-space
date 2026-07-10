// One-off, idempotent data heal: assign a task number to any "numberless task".
//
// Background: before the invariant guard landed, the task status mutators (claim / unclaim / set-status)
// would promote a plain message straight into a task without minting a number — leaving rows with
// taskStatus set but taskNumber NULL (they render as "#-" and emit "#null" in system messages). This
// script finds those rows and assigns each a number scoped to its channel (per-DM for DMs, per-server
// otherwise), in created_at order, so the heal mirrors how they would have been numbered on creation.
//
// Safe to re-run: only rows with taskStatus != NULL and taskNumber == NULL are touched. Counters are
// reconciled to each workspace DB maximum first, so a freshly-assigned number never collides with an existing one.
//
// Run (reads KITH_SPACE_HOME from the env, like the server):
//   npx tsx scripts/heal-task-numbers.ts
//   ENV_FILE=.env.prod npx tsx scripts/heal-task-numbers.ts   # against a prod env file
import { and, asc, eq, isNull, isNotNull } from "drizzle-orm";
import { allWorkspaceDbs, closeAllDatabases, schema } from "../src/db/index.js";
import { nextTaskNumber, reconcileCounters } from "../src/counters.js";

async function main() {
  // Align in-memory counters to persisted maxima so healed numbers continue each workspace sequence.
  const rec = await reconcileCounters();
  console.log(`[heal] counters reconciled (servers=${rec.servers}, seqFixed=${rec.seqFixed}, taskFixed=${rec.taskFixed})`);

  let total = 0;
  for (const { workspace, db } of allWorkspaceDbs()) {
    const broken = await db.select().from(schema.messages)
      .where(and(isNotNull(schema.messages.taskStatus), isNull(schema.messages.taskNumber)))
      .orderBy(asc(schema.messages.createdAt));
    for (const m of broken) {
      const ch = (await db.select().from(schema.channels).where(eq(schema.channels.id, m.channelId)))[0];
      const num = await nextTaskNumber(workspace.id, ch);
      await db.update(schema.messages).set({ taskNumber: num }).where(eq(schema.messages.id, m.id));
      console.log(`[heal] ${workspace.name}: ${m.id.slice(0, 8)} (${ch?.type ?? "?"} ${m.channelId.slice(0, 8)}) "${m.content.slice(0, 32)}" → #${num}`);
      total++;
    }
  }
  console.log(total ? `[heal] done: assigned ${total} number(s)` : "[heal] no numberless tasks found — nothing to do");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(closeAllDatabases);
