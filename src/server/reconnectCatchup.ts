// Reconnect catch-up wakes agents only for unread messages that the same response policy would wake in real
// time. The runtime then pulls the exact inbox batch; this module never replays message bodies.
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { decideAgentMessageResponse, type AgentResponseDeliveryDecision } from "../agents/agentResponseDelivery.js";
import { resolveAgentResponseMode } from "../agents/agentResponseSettings.js";
import { channelLifecycleState } from "../channels/channelLifecycle.js";
import { dbForSpace, listSpaces, schema } from "../db/index.js";
import { createLogger } from "../log.js";
import {
  isWorkerLeaseCurrent,
  sendToWorkerForLease,
  workerRuntimes,
  type WorkerLease,
} from "../local-runtime/workerHub.js";
import { setAgentIntroductionTurn } from "./agentIntroduction.js";
import { agentConfig, reportDispatchRejection } from "./core.js";
import { SqliteDispatchState, type DispatchMessageContext } from "./dispatchGuard.js";
import { agentHasScope } from "./scopes.js";

const log = createLogger("server:catchup");
// lastReadSeq is the durable idempotency boundary; this short cooldown only prevents reconnect flapping from
// repeatedly scanning the same databases before an agent has had time to check its inbox.
const COOLDOWN_MS = Number(process.env.KITH_SPACE_CATCHUP_COOLDOWN_MS ?? 30_000);
let lastRun: { at: number; generation: number } | null = null;

export interface AgentResponseBacklog {
  count: number;
  from: string;
  targetName: string;
  messageId: string;
  channelId: string;
  contextChannelId: string;
  dispatch: DispatchMessageContext;
  responseDirective: Exclude<AgentResponseDeliveryDecision["directive"], "observe">;
  responseReason: AgentResponseDeliveryDecision["reason"];
}

/** Return a compact wake summary while leaving every unread message for `/agent-api/message/check`. */
export async function computeBacklog(
  spaceId: string,
  agentId: string,
  scopes: Parameters<typeof agentHasScope>[0],
): Promise<AgentResponseBacklog | null> {
  const db = dbForSpace(spaceId);
  const hasInbox = agentHasScope(scopes, "inbox:receive");
  const memberships = await db.select({
    channelId: schema.channelAgentMembers.channelId,
    lastReadSeq: schema.channelAgentMembers.lastReadSeq,
    ambientWakeAfterSeq: schema.channelAgentMembers.ambientWakeAfterSeq,
    mentionWakeAfterSeq: schema.channelAgentMembers.mentionWakeAfterSeq,
    type: schema.channels.type,
    name: schema.channels.name,
    parentMessageId: schema.channels.parentMessageId,
  }).from(schema.channelAgentMembers)
    .innerJoin(schema.channels, eq(schema.channels.id, schema.channelAgentMembers.channelId))
    .where(eq(schema.channelAgentMembers.agentId, agentId));

  let count = 0;
  let latest: (AgentResponseBacklog & { seq: number }) | null = null;
  let strongestDirective: AgentResponseBacklog["responseDirective"] = "optional";

  for (const membership of memberships) {
    if (await channelLifecycleState(spaceId, membership.channelId) !== "active") continue;
    const rows = (await db.select({
      id: schema.messages.id,
      seq: schema.messages.seq,
      from: schema.messages.senderName,
      senderType: schema.messages.senderType,
      senderId: schema.messages.senderId,
      dispatchChainId: schema.messages.dispatchChainId,
      dispatchDepth: schema.messages.dispatchDepth,
      threadId: schema.messages.threadId,
      taskStatus: schema.messages.taskStatus,
      taskAssigneeId: schema.messages.taskAssigneeId,
    }).from(schema.messages).where(and(
      eq(schema.messages.channelId, membership.channelId),
      gt(schema.messages.seq, membership.lastReadSeq),
    )).orderBy(desc(schema.messages.seq))).filter((row) => row.senderId !== agentId);
    if (!rows.length) continue;

    const mentionRows = await db.select({ messageId: schema.messageMentions.messageId }).from(schema.messageMentions).where(and(
      inArray(schema.messageMentions.messageId, rows.map((row) => row.id)),
      eq(schema.messageMentions.mentionType, "agent"),
      eq(schema.messageMentions.mentionId, agentId),
    ));
    const mentionedMessages = new Set(mentionRows.map((row) => row.messageId));
    const parentTask = membership.type === "thread" && membership.parentMessageId
      ? db.select({
          taskStatus: schema.messages.taskStatus,
          taskAssigneeId: schema.messages.taskAssigneeId,
        }).from(schema.messages).where(eq(schema.messages.id, membership.parentMessageId)).get()
      : null;
    const responseMode = await resolveAgentResponseMode(spaceId, membership.channelId, agentId);

    for (const row of rows) {
      const decision = decideAgentMessageResponse({
        agentId,
        channelType: membership.type as "channel" | "private" | "dm" | "thread",
        senderType: row.senderType as "human" | "agent" | "system",
        effectiveMode: responseMode?.effectiveResponseMode ?? "active",
        messageSeq: row.seq,
        mentioned: mentionedMessages.has(row.id),
        taskAssigneeId: row.taskStatus ? row.taskAssigneeId : null,
        parentTaskAssigneeId: parentTask?.taskAssigneeId ?? null,
        isTask: Boolean(row.taskStatus),
        ambientWakeAfterSeq: responseMode?.ambientWakeAfterSeq ?? membership.ambientWakeAfterSeq,
        mentionWakeAfterSeq: responseMode?.mentionWakeAfterSeq ?? membership.mentionWakeAfterSeq,
      });
      // inbox:receive remains an outer capability guard for ambient scanning. Direct/mention paths retain their
      // existing reachability semantics; normal default-scope agents can always perform the subsequent check.
      if (!decision.wake || (decision.deliveryClass === "ambient" && !hasInbox)) continue;

      count++;
      const responseDirective: AgentResponseBacklog["responseDirective"] = decision.directive === "required"
        ? "required"
        : "optional";
      if (responseDirective === "required") strongestDirective = "required";
      if (latest && row.seq <= latest.seq) continue;

      const taskMessageId = row.taskStatus
        ? row.id
        : parentTask?.taskStatus && membership.parentMessageId
          ? membership.parentMessageId
          : null;
      latest = {
        seq: row.seq,
        count: 0,
        from: row.from,
        targetName: membership.type === "dm" ? `dm:@${row.from}` : `#${membership.name ?? ""}`,
        messageId: row.id,
        channelId: membership.channelId,
        contextChannelId: row.threadId ?? membership.channelId,
        dispatch: {
          chainId: row.dispatchChainId ?? row.id,
          dispatchDepth: row.dispatchDepth ?? 0,
          taskMessageId,
        },
        responseDirective,
        responseReason: decision.reason,
      };
    }
  }
  return latest ? { ...latest, count, responseDirective: strongestDirective } : null;
}

