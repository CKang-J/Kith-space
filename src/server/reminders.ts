// Reminder scheduler (reminders are author-owned, persistent, observable, re-schedulable wake signals).
// A tick scans due reminders → posts a system reminder in the anchor channel (@author → @mention wakes the author agent) → marks one-shot done / reschedules recurring.
import { and, eq, lte } from "drizzle-orm";
import { allSpaceDbs, dbForSpace, schema } from "../db/index.js";
import { createMessage } from "./core.js";
import { createLogger } from "../log.js";
import { humanIdentityForId } from "../human/humanIdentity.js";

const log = createLogger("server:reminders");
const TICK_MS = Number(process.env.KITH_SPACE_REMINDER_TICK_MS ?? 20_000);

export function startReminderScheduler(): void {
  let ticking = false; // reentry guard: skip this tick if the previous one is still running (avoids overlapping ticks reprocessing in a single process)
  setInterval(() => {
    if (ticking) return;
    ticking = true;
    tick().catch((e) => log.error("reminder tick error", { detail: String(e?.message ?? e) })).finally(() => { ticking = false; });
  }, TICK_MS);
  log.info("reminder scheduler started", { tickMs: TICK_MS });
}

async function tick(): Promise<void> {
  for (const { db } of allSpaceDbs()) {
    const due = await db.select().from(schema.reminders).where(and(eq(schema.reminders.status, "scheduled"), lte(schema.reminders.remindAt, new Date())));
    for (const r of due) await fire(r).catch((e) => log.warn("fire failed", { id: r.id, detail: String(e?.message ?? e) }));
  }
}

async function fire(r: typeof schema.reminders.$inferSelect): Promise<void> {
  const db = dbForSpace(r.spaceId);
  const now = new Date();
  const sec = r.recurrence ? Number(r.recurrence) : 0;
  // Atomic claim: grab reminders that are "due and still scheduled" in one shot (recurring → push to next, stays scheduled; one-shot → mark fired).
  // Losing the claim (0 rows) = another tick/instance already handled it → exit, preventing duplicate reminders + duplicate author wakes.
  const claim = sec > 0
    ? { remindAt: new Date(now.getTime() + sec * 1000), firedAt: now }
    : { status: "fired" as const, firedAt: now };
  const won = await db.update(schema.reminders).set(claim)
    .where(and(eq(schema.reminders.id, r.id), eq(schema.reminders.status, "scheduled"), lte(schema.reminders.remindAt, now)))
    .returning();
  if (!won.length) return; // already claimed by another tick/instance
  const ownerName = r.ownerType === "agent"
    ? (await db.select().from(schema.agents).where(eq(schema.agents.id, r.ownerId)))[0]?.name
    : humanIdentityForId(r.ownerId)?.handle;
  // Anchor channel: the anchor message's channel > reminder.channelId > #all
  let channelId = r.channelId ?? null;
  if (r.anchorMessageId) {
    const anchor = (await db.select().from(schema.messages).where(eq(schema.messages.id, r.anchorMessageId)))[0];
    if (anchor) channelId = anchor.channelId;
  }
  if (!channelId) {
    const all = (await db.select().from(schema.channels).where(and(eq(schema.channels.spaceId, r.spaceId), eq(schema.channels.name, "all"))))[0];
    channelId = all?.id ?? null;
  }
  if (!channelId) return; // already atomically claimed above; if there's nowhere to deliver, just end (don't re-update status)
  // system reminder, @author (@mention wakes the author agent; if the author is human it's just a visible reminder)
  const mention = ownerName ? `@${ownerName} ` : "";
  await createMessage({ spaceId: r.spaceId, channelId, senderType: "system", senderId: null, senderName: "reminder", content: `⏰ ${mention}reminder: ${r.content}` });
  log.info("reminder fired", { id: r.id, owner: ownerName, recurring: sec > 0 });
  // the status transition (fired / reschedule) was done in the atomic claim above; no repeat update here
}
