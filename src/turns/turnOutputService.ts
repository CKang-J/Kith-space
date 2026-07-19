import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, ne, or } from "drizzle-orm";
import { nextSeq, type SpaceTransaction } from "../counters.js";
import { dbForSpace, schema, type SpaceDb } from "../db/index.js";
import { HarnessError } from "../harness/errors.js";
import { persistedMessageMention, serializeMessage } from "../messages/messageSerialization.js";
import { NEW_AGENT_INTRO_REASON } from "../agents/agentHarnessLifecycle.js";
import { DeliveryJournal } from "../deliveries/deliveryJournal.js";
import { advanceDeliveryFrontierInTransaction } from "../deliveries/deliveryFrontier.js";
import { parseMentions, type ConversationMember } from "../channels/channelMembership.js";
import {
  assertAgentSurfaceAccessInTransaction,
  hasAgentSurfaceAccessInTransaction,
} from "../channels/agentSurfaceAccess.js";
import { ContextEnvelopeSchema } from "../context/contracts.js";
import { decideAgentMessageResponse } from "../agents/agentResponseDelivery.js";
import {
  initialAgentResponseWakeWatermarks,
  resolveAgentDispatchSettingsInTransaction,
} from "../agents/agentResponseSettings.js";
import { createLogger } from "../log.js";
import { reserveDispatchWakeInTransaction } from "../dispatch/dispatchReservation.js";

export interface TurnOutputEventSink {
  publish(spaceId: string, event: unknown): Promise<void>;
  schedulePending?(spaceId: string): Promise<void>;
  dispatchLegacyMentions?(input: {
    spaceId: string;
    messageId: string;
    targetSurfaceId: string;
    targetAgentIds: string[];
  }): Promise<void>;
  recoverLegacyMentions?(spaceId: string): Promise<void>;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** Atomic operation/output/obligation settlement behind server-owned reply targets. */
export class TurnOutputService {
  private readonly log = createLogger("turns:output");

  constructor(
    private readonly spaceId: string,
    private readonly events: TurnOutputEventSink,
    private readonly db: SpaceDb = dbForSpace(spaceId),
    private readonly now: () => number = Date.now,
  ) {}

