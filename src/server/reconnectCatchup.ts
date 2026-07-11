// Reconnect catch-up: when the installation-local runtime worker (re)connects, wake agents that accumulated a
// "wakeable" backlog while the worker was offline, so they process the messages they missed. This is the
// symmetric counterpart to the human side — the browser's socket reconnect path (store.tsx) re-syncs missed
// messages, but agents had no equivalent, so an @ sent while the worker was offline sat unread forever.
//
// "Backfilling" missed messages is NOT message replay: a woken agent's STARTUP_NUDGE / RESUME_NUDGE
// (daemon/prompt.ts) drives it to run `kith-space message check`, which pulls every unread (seq > lastReadSeq)
// including the ones missed while offline. So catch-up only needs to wake the right agents — the agent
// pulls the rest itself.
//
// The wake criterion is the conservative mirror of createMessage's wake branch (core.ts, "Agent-side wake"):
// DM/@ wake unconditionally; ambient (non-@) wakes only with the inbox:receive scope. The two stay in sync
// through agentWakePolicy — see docs/superpowers/specs/2026-06-25-agent-reachability-design.md §5.4.
import { and, eq, gt, ne, or, isNull, desc } from "drizzle-orm";
import { dbForSpace, listSpaces, schema } from "../db/index.js";
import { agentHasScope } from "./scopes.js";
import {
  isWorkerLeaseCurrent,
  sendToWorkerForLease,
  workerRuntimes,
  type WorkerLease,
} from "../local-runtime/workerHub.js";
import { agentConfig, reportDispatchRejection } from "./core.js";
import { createLogger } from "../log.js";
import { isWakeable } from "./agentWakePolicy.js";
import { SqliteDispatchState, type DispatchMessageContext } from "./dispatchGuard.js";

export { isWakeable } from "./agentWakePolicy.js";

const log = createLogger("server:catchup");
// Single-worker anti-thrash: a flapping link must not re-scan + re-wake on every blip.
// lastReadSeq advancing after the agent checks is the
// real idempotency guard (a checked agent has no backlog next time); this just caps the scan rate.
const COOLDOWN_MS = Number(process.env.KITH_SPACE_CATCHUP_COOLDOWN_MS ?? 30_000);
let lastRun: { at: number; generation: number } | null = null;

interface Backlog {
  count: number;
  from: string;
  targetName: string;
  messageId: string;
  channelId: string;
  contextChannelId: string;
  dispatch: DispatchMessageContext;
}

/** Does this agent have a wakeable backlog (unread messages that would have woken it)? Returns a small
 *  summary used to build the soft-offline inbox notice, or null when there is nothing wakeable. */
async function computeBacklog(spaceId: string, agentId: string, scopes: Parameters<typeof agentHasScope>[0]): Promise<Backlog | null> {
  const db = dbForSpace(spaceId);
  const hasInbox = agentHasScope(scopes, "inbox:receive");
  const memberships = await db.select({
    channelId: schema.channelAgentMembers.channelId,
    lastReadSeq: schema.channelAgentMembers.lastReadSeq,
    type: schema.channels.type,
    name: schema.channels.name,
    parentMessageId: schema.channels.parentMessageId,
  }).from(schema.channelAgentMembers)
    .innerJoin(schema.channels, eq(schema.channels.id, schema.channelAgentMembers.channelId))
    .where(eq(schema.channelAgentMembers.agentId, agentId));

  let count = 0;
  let latest: (Backlog & { seq: number }) | null = null;
  // Exclude the agent's own messages; keep system (senderId null) — matches createMessage's `mem.id === senderId` skip.
  const notSelf = or(isNull(schema.messages.senderId), ne(schema.messages.senderId, agentId));

  for (const m of memberships) {
    const unread = and(eq(schema.messages.channelId, m.channelId), gt(schema.messages.seq, m.lastReadSeq), notSelf);
    const rowsBySeq = new Map<number, {
      id: string;
      seq: number;
      from: string;
      dispatchChainId: string | null;
      dispatchDepth: number | null;
      threadId: string | null;
      taskStatus: string | null;
    }>();
    if (m.type === "dm") {
      const rows = await db.select({ id: schema.messages.id, seq: schema.messages.seq, from: schema.messages.senderName, dispatchChainId: schema.messages.dispatchChainId, dispatchDepth: schema.messages.dispatchDepth, threadId: schema.messages.threadId, taskStatus: schema.messages.taskStatus })
        .from(schema.messages).where(and(unread, ne(schema.messages.messageType, "system"))).orderBy(desc(schema.messages.seq));
      for (const row of rows) rowsBySeq.set(row.seq, row);
    } else {
      const mentionedRows = await db.select({ id: schema.messages.id, seq: schema.messages.seq, from: schema.messages.senderName, dispatchChainId: schema.messages.dispatchChainId, dispatchDepth: schema.messages.dispatchDepth, threadId: schema.messages.threadId, taskStatus: schema.messages.taskStatus })
        .from(schema.messages)
        .innerJoin(schema.messageMentions, eq(schema.messageMentions.messageId, schema.messages.id))
        .where(and(unread, eq(schema.messageMentions.mentionType, "agent"), eq(schema.messageMentions.mentionId, agentId)))
        .orderBy(desc(schema.messages.seq));
      for (const row of mentionedRows) rowsBySeq.set(row.seq, row);
      if (isWakeable({ channelType: m.type, mentioned: false, hasInboxScope: hasInbox, senderType: "human" })) {
        const ambientRows = await db.select({ id: schema.messages.id, seq: schema.messages.seq, from: schema.messages.senderName, dispatchChainId: schema.messages.dispatchChainId, dispatchDepth: schema.messages.dispatchDepth, threadId: schema.messages.threadId, taskStatus: schema.messages.taskStatus })
          .from(schema.messages)
          .where(and(unread, ne(schema.messages.senderType, "agent"), ne(schema.messages.messageType, "system")))
          .orderBy(desc(schema.messages.seq));
        for (const row of ambientRows) rowsBySeq.set(row.seq, row);
      }
    }
    const rows = [...rowsBySeq.values()].sort((a, b) => b.seq - a.seq);
    if (rows.length) {
      count += rows.length;
      const top = rows[0]!; // highest seq in this channel
      if (!latest || top.seq > latest.seq) {
        let taskMessageId = top.taskStatus ? top.id : null;
        if (!taskMessageId && m.type === "thread" && m.parentMessageId) {
          const parent = db.select({ taskStatus: schema.messages.taskStatus }).from(schema.messages).where(eq(schema.messages.id, m.parentMessageId)).get();
          if (parent?.taskStatus) taskMessageId = m.parentMessageId;
        }
        latest = {
          seq: top.seq,
          count: 0,
          from: top.from,
          targetName: m.type === "dm" ? `dm:@${top.from}` : `#${m.name ?? ""}`,
          messageId: top.id,
          channelId: m.channelId,
          contextChannelId: top.threadId ?? m.channelId,
          dispatch: {
            chainId: top.dispatchChainId ?? top.id,
            dispatchDepth: top.dispatchDepth ?? 0,
            taskMessageId,
          },
        };
      }
    }
  }
  return latest ? { ...latest, count } : null;
}

