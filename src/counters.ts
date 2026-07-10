import { eq, max } from "drizzle-orm";
import { dbFor, listWorkspaces, schema } from "./db/index.js";

const seqCounters = new Map<string, number>();
const taskCounters = new Map<string, Map<string, number>>();
const aligned = new Set<string>();
const aligning = new Map<string, Promise<{ seqFixed: number; taskFixed: number }>>();

/** Pure task-number scope selection: DMs count independently; all other channel types share the workspace counter. */
export function taskNumberKey(workspaceId: string, channel?: { type: string; id: string } | null): string {
  return channel?.type === "dm" ? `tasknum:dm:${channel.id}` : `tasknum:${workspaceId}`;
}

async function alignWorkspace(workspaceId: string): Promise<{ seqFixed: number; taskFixed: number }> {
  if (aligned.has(workspaceId)) return { seqFixed: 0, taskFixed: 0 };
  const pending = aligning.get(workspaceId);
  if (pending) return pending;
  const run = (async () => {
    const db = dbFor(workspaceId);
    const [seqRow] = await db.select({ m: max(schema.messages.seq) }).from(schema.messages);
    const dbSeq = Number(seqRow?.m ?? 0);
    const currentSeq = seqCounters.get(workspaceId) ?? 0;
    const seqFixed = dbSeq > currentSeq ? 1 : 0;
    seqCounters.set(workspaceId, Math.max(currentSeq, dbSeq));

    const rows = await db
      .select({ channelId: schema.messages.channelId, type: schema.channels.type, m: max(schema.messages.taskNumber) })
      .from(schema.messages)
      .innerJoin(schema.channels, eq(schema.messages.channelId, schema.channels.id))
      .groupBy(schema.messages.channelId, schema.channels.type);
    const counters = taskCounters.get(workspaceId) ?? new Map<string, number>();
    let taskFixed = 0;
    for (const row of rows) {
      const dbMax = Number(row.m ?? 0);
      if (!dbMax) continue;
      const key = taskNumberKey(workspaceId, { type: row.type, id: row.channelId });
      const current = counters.get(key) ?? 0;
      if (dbMax > current) {
        counters.set(key, dbMax);
        taskFixed++;
      }
    }
    taskCounters.set(workspaceId, counters);
    aligned.add(workspaceId);
    return { seqFixed, taskFixed };
  })().finally(() => aligning.delete(workspaceId));
  aligning.set(workspaceId, run);
  return run;
}

/** Align in-memory counters to persisted maxima before traffic is accepted. Safe to call repeatedly. */
export async function reconcileCounters(): Promise<{ servers: number; seqFixed: number; taskFixed: number }> {
  const workspaces = listWorkspaces();
  let seqFixed = 0;
  let taskFixed = 0;
  for (const workspace of workspaces) {
    const result = await alignWorkspace(workspace.id);
    seqFixed += result.seqFixed;
    taskFixed += result.taskFixed;
  }
  return { servers: workspaces.length, seqFixed, taskFixed };
}

/** Monotonic sequence number within one workspace database. */
export async function nextSeq(workspaceId: string): Promise<number> {
  await alignWorkspace(workspaceId);
  const next = (seqCounters.get(workspaceId) ?? 0) + 1;
  seqCounters.set(workspaceId, next);
  return next;
}

/** Monotonic task number, scoped per DM or per workspace. */
export async function nextTaskNumber(workspaceId: string, channel?: { type: string; id: string } | null): Promise<number> {
  await alignWorkspace(workspaceId);
  const counters = taskCounters.get(workspaceId) ?? new Map<string, number>();
  const key = taskNumberKey(workspaceId, channel);
  const next = (counters.get(key) ?? 0) + 1;
  counters.set(key, next);
  taskCounters.set(workspaceId, counters);
  return next;
}

export function forgetWorkspaceCounters(workspaceId: string): void {
  aligned.delete(workspaceId);
  aligning.delete(workspaceId);
  seqCounters.delete(workspaceId);
  taskCounters.delete(workspaceId);
}
