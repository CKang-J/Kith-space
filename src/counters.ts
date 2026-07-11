import { eq, max, sql } from "drizzle-orm";
import { dbForSpace, listSpaces, schema, type SpaceDb } from "./db/index.js";

const seqCounters = new Map<string, number>();
const aligned = new Set<string>();
const aligning = new Map<string, Promise<{ seqFixed: number; taskFixed: number }>>();

export type SpaceTransaction = Parameters<Parameters<SpaceDb["transaction"]>[0]>[0];

/** Pure task-number scope selection: DMs count independently; all other channel types share the Space counter. */
export function taskNumberKey(spaceId: string, channel?: { type: string; id: string } | null): string {
  return channel?.type === "dm" ? `tasknum:dm:${channel.id}` : `tasknum:${spaceId}`;
}

async function alignSpace(spaceId: string): Promise<{ seqFixed: number; taskFixed: number }> {
  if (aligned.has(spaceId)) return { seqFixed: 0, taskFixed: 0 };
  const pending = aligning.get(spaceId);
  if (pending) return pending;
  const run = (async () => {
    const db = dbForSpace(spaceId);
    const [seqRow] = await db.select({ m: max(schema.messages.seq) }).from(schema.messages);
    const dbSeq = Number(seqRow?.m ?? 0);
    const currentSeq = seqCounters.get(spaceId) ?? 0;
    const seqFixed = dbSeq > currentSeq ? 1 : 0;
    seqCounters.set(spaceId, Math.max(currentSeq, dbSeq));

    const rows = await db
      .select({ channelId: schema.messages.channelId, type: schema.channels.type, m: max(schema.messages.taskNumber) })
      .from(schema.messages)
      .innerJoin(schema.channels, eq(schema.messages.channelId, schema.channels.id))
      .groupBy(schema.messages.channelId, schema.channels.type);
    let taskFixed = 0;
    const maxima = new Map<string, number>();
    for (const row of rows) {
      const dbMax = Number(row.m ?? 0);
      if (!dbMax) continue;
      const key = taskNumberKey(spaceId, { type: row.type, id: row.channelId });
      maxima.set(key, Math.max(maxima.get(key) ?? 0, dbMax));
    }
    for (const [scopeKey, dbMax] of maxima) {
      const current = db.select().from(schema.taskNumberCounters).where(eq(schema.taskNumberCounters.scopeKey, scopeKey)).get();
      if (!current || current.lastNumber < dbMax) taskFixed++;
      db.insert(schema.taskNumberCounters).values({ scopeKey, lastNumber: dbMax }).onConflictDoUpdate({
        target: schema.taskNumberCounters.scopeKey,
        set: { lastNumber: sql`max(${schema.taskNumberCounters.lastNumber}, ${dbMax})` },
      }).run();
    }
    aligned.add(spaceId);
    return { seqFixed, taskFixed };
  })().finally(() => aligning.delete(spaceId));
  aligning.set(spaceId, run);
  return run;
}

/** Align in-memory counters to persisted maxima before traffic is accepted. Safe to call repeatedly. */
export async function reconcileCounters(): Promise<{ spaces: number; seqFixed: number; taskFixed: number }> {
  const spaces = listSpaces();
  let seqFixed = 0;
  let taskFixed = 0;
  for (const space of spaces) {
    const result = await alignSpace(space.id);
    seqFixed += result.seqFixed;
    taskFixed += result.taskFixed;
  }
  return { spaces: spaces.length, seqFixed, taskFixed };
}

/** Monotonic sequence number within one Space database. */
export async function nextSeq(spaceId: string): Promise<number> {
  await alignSpace(spaceId);
  const next = (seqCounters.get(spaceId) ?? 0) + 1;
  seqCounters.set(spaceId, next);
  return next;
}

/** Monotonic task number, scoped per DM or per Space. */
export async function nextTaskNumber(spaceId: string, channel?: { type: string; id: string } | null): Promise<number> {
  await alignSpace(spaceId);
  let next = 0;
  dbForSpace(spaceId).transaction((tx) => { next = allocateTaskNumber(tx, taskNumberKey(spaceId, channel)); });
  return next;
}

/** Reserve a task number inside the caller's transaction so counter + task message commit together. */
export function allocateTaskNumber(tx: SpaceTransaction, scopeKey: string): number {
  const row = tx.insert(schema.taskNumberCounters).values({ scopeKey, lastNumber: 1 }).onConflictDoUpdate({
    target: schema.taskNumberCounters.scopeKey,
    set: { lastNumber: sql`${schema.taskNumberCounters.lastNumber} + 1` },
  }).returning({ value: schema.taskNumberCounters.lastNumber }).get();
  return row.value;
}

export function forgetSpaceCounters(spaceId: string): void {
  aligned.delete(spaceId);
  aligning.delete(spaceId);
  seqCounters.delete(spaceId);
}