/** Wake every local agent with a wakeable backlog across all registered Spaces. Called from ws.ts after
 *  worker-ready reconciliation, so `runningIds` is the worker's current process snapshot.
 *  Best-effort: any failure is logged and never propagates — onReady's health takes priority. */
export async function catchUpAgentsOnWorker(runningIds: string[], lease: WorkerLease): Promise<void> {
  if (!isWorkerLeaseCurrent(lease)) return;
  const now = Date.now();
  if (lastRun?.generation === lease.generation && now - lastRun.at < COOLDOWN_MS) {
    log.debug("catch-up skipped (cooldown)");
    return;
  }
  lastRun = { at: now, generation: lease.generation };
  const availableRuntimes = new Set(workerRuntimes());
  const spaces = listSpaces();

  let woke = 0;
  let scanned = 0;
  for (const space of spaces) {
    if (!isWorkerLeaseCurrent(lease)) return;
    const spaceId = space.id;
    const db = dbForSpace(spaceId);
    const list = await db.select({ id: schema.agents.id, name: schema.agents.name, runtime: schema.agents.runtime, scopes: schema.agents.scopes })
      .from(schema.agents)
      .where(and(eq(schema.agents.spaceId, spaceId), isNull(schema.agents.deletedAt)));
    if (!isWorkerLeaseCurrent(lease)) return;
    scanned += list.length;
    for (const a of list) {
      if (!isWorkerLeaseCurrent(lease)) return;
      let backlog: Backlog | null = null;
      try { backlog = await computeBacklog(spaceId, a.id, a.scopes); }
      catch (e: any) { log.warn("backlog scan failed", { agentId: a.id, detail: String(e?.message ?? e) }); continue; }
      if (!isWorkerLeaseCurrent(lease)) return;
      if (!backlog) continue;
      if (!availableRuntimes.has(a.runtime)) {
        log.warn("catch-up skipped unsupported runtime", { agentId: a.id, spaceId: spaceId, runtime: a.runtime });
        continue;
      }
      const state = new SqliteDispatchState(spaceId);
      await state.ensureChain({ ...backlog.dispatch, rootMessageId: backlog.messageId, channelId: backlog.channelId });
      if (!isWorkerLeaseCurrent(lease)) return;
      const reservation = await state.reserveWake({
        ...backlog.dispatch,
        messageId: backlog.messageId,
        targetAgentId: a.id,
      });
      if (!isWorkerLeaseCurrent(lease)) {
        if (reservation.allowed) await state.releaseWake(reservation.reservationId);
        return;
      }
      if (!reservation.allowed) {
        await reportDispatchRejection({
          state,
          dispatch: backlog.dispatch,
          messageId: backlog.messageId,
          targetAgentId: a.id,
          targetAgentName: a.name,
          fallbackChannelId: backlog.channelId,
          rejection: reservation,
        });
        if (!isWorkerLeaseCurrent(lease)) return;
        continue;
      }
      let sent = false;
      if (!runningIds.includes(a.id)) {
        // Hard offline: start with resume; the startup nudge pulls missed messages from the inbox.
        const cfg = await agentConfig(spaceId, a.id);
        if (!isWorkerLeaseCurrent(lease)) {
          await state.releaseWake(reservation.reservationId);
          return;
        }
        sent = !!cfg && sendToWorkerForLease(lease, { type: "agent:start", agentId: a.id, config: cfg });
      } else {
        // Soft offline: the process survived, so inject a body-free notice that drives `message check`.
        sent = sendToWorkerForLease(lease, {
          type: "agent:deliver", agentId: a.id, seq: 0, from: backlog.from,
          target: "", targetName: backlog.targetName, msgShort: "", isTask: false, mentioned: false,
        });
      }
      if (sent) {
        await state.commitWake(reservation.reservationId, {
          agentId: a.id,
          channelId: backlog.contextChannelId,
          chainId: backlog.dispatch.chainId,
          dispatchDepth: backlog.dispatch.dispatchDepth,
        });
        if (!isWorkerLeaseCurrent(lease)) return;
        woke++;
      } else {
        await state.releaseWake(reservation.reservationId);
        if (!isWorkerLeaseCurrent(lease)) return;
      }
    }
  }
  if (woke) log.info("reconnect catch-up woke agents with backlog", { woke, scanned, spaces: spaces.length });
}
