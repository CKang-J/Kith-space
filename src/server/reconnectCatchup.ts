// Reconnect catch-up: when a machine's daemon (re)connects, wake the agents on it that accumulated a
// "wakeable" backlog while the machine was offline, so they process the messages they missed. This is the
// symmetric counterpart to the human side — the browser's socket reconnect path (store.tsx) re-syncs missed
// messages, but agents had no equivalent, so an @ sent to an offline agent's machine sat unread forever.
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
import { dbFor, schema } from "../db/index.js";
import { agentHasScope } from "./scopes.js";
import { sendToMachine } from "./daemonHub.js";
import { agentConfig, reportDispatchRejection } from "./core.js";
import { createLogger } from "../log.js";
import { isWakeable } from "./agentWakePolicy.js";
import { SqliteDispatchState, type DispatchMessageContext } from "./dispatchGuard.js";

export { isWakeable } from "./agentWakePolicy.js";

const log = createLogger("server:catchup");
// Per-machine anti-thrash: a flapping link (connect/drop/connect) must not re-scan + re-wake on every blip.
// Single-instance, like daemonHub's in-memory registry. lastReadSeq advancing after the agent checks is the
// real idempotency guard (a checked agent has no backlog next time); this just caps the scan rate.
const COOLDOWN_MS = Number(process.env.KITH_SPACE_CATCHUP_COOLDOWN_MS ?? 30_000);
const lastRun = new Map<string, number>(); // machineId → last catch-up start ts

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
async function computeBacklog(serverId: string, agentId: string, scopes: Parameters<typeof agentHasScope>[0]): Promise<Backlog | null> {
  const db = dbFor(serverId);
  const hasInbox = agentHasScope(scopes, "inbox:receive");
  const memberships = await db.select({
    channelId: schema.channelMembers.channelId,
    lastReadSeq: schema.channelMembers.lastReadSeq,
    type: schema.channels.type,
    name: schema.channels.name,
    parentMessageId: schema.channels.parentMessageId,
  }).from(schema.channelMembers)
    .innerJoin(schema.channels, eq(schema.channels.id, schema.channelMembers.channelId))
    .where(and(eq(schema.channelMembers.memberType, "agent"), eq(schema.channelMembers.memberId, agentId)));

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
      if (isWakeable({ channelType: m.type, mentioned: false, hasInboxScope: hasInbox, senderType: "user" })) {
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

/** Wake every agent on this machine that has a wakeable backlog. Called from ws.ts onReady AFTER the
 *  stale-agent reconciliation, so `runningIds` (the agents the daemon reports actually running) is current.
 *  Best-effort: any failure is logged and never propagates — onReady's health takes priority. */
export async function catchUpAgentsOnMachine(serverId: string, machineId: string, runningIds: string[]): Promise<void> {
  const now = Date.now();
  if (now - (lastRun.get(machineId) ?? 0) < COOLDOWN_MS) { log.debug("catch-up skipped (cooldown)", { machineId }); return; }
  lastRun.set(machineId, now);
  const db = dbFor(serverId);

  const machine = (await db.select({ runtimes: schema.machines.runtimes }).from(schema.machines).where(and(
    eq(schema.machines.id, machineId),
    eq(schema.machines.serverId, serverId),
  )))[0];
  const availableRuntimes = new Set(machine?.runtimes ?? []);

  const list = await db.select({ id: schema.agents.id, name: schema.agents.name, runtime: schema.agents.runtime, scopes: schema.agents.scopes })
    .from(schema.agents)
    .where(and(eq(schema.agents.machineId, machineId), eq(schema.agents.serverId, serverId), isNull(schema.agents.deletedAt)));

  let woke = 0;
  for (const a of list) {
    let backlog: Backlog | null = null;
    try { backlog = await computeBacklog(serverId, a.id, a.scopes); }
    catch (e: any) { log.warn("backlog scan failed", { agentId: a.id, detail: String(e?.message ?? e) }); continue; }
    if (!backlog) continue;
    if (!availableRuntimes.has(a.runtime)) {
      log.warn("catch-up skipped unsupported runtime", { agentId: a.id, machineId, runtime: a.runtime });
      continue;
    }
    const state = new SqliteDispatchState(serverId);
    await state.ensureChain({ ...backlog.dispatch, rootMessageId: backlog.messageId, channelId: backlog.channelId });
    const reservation = await state.reserveWake({
      ...backlog.dispatch,
      messageId: backlog.messageId,
      targetAgentId: a.id,
    });
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
      continue;
    }
    let sent = false;
    if (!runningIds.includes(a.id)) {
      // hard offline (process dead): start with resume; the startup nudge self-checks the inbox and pulls the missed messages
      const cfg = await agentConfig(serverId, a.id);
      sent = !!cfg && sendToMachine(machineId, { type: "agent:start", agentId: a.id, config: cfg });
    } else {
      // soft offline (WS dropped, process alive): agent:start is a no-op for a running agent (agentManager.ts),
      // so inject an inbox notice via deliver to drive a `message check`. Body-free: the agent pulls real unread.
      sent = sendToMachine(machineId, {
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
      woke++;
    } else {
      await state.releaseWake(reservation.reservationId);
    }
  }
  if (woke) log.info("reconnect catch-up woke agents with backlog", { machineId, woke, scanned: list.length });
}