/** Best-effort catch-up after worker-ready reconciliation. */
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
    for (const agent of list) {
      if (!isWorkerLeaseCurrent(lease)) return;
      let backlog: AgentResponseBacklog | null = null;
      try {
        backlog = await computeBacklog(spaceId, agent.id, agent.scopes);
      } catch (error: any) {
        log.warn("backlog scan failed", { agentId: agent.id, detail: String(error?.message ?? error) });
        continue;
      }
      if (!isWorkerLeaseCurrent(lease)) return;
      if (!backlog) continue;
      if (!availableRuntimes.has(agent.runtime)) {
        log.warn("catch-up skipped unsupported runtime", { agentId: agent.id, spaceId, runtime: agent.runtime });
        continue;
      }
      const state = new SqliteDispatchState(spaceId);
      await state.ensureChain({ ...backlog.dispatch, rootMessageId: backlog.messageId, channelId: backlog.channelId });
      if (!isWorkerLeaseCurrent(lease)) return;
      const reservation = await state.reserveWake({
        ...backlog.dispatch,
        messageId: backlog.messageId,
        targetAgentId: agent.id,
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
          targetAgentId: agent.id,
          targetAgentName: agent.name,
          fallbackChannelId: backlog.channelId,
          rejection: reservation,
        });
        if (!isWorkerLeaseCurrent(lease)) return;
        continue;
      }

      let sent = false;
      setAgentIntroductionTurn(spaceId, agent.id, null);
      if (!runningIds.includes(agent.id)) {
        const cfg = await agentConfig(spaceId, agent.id);
        if (!isWorkerLeaseCurrent(lease)) {
          await state.releaseWake(reservation.reservationId);
          return;
        }
        sent = Boolean(cfg) && sendToWorkerForLease(lease, {
          type: "agent:start",
          agentId: agent.id,
          config: cfg,
          reason: "wake",
        });
      } else {
        sent = sendToWorkerForLease(lease, {
          type: "agent:deliver",
          agentId: agent.id,
          seq: 0,
          from: backlog.from,
          target: "",
          targetName: backlog.targetName,
          msgShort: "",
          isTask: false,
          mentioned: false,
          responseDirective: backlog.responseDirective,
          responseReason: backlog.responseReason,
        });
      }
      if (sent) {
        await state.commitWake(reservation.reservationId, {
          agentId: agent.id,
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