  async reply(input: {
    turnId: string;
    attemptId: string;
    idempotencyKey: string;
    body: string;
    attachmentIds?: string[];
    attachmentActivationId?: string;
    handledInputIds: string[];
    writePrecondition?: (tx: SpaceTransaction, channelId: string) => void;
  }): Promise<typeof schema.messages.$inferSelect> {
    const handledInputIds = [...new Set(input.handledInputIds)];
    const attachmentIds = [...new Set(input.attachmentIds ?? [])];
    const body = input.body.trim();
    if (!body && !attachmentIds.length) throw new HarnessError("output_missing", "reply body or attachments are required");
    if (!handledInputIds.length) throw new HarnessError("required_input_unresolved", "reply must identify handled inputs");
    const hash = requestHash({ body, attachmentIds, handledInputIds });
    const existing = this.existingReply(input.turnId, input.idempotencyKey, hash);
    if (existing) {
      await this.runPostCommit("recover legacy mentions", () => this.events.recoverLegacyMentions?.(this.spaceId) ?? Promise.resolve());
      return existing;
    }
    const seq = await nextSeq(this.spaceId);
    const now = new Date(this.now());
    const result = this.db.transaction((tx) => {
      const raced = this.operationInTransaction(tx, input.turnId, "turn.reply", input.idempotencyKey);
      if (raced) {
        if (raced.requestHash !== hash) throw new HarnessError("idempotency_conflict", "idempotency key was reused for another reply");
        const output = tx.select().from(schema.turnOutputs).where(eq(schema.turnOutputs.operationId, raced.id)).get();
        const prior = output?.messageId ? tx.select().from(schema.messages).where(eq(schema.messages.id, output.messageId)).get() : null;
        if (prior) return { message: prior, legacyDispatch: null };
        throw new HarnessError("idempotency_conflict", "reply operation is incomplete and requires reconciliation");
      }
      const { turn, attempt, session, agent, deliveries } = this.validateOperation(tx, input.turnId, input.attemptId, handledInputIds, true);
      input.writePrecondition?.(tx, session.surfaceId);
      const surface = tx.select().from(schema.channels).where(and(
        eq(schema.channels.id, session.surfaceId),
        eq(schema.channels.spaceId, this.spaceId),
      )).get();
      if (!surface) throw new HarnessError("reply_target_denied", "reply surface no longer exists", { turnId: turn.id });
      const attachments = attachmentIds.length ? tx.select().from(schema.attachments)
        .where(inArray(schema.attachments.id, attachmentIds)).all() : [];
      if (attachments.length !== attachmentIds.length || attachments.some((attachment) =>
        attachment.spaceId !== this.spaceId
        || attachment.uploaderType !== "agent"
        || attachment.uploaderId !== agent.id
        || attachment.messageId !== null
        || attachment.channelId !== session.surfaceId
        || attachment.uploadState !== "temporary"
        || attachment.sourceTurnId !== turn.id
        || attachment.sourceActivationId !== input.attachmentActivationId
        || !attachment.expiresAt
        || attachment.expiresAt.getTime() <= this.now())) {
        throw new HarnessError("capability_scope_denied", "one or more attachments are unavailable for this turn", { attachmentIds });
      }
      const sourceMessages = tx.select({
        id: schema.messages.id,
        dispatchChainId: schema.messages.dispatchChainId,
        dispatchDepth: schema.messages.dispatchDepth,
      }).from(schema.messages).where(inArray(schema.messages.id, deliveries.map((delivery) => delivery.messageId))).all();
      const chainIds = new Set(sourceMessages.map((source) => source.dispatchChainId ?? source.id));
      let mentionChannelIds = [session.surfaceId];
      if (surface.type === "thread" && surface.parentMessageId) {
        const parent = tx.select({ channelId: schema.messages.channelId }).from(schema.messages)
          .where(eq(schema.messages.id, surface.parentMessageId)).get();
        if (parent) mentionChannelIds = [...new Set([session.surfaceId, parent.channelId])];
      }
      const memberRows = tx.select({
        id: schema.agents.id,
        name: schema.agents.name,
        displayName: schema.agents.displayName,
      }).from(schema.channelAgentMembers).innerJoin(schema.agents, eq(schema.agents.id, schema.channelAgentMembers.agentId)).where(and(
        inArray(schema.channelAgentMembers.channelId, mentionChannelIds),
        eq(schema.agents.spaceId, this.spaceId),
        isNull(schema.agents.deletedAt),
      )).all();
      const mentionPool: ConversationMember[] = [...new Map(memberRows.map((member) => [member.id, member])).values()]
        .filter((member) => hasAgentSurfaceAccessInTransaction(tx, {
          spaceId: this.spaceId,
          channelId: session.surfaceId,
          agentId: member.id,
          now: now.getTime(),
        }) || (surface.type === "thread" && mentionChannelIds.some((channelId) => channelId !== session.surfaceId
          && hasAgentSurfaceAccessInTransaction(tx, {
            spaceId: this.spaceId,
            channelId,
            agentId: member.id,
            now: now.getTime(),
          }))))
        .map((member) => ({ type: "agent" as const, ...member }));
      const mentions = body.includes("@") ? parseMentions(body, mentionPool) : [];
      if (mentions.length && chainIds.size !== 1) {
        throw new HarnessError("capability_scope_denied", "reply mentions require inputs from one dispatch chain", {
          turnId: turn.id,
          chainCount: chainIds.size,
        });
      }
      const dispatchChainId = chainIds.size === 1 ? [...chainIds][0]! : null;
      const dispatchDepth = dispatchChainId
        ? Math.max(0, ...sourceMessages.map((source) => source.dispatchDepth ?? 0)) + 1
        : null;
      if (dispatchChainId) {
        const existingChain = tx.select().from(schema.dispatchChains).where(eq(schema.dispatchChains.id, dispatchChainId)).get();
        if (!existingChain) {
          tx.insert(schema.dispatchChains).values({
            id: dispatchChainId,
            spaceId: this.spaceId,
            rootMessageId: sourceMessages.find((source) => (source.dispatchChainId ?? source.id) === dispatchChainId)?.id ?? dispatchChainId,
            channelId: session.surfaceId,
            maxDepthSeen: dispatchDepth ?? 0,
          }).run();
        } else if (dispatchDepth !== null && dispatchDepth > existingChain.maxDepthSeen) {
          tx.update(schema.dispatchChains).set({ maxDepthSeen: dispatchDepth, updatedAt: now })
            .where(eq(schema.dispatchChains.id, dispatchChainId)).run();
        }
      }
      const operation = tx.insert(schema.turnOperations).values({
        id: randomUUID(),
        turnId: turn.id,
        toolName: "turn.reply",
        idempotencyKey: input.idempotencyKey,
        requestHash: hash,
        operationSlot: "reply:primary",
        status: "pending",
      }).returning().get();
      const createdId = randomUUID();
      const directThreadId = (surface.type === "channel" || surface.type === "private") && mentions.length
        ? randomUUID()
        : null;
      const directThread = directThreadId ? tx.insert(schema.channels).values({
        id: directThreadId,
        spaceId: this.spaceId,
        type: "thread",
        parentMessageId: createdId,
        name: `thread-${createdId.slice(0, 8)}`,
      }).returning().get() : null;
      const created = tx.insert(schema.messages).values({
        id: createdId,
        seq,
        spaceId: this.spaceId,
        channelId: session.surfaceId,
        senderType: "agent",
        senderId: agent.id,
        senderName: agent.name,
        messageType: "chat",
        content: body,
        memoryPolicy: "exclude",
        producedByTurnId: turn.id,
        searchText: body,
        threadId: directThread?.id ?? null,
        dispatchChainId,
        dispatchDepth,
      }).returning().get();
      if (attachmentIds.length) {
        const bound = tx.update(schema.attachments).set({
          messageId: created.id,
          channelId: session.surfaceId,
          uploadState: "bound",
          expiresAt: null,
        }).where(and(
          inArray(schema.attachments.id, attachmentIds),
          eq(schema.attachments.spaceId, this.spaceId),
          eq(schema.attachments.uploaderType, "agent"),
          eq(schema.attachments.uploaderId, agent.id),
          eq(schema.attachments.uploadState, "temporary"),
          eq(schema.attachments.sourceTurnId, turn.id),
          eq(schema.attachments.sourceActivationId, input.attachmentActivationId ?? ""),
          isNull(schema.attachments.messageId),
        )).run();
        if (bound.changes !== attachmentIds.length) {
          throw new HarnessError("capability_scope_denied", "attachment binding changed before reply commit", { attachmentIds });
        }
      }
      if (mentions.length) {
        tx.insert(schema.messageMentions).values(mentions.map((mention) => ({
          messageId: created.id,
          mentionType: mention.type,
          mentionId: mention.id,
          mentionName: mention.name,
        }))).run();
      }
      const mentionedIds = mentions.map((mention) => mention.id);
      const harnessModes = mentionedIds.length ? tx.select().from(schema.agentHarnessState)
        .where(inArray(schema.agentHarnessState.agentId, mentionedIds)).all() : [];
      const harnessModeByAgent = new Map(harnessModes.map((row) => [row.agentId, row.mode]));
      const legacyMentionedIds = mentionedIds.filter((agentId) => (harnessModeByAgent.get(agentId) ?? "legacy") === "legacy");
      const joinIds = [...new Set([agent.id, ...mentionedIds])];
      if (directThread || surface.type === "thread") {
        const targetThreadId = directThread?.id ?? surface.id;
        tx.insert(schema.channelAgentMembers).values(joinIds.map((agentId) => ({
          channelId: targetThreadId,
          agentId,
          lastReadSeq: seq - 1,
          ...initialAgentResponseWakeWatermarks(seq - 1),
        }))).onConflictDoNothing().run();
        if (!directThread && surface.type === "thread") {
          const parentChannelId = mentionChannelIds.find((channelId) => channelId !== surface.id);
          const rejoinIds = parentChannelId ? mentionedIds.filter((agentId) =>
            !hasAgentSurfaceAccessInTransaction(tx, {
              spaceId: this.spaceId,
              channelId: surface.id,
              agentId,
              now: now.getTime(),
            }) && hasAgentSurfaceAccessInTransaction(tx, {
              spaceId: this.spaceId,
              channelId: parentChannelId,
              agentId,
              now: now.getTime(),
            })) : [];
          if (rejoinIds.length) {
            tx.update(schema.channelAgentMembers).set({
              lastReadSeq: seq - 1,
              ...initialAgentResponseWakeWatermarks(seq - 1),
              accessKind: "member",
              taskScope: null,
              accessExpiresAt: null,
            }).where(and(
              eq(schema.channelAgentMembers.channelId, targetThreadId),
              inArray(schema.channelAgentMembers.agentId, rejoinIds),
            )).run();
          }
        }
      }
      const targetSurface = directThread ?? surface;
      const legacySettings = resolveAgentDispatchSettingsInTransaction(
        tx,
        this.spaceId,
        targetSurface.id,
        legacyMentionedIds,
      );
      const actionableLegacyIds = legacySettings.flatMap(({ responseMode }) => {
        if (!hasAgentSurfaceAccessInTransaction(tx, {
          spaceId: this.spaceId,
          channelId: targetSurface.id,
          agentId: responseMode.agentId,
          now: now.getTime(),
        })) return [];
        const decision = decideAgentMessageResponse({
          agentId: responseMode.agentId,
          channelType: targetSurface.type as "channel" | "private" | "dm" | "thread",
          senderType: "agent",
          effectiveMode: responseMode.effectiveResponseMode,
          messageSeq: created.seq,
          mentioned: true,
          ambientWakeAfterSeq: responseMode.ambientWakeAfterSeq,
          mentionWakeAfterSeq: responseMode.mentionWakeAfterSeq,
        });
        return decision.wake && decision.directive !== "observe" ? [responseMode.agentId] : [];
      });
      const reservedLegacyIds = actionableLegacyIds.filter((targetAgentId) => reserveDispatchWakeInTransaction(tx, {
        spaceId: this.spaceId,
        chainId: dispatchChainId!,
        dispatchDepth: dispatchDepth ?? 0,
        taskMessageId: null,
        messageId: created.id,
        targetAgentId,
      }).allowed);
      const journal = new DeliveryJournal();
      if (directThread) {
        journal.persistMessageInTransaction(tx, {
          spaceId: this.spaceId,
          channel: directThread,
          message: created,
          senderType: "agent",
          senderId: agent.id,
          candidateAgentIds: mentionedIds,
          mentions,
          targetSurface: { kind: "thread", id: directThread.id },
        });
        const observers = mentionPool.map((member) => member.id)
          .filter((memberId) => memberId !== agent.id && !mentionedIds.includes(memberId));
        if (observers.length) {
          journal.persistMessageInTransaction(tx, {
            spaceId: this.spaceId,
            channel: surface,
            message: created,
            senderType: "agent",
            senderId: agent.id,
            candidateAgentIds: observers,
            mentions,
            forceObserveAgentIds: observers,
            forceObserveReason: "direct_mention_not_targeted",
          });
        }
      } else {
        journal.persistChannelMessageInTransaction(tx, this.spaceId, created);
      }
      const legacyDispatch = reservedLegacyIds.length ? {
        messageId: created.id,
        targetSurfaceId: directThread?.id ?? surface.id,
        targetAgentIds: reservedLegacyIds,
      } : null;
      const output = tx.insert(schema.turnOutputs).values({
        id: randomUUID(),
        turnId: turn.id,
        operationId: operation.id,
        outputKind: "reply",
        messageId: created.id,
      }).returning().get();
      tx.insert(schema.turnOutputInputs).values(deliveries.map((delivery) => ({
        outputId: output.id,
        deliveryItemId: delivery.id,
      }))).run();
      tx.update(schema.agentDeliveryItems).set({ disposition: "replied", settledAt: now })
        .where(inArray(schema.agentDeliveryItems.id, deliveries.map((delivery) => delivery.id))).run();
      tx.update(schema.turnOperations).set({
        status: "committed",
        resultRef: { outputId: output.id, messageId: created.id },
        updatedAt: now,
      }).where(eq(schema.turnOperations.id, operation.id)).run();
      tx.update(schema.channels).set({ lastMessageAt: now }).where(eq(schema.channels.id, session.surfaceId)).run();
      if (deliveries.some((delivery) => delivery.reason === NEW_AGENT_INTRO_REASON)) {
        tx.update(schema.agents).set({ introducedAt: now }).where(and(
          eq(schema.agents.id, agent.id),
          isNull(schema.agents.introducedAt),
        )).run();
      }
      this.advanceFrontiersInTransaction(tx, agent.id, deliveries.map((delivery) => delivery.cursorOwnerChannelId));
      if (attempt.status === "finalizing") this.finalizeInTransaction(tx, turn.id, attempt.id);
      return { message: created, legacyDispatch };
    });
    const { message, legacyDispatch } = result;
    const channel = this.db.select().from(schema.channels).where(eq(schema.channels.id, message.channelId)).get();
    const persistedMentions = this.db.select().from(schema.messageMentions).where(eq(schema.messageMentions.messageId, message.id)).all()
      .map(persistedMessageMention);
    const persistedAttachments = this.db.select().from(schema.attachments).where(eq(schema.attachments.messageId, message.id)).all();
    await this.runPostCommit("publish reply", () => this.events.publish(this.spaceId, {
      type: "message",
      channelId: message.channelId,
      message: { ...serializeMessage(message, persistedMentions, persistedAttachments), channelType: channel?.type ?? null },
    }));
    if (channel?.type === "thread" && channel.parentMessageId) {
      const parent = this.db.select({ channelId: schema.messages.channelId }).from(schema.messages)
        .where(eq(schema.messages.id, channel.parentMessageId)).get();
      await this.runPostCommit("publish thread update", () => this.events.publish(this.spaceId, {
        type: "thread:updated",
        threadChannelId: channel.id,
        parentMessageId: channel.parentMessageId,
        parentChannelId: parent?.channelId ?? null,
        senderId: message.senderId,
        senderType: "agent",
      }));
    } else if (message.threadId) {
      await this.runPostCommit("publish direct mention thread", () => this.events.publish(this.spaceId, {
        type: "thread:updated",
        threadChannelId: message.threadId,
        parentMessageId: message.id,
        parentChannelId: message.channelId,
        senderId: message.senderId,
        senderType: "agent",
      }));
    }
    if (legacyDispatch) {
      await this.runPostCommit("dispatch legacy mentions", () => this.events.dispatchLegacyMentions?.({
        spaceId: this.spaceId,
        ...legacyDispatch,
      }) ?? Promise.resolve());
    }
    await this.runPostCommit("schedule durable mentions", () => this.events.schedulePending?.(this.spaceId) ?? Promise.resolve());
    return message;
  }

