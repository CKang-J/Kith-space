import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { nextSeq, type SpaceTransaction } from "../counters.js";
import { dbForSpace, schema, type SpaceDb } from "../db/index.js";
import { HarnessError } from "../harness/errors.js";
import { persistedMessageMention, serializeMessage } from "../messages/messageSerialization.js";
import { NEW_AGENT_INTRO_REASON } from "../agents/agentHarnessLifecycle.js";
import { DeliveryJournal } from "../deliveries/deliveryJournal.js";
import { advanceDeliveryFrontierInTransaction } from "../deliveries/deliveryFrontier.js";
import { parseMentions, type ConversationMember } from "../channels/channelMembership.js";

export interface TurnOutputEventSink {
  publish(spaceId: string, event: unknown): Promise<void>;
  schedulePending?(spaceId: string): Promise<void>;
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
    handledInputIds: string[];
  }): Promise<typeof schema.messages.$inferSelect> {
    const handledInputIds = [...new Set(input.handledInputIds)];
    if (!input.body.trim()) throw new HarnessError("output_missing", "reply body is required");
    if (!handledInputIds.length) throw new HarnessError("required_input_unresolved", "reply must identify handled inputs");
    const hash = requestHash({ body: input.body, handledInputIds });
    const existing = this.existingReply(input.turnId, input.idempotencyKey, hash);
    if (existing) return existing;
    const seq = await nextSeq(this.spaceId);
    const now = new Date(this.now());
    const message = this.db.transaction((tx) => {
      const raced = this.operationInTransaction(tx, input.turnId, "turn.reply", input.idempotencyKey);
      if (raced) {
        if (raced.requestHash !== hash) throw new HarnessError("idempotency_conflict", "idempotency key was reused for another reply");
        const output = tx.select().from(schema.turnOutputs).where(eq(schema.turnOutputs.operationId, raced.id)).get();
        const prior = output?.messageId ? tx.select().from(schema.messages).where(eq(schema.messages.id, output.messageId)).get() : null;
        if (prior) return prior;
        throw new HarnessError("idempotency_conflict", "reply operation is incomplete and requires reconciliation");
      }
      const { turn, attempt, session, agent, deliveries } = this.validateOperation(tx, input.turnId, input.attemptId, handledInputIds);
      const sourceMessages = tx.select({
        id: schema.messages.id,
        dispatchChainId: schema.messages.dispatchChainId,
        dispatchDepth: schema.messages.dispatchDepth,
      }).from(schema.messages).where(inArray(schema.messages.id, deliveries.map((delivery) => delivery.messageId))).all();
      const chainIds = new Set(sourceMessages.map((source) => source.dispatchChainId ?? source.id));
      const memberRows = tx.select({
        id: schema.agents.id,
        name: schema.agents.name,
        displayName: schema.agents.displayName,
      }).from(schema.channelAgentMembers).innerJoin(schema.agents, eq(schema.agents.id, schema.channelAgentMembers.agentId)).where(and(
        eq(schema.channelAgentMembers.channelId, session.surfaceId),
        eq(schema.agents.spaceId, this.spaceId),
        isNull(schema.agents.deletedAt),
      )).all();
      const mentionPool: ConversationMember[] = memberRows.map((member) => ({ type: "agent", ...member }));
      const mentions = input.body.includes("@") ? parseMentions(input.body, mentionPool) : [];
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
      const created = tx.insert(schema.messages).values({
        id: randomUUID(),
        seq,
        spaceId: this.spaceId,
        channelId: session.surfaceId,
        senderType: "agent",
        senderId: agent.id,
        senderName: agent.name,
        messageType: "chat",
        content: input.body,
        memoryPolicy: "exclude",
        producedByTurnId: turn.id,
        searchText: input.body,
        dispatchChainId,
        dispatchDepth,
      }).returning().get();
      if (mentions.length) {
        tx.insert(schema.messageMentions).values(mentions.map((mention) => ({
          messageId: created.id,
          mentionType: mention.type,
          mentionId: mention.id,
          mentionName: mention.name,
        }))).run();
      }
      new DeliveryJournal().persistChannelMessageInTransaction(tx, this.spaceId, created);
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
      return created;
    });
    const channel = this.db.select().from(schema.channels).where(eq(schema.channels.id, message.channelId)).get();
    const persistedMentions = this.db.select().from(schema.messageMentions).where(eq(schema.messageMentions.messageId, message.id)).all()
      .map(persistedMessageMention);
    await this.events.publish(this.spaceId, {
      type: "message",
      channelId: message.channelId,
      message: { ...serializeMessage(message, persistedMentions, []), channelType: channel?.type ?? null },
    });
    if (channel?.type === "thread" && channel.parentMessageId) {
      const parent = this.db.select({ channelId: schema.messages.channelId }).from(schema.messages)
        .where(eq(schema.messages.id, channel.parentMessageId)).get();
      await this.events.publish(this.spaceId, {
        type: "thread:updated",
        threadChannelId: channel.id,
        parentMessageId: channel.parentMessageId,
        parentChannelId: parent?.channelId ?? null,
        senderId: message.senderId,
        senderType: "agent",
      });
    }
    await this.events.schedulePending?.(this.spaceId);
    return message;
  }

  cede(input: {
    turnId: string;
    attemptId: string;
    idempotencyKey: string;
    inputIds: string[];
    reason: string;
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
      const { turn, attempt, agent, deliveries } = this.validateOperation(tx, input.turnId, input.attemptId, inputIds);
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

  private validateOperation(tx: SpaceTransaction, turnId: string, attemptId: string, inputIds: string[]) {
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