  private async runPostCommit(label: string, operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (error) {
      this.log.warn("post-commit output effect failed", {
        operation: label,
        spaceId: this.spaceId,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  cede(input: {
    turnId: string;
    attemptId: string;
    idempotencyKey: string;
    inputIds: string[];
    reason: string;
    writePrecondition?: (tx: SpaceTransaction, channelId: string) => void;
  }): { cededInputIds: string[] } {
    const inputIds = [...new Set(input.inputIds)];
    if (!inputIds.length || !input.reason.trim()) throw new HarnessError("delivery_not_actionable", "cede requires input IDs and a reason");
    const hash = requestHash({ inputIds, reason: input.reason });
    return this.db.transaction((tx) => {
      const existing = this.operationInTransaction(tx, input.turnId, "turn.cede", input.idempotencyKey);
      if (existing) {
        if (existing.requestHash !== hash) throw new HarnessError("idempotency_conflict", "idempotency key was reused for another cede");
        return { cededInputIds: (existing.resultRef?.inputIds as string[] | undefined) ?? inputIds };
      }
      const { turn, attempt, session, agent, deliveries } = this.validateOperation(tx, input.turnId, input.attemptId, inputIds);
      input.writePrecondition?.(tx, session.surfaceId);
      if (deliveries.some((delivery) => delivery.directive !== "optional")) {
        throw new HarnessError("delivery_not_actionable", "required or observe inputs cannot be ceded", { inputIds });
      }
      const operation = tx.insert(schema.turnOperations).values({
        id: randomUUID(),
        turnId: turn.id,
        toolName: "turn.cede",
        idempotencyKey: input.idempotencyKey,
        requestHash: hash,
        operationSlot: "cede:primary",
        status: "pending",
      }).returning().get();
      const output = tx.insert(schema.turnOutputs).values({
        id: randomUUID(),
        turnId: turn.id,
        operationId: operation.id,
        outputKind: "cede",
      }).returning().get();
      tx.insert(schema.turnOutputInputs).values(deliveries.map((delivery) => ({ outputId: output.id, deliveryItemId: delivery.id }))).run();
      const now = new Date(this.now());
      tx.update(schema.agentDeliveryItems).set({ disposition: "ceded", settledAt: now })
        .where(inArray(schema.agentDeliveryItems.id, deliveries.map((delivery) => delivery.id))).run();
      tx.update(schema.turnOperations).set({
        status: "committed",
        resultRef: { outputId: output.id, inputIds, reason: input.reason },
        updatedAt: now,
      }).where(eq(schema.turnOperations.id, operation.id)).run();
      this.advanceFrontiersInTransaction(tx, agent.id, deliveries.map((delivery) => delivery.cursorOwnerChannelId));
      if (attempt.status === "finalizing") this.finalizeInTransaction(tx, turn.id, attempt.id);
      return { cededInputIds: inputIds };
    });
  }

  finalizeAttempt(attemptId: string): { finalized: boolean; unresolvedInputIds: string[] } {
    return this.db.transaction((tx) => {
      const attempt = tx.select().from(schema.agentTurnAttempts).where(eq(schema.agentTurnAttempts.id, attemptId)).get();
      if (!attempt || attempt.status !== "finalizing") {
        throw new HarnessError("attempt_lease_conflict", "attempt is not finalizing", { attemptId, status: attempt?.status });
      }
      const unresolved = tx.select().from(schema.agentDeliveryItems).where(and(
        eq(schema.agentDeliveryItems.turnId, attempt.turnId),
        inArray(schema.agentDeliveryItems.disposition, ["pending", "bound"]),
      )).all();
      if (unresolved.length) return { finalized: false, unresolvedInputIds: unresolved.map((delivery) => delivery.id) };
      this.finalizeInTransaction(tx, attempt.turnId, attempt.id);
      return { finalized: true, unresolvedInputIds: [] };
    });
  }

  private existingReply(turnId: string, idempotencyKey: string, hash: string) {
    const operation = this.db.select().from(schema.turnOperations).where(and(
      eq(schema.turnOperations.turnId, turnId),
      eq(schema.turnOperations.toolName, "turn.reply"),
      eq(schema.turnOperations.idempotencyKey, idempotencyKey),
    )).get();
    if (!operation) return null;
    if (operation.requestHash !== hash) throw new HarnessError("idempotency_conflict", "idempotency key was reused for another reply");
    const output = this.db.select().from(schema.turnOutputs).where(eq(schema.turnOutputs.operationId, operation.id)).get();
    return output?.messageId ? this.db.select().from(schema.messages).where(eq(schema.messages.id, output.messageId)).get() ?? null : null;
  }

  private operationInTransaction(tx: SpaceTransaction, turnId: string, toolName: string, idempotencyKey: string) {
    return tx.select().from(schema.turnOperations).where(and(
      eq(schema.turnOperations.turnId, turnId),
      eq(schema.turnOperations.toolName, toolName),
      eq(schema.turnOperations.idempotencyKey, idempotencyKey),
    )).get();
  }

  private validateOperation(tx: SpaceTransaction, turnId: string, attemptId: string, inputIds: string[], requireFreshOutput = false) {
    const turn = tx.select().from(schema.agentTurns).where(and(eq(schema.agentTurns.id, turnId), eq(schema.agentTurns.spaceId, this.spaceId))).get();
    const attempt = tx.select().from(schema.agentTurnAttempts).where(and(
      eq(schema.agentTurnAttempts.id, attemptId),
      eq(schema.agentTurnAttempts.turnId, turnId),
    )).get();
    if (!turn || !attempt || !["running", "finalizing"].includes(attempt.status)) {
      throw new HarnessError("attempt_lease_conflict", "turn operation has no active attempt", { turnId, attemptId });
    }
    if (attempt.leaseExpiresAt.getTime() <= this.now()) throw new HarnessError("attempt_lease_expired", "turn operation lease expired", { attemptId });
    const session = tx.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.id, turn.runtimeSessionId)).get();
    const agent = tx.select().from(schema.agents).where(eq(schema.agents.id, turn.agentId)).get();
    if (!session || session.retiredAt || session.sessionGeneration !== turn.sessionGeneration || !agent) {
      throw new HarnessError("session_generation_stale", "turn operation targets a stale session", { turnId });
    }
    assertAgentSurfaceAccessInTransaction(tx, {
      spaceId: this.spaceId,
      channelId: session.surfaceId,
      agentId: turn.agentId,
      now: this.now(),
    });
    if (requireFreshOutput && turn.contextEnvelope) {
      const parsed = ContextEnvelopeSchema.safeParse(turn.contextEnvelope);
      if (!parsed.success) throw new HarnessError("stale_context", "turn context manifest is invalid", { turnId });
      const initialThroughSeq = parsed.data.seenWatermarks.find((watermark) => watermark.channelId === session.surfaceId)?.throughSeq;
      if (initialThroughSeq === undefined) throw new HarnessError("stale_context", "turn context has no output-surface watermark", { turnId, channelId: session.surfaceId });
      const refreshedThroughSeq = tx.select({ throughSeq: schema.turnContextSources.sourceRevision }).from(schema.turnContextSources).where(and(
        eq(schema.turnContextSources.turnId, turnId),
        eq(schema.turnContextSources.phase, "later_query"),
        eq(schema.turnContextSources.sourceKind, "surface_watermark"),
        eq(schema.turnContextSources.sourceId, session.surfaceId),
      )).orderBy(desc(schema.turnContextSources.sourceRevision)).get()?.throughSeq ?? 0;
      const throughSeq = Math.max(initialThroughSeq, refreshedThroughSeq);
      const later = tx.select({ id: schema.messages.id, seq: schema.messages.seq }).from(schema.messages).where(and(
        eq(schema.messages.channelId, session.surfaceId),
        gt(schema.messages.seq, throughSeq),
        or(
          eq(schema.messages.senderType, "human"),
          and(eq(schema.messages.senderType, "agent"), or(isNull(schema.messages.senderId), ne(schema.messages.senderId, agent.id))),
        ),
      )).limit(1).get();
      if (later) {
        throw new HarnessError("stale_context", "the output surface changed after this turn was assembled", {
          turnId,
          channelId: session.surfaceId,
          throughSeq,
          laterMessageId: later.id,
          laterSeq: later.seq,
        });
      }
    }
    const deliveries = tx.select().from(schema.agentDeliveryItems).where(and(
      eq(schema.agentDeliveryItems.turnId, turn.id),
      inArray(schema.agentDeliveryItems.id, inputIds),
      inArray(schema.agentDeliveryItems.disposition, ["bound", "pending"]),
    )).all();
    if (deliveries.length !== inputIds.length) {
      throw new HarnessError("delivery_not_actionable", "one or more inputs are not actionable in this turn", { inputIds });
    }
    return { turn, attempt, session, agent, deliveries };
  }

  private advanceFrontiersInTransaction(tx: SpaceTransaction, agentId: string, channelIds: string[]): void {
    for (const channelId of new Set(channelIds)) {
      advanceDeliveryFrontierInTransaction(tx, agentId, channelId);
    }
  }

  private finalizeInTransaction(tx: SpaceTransaction, turnId: string, attemptId: string): void {
    const now = new Date(this.now());
    const outputs = tx.select({ kind: schema.turnOutputs.outputKind }).from(schema.turnOutputs)
      .where(eq(schema.turnOutputs.turnId, turnId)).all();
    const hasReply = outputs.some((output) => output.kind === "reply");
    const hasCede = outputs.some((output) => output.kind === "cede");
    const outcome = hasReply && hasCede ? "mixed" : hasReply ? "replied" : "ceded";
    tx.update(schema.agentTurnAttempts).set({ status: "succeeded", completedAt: now })
      .where(eq(schema.agentTurnAttempts.id, attemptId)).run();
    tx.update(schema.agentTurns).set({ status: "completed", outcome, completedAt: now })
      .where(eq(schema.agentTurns.id, turnId)).run();
    const turn = tx.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, turnId)).get()!;
    tx.update(schema.runtimeSessions).set({ status: "idle", lastActiveAt: now, updatedAt: now })
      .where(eq(schema.runtimeSessions.id, turn.runtimeSessionId)).run();
  }
}
