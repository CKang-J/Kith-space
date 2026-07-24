import { and, asc, eq, inArray } from "drizzle-orm";
import { dbForSpace, schema, type SpaceDb } from "../db/index.js";
import { ContextEnvelopeSchema } from "../context/contracts.js";

export class TurnInspector {
  constructor(private readonly spaceId: string, private readonly db: SpaceDb = dbForSpace(spaceId)) {}

  inspect(turnId: string) {
    const turn = this.db.select().from(schema.agentTurns).where(and(
      eq(schema.agentTurns.id, turnId),
      eq(schema.agentTurns.spaceId, this.spaceId),
    )).get();
    if (!turn) return null;
    const session = this.db.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.id, turn.runtimeSessionId)).get();
    const agent = this.db.select({ id: schema.agents.id, name: schema.agents.name, displayName: schema.agents.displayName })
      .from(schema.agents).where(eq(schema.agents.id, turn.agentId)).get();
    const attempts = this.db.select().from(schema.agentTurnAttempts).where(eq(schema.agentTurnAttempts.turnId, turn.id))
      .orderBy(asc(schema.agentTurnAttempts.attemptNo)).all();
    const attemptIds = attempts.map((attempt) => attempt.id);
    const events = attemptIds.length ? this.db.select().from(schema.agentTurnEvents)
      .where(inArray(schema.agentTurnEvents.attemptId, attemptIds))
      .orderBy(asc(schema.agentTurnEvents.createdAt), asc(schema.agentTurnEvents.ordinal)).all() : [];
    const deliveries = this.db.select().from(schema.agentDeliveryItems).where(eq(schema.agentDeliveryItems.turnId, turn.id))
      .orderBy(asc(schema.agentDeliveryItems.sourceSeq)).all();
    const deliveryMessages = deliveries.length ? this.db.select().from(schema.messages)
      .where(inArray(schema.messages.id, deliveries.map((delivery) => delivery.messageId))).all() : [];
    const messageById = new Map(deliveryMessages.map((message) => [message.id, message]));
    const operations = this.db.select().from(schema.turnOperations).where(eq(schema.turnOperations.turnId, turn.id)).all();
    const outputs = this.db.select().from(schema.turnOutputs).where(eq(schema.turnOutputs.turnId, turn.id)).all();
    const outputIds = outputs.map((output) => output.id);
    const outputInputs = outputIds.length ? this.db.select().from(schema.turnOutputInputs)
      .where(inArray(schema.turnOutputInputs.outputId, outputIds)).all() : [];
    const outputMessages = outputs.some((output) => output.messageId)
      ? this.db.select().from(schema.messages).where(inArray(schema.messages.id, outputs.flatMap((output) => output.messageId ? [output.messageId] : []))).all()
      : [];
    const outputMessageById = new Map(outputMessages.map((message) => [message.id, message]));
    const contextSources = this.db.select().from(schema.turnContextSources).where(eq(schema.turnContextSources.turnId, turn.id))
      .orderBy(asc(schema.turnContextSources.phase), asc(schema.turnContextSources.ordinal)).all();
    const snapshotIds = contextSources.flatMap((source) => source.snapshotId ? [source.snapshotId] : []);
    const snapshots = snapshotIds.length ? this.db.select().from(schema.turnContextSnapshots)
      .where(inArray(schema.turnContextSnapshots.id, snapshotIds)).all() : [];
    const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
    const sourceMessageIds = contextSources.filter((source) => source.sourceKind === "message").map((source) => source.sourceId);
    const sourceMessages = sourceMessageIds.length ? this.db.select().from(schema.messages)
      .where(inArray(schema.messages.id, sourceMessageIds)).all() : [];
    const sourceMessageById = new Map(sourceMessages.map((message) => [message.id, message]));
    const parsedEnvelope = turn.contextEnvelope ? ContextEnvelopeSchema.safeParse(turn.contextEnvelope) : null;
    return {
      turn: {
        id: turn.id,
        status: turn.status,
        outcome: turn.outcome,
        directive: turn.effectiveDirective,
        createdAt: turn.createdAt,
        completedAt: turn.completedAt,
        agent,
        session: session ? {
          id: session.id,
          surfaceKind: session.surfaceKind,
          surfaceId: session.surfaceId,
          generation: session.sessionGeneration,
          runtime: session.runtime,
          engineSessionId: session.engineSessionId,
          status: session.status,
        } : null,
      },
      context: {
        envelope: parsedEnvelope?.success ? parsedEnvelope.data : null,
        manifestState: !turn.contextEnvelope ? "not_assembled" : parsedEnvelope?.success ? "valid" : "invalid",
        sources: contextSources.map((source) => {
          const message = source.sourceKind === "message" ? sourceMessageById.get(source.sourceId) : null;
          const snapshot = source.snapshotId ? snapshotById.get(source.snapshotId) : null;
          const exists = Boolean(message || snapshot);
          const state = !exists
            ? "tombstone"
            : source.injectionMode === "omitted"
              ? "omitted"
              : source.injectionMode === "reference"
                ? "ref_only"
                : "available";
          return {
            phase: source.phase,
            ordinal: source.ordinal,
            sourceKind: source.sourceKind,
            sourceId: source.sourceId,
            sourceRevision: source.sourceRevision,
            snapshotId: source.snapshotId,
            state,
            injectionMode: source.injectionMode,
            projection: source.disclosureProjection,
            visibility: source.visibility,
            reason: source.reason,
            estimatedTokens: source.tokenEstimate,
            contentHmac: source.contentHmac,
            content: state !== "available"
              ? null
              : message ? {
                  senderType: message.senderType,
                  senderName: message.senderName,
                  text: message.content,
                  seq: message.seq,
                } : snapshot?.payload ?? null,
          };
        }),
      },
      attempts: attempts.map((attempt) => ({
        id: attempt.id,
        number: attempt.attemptNo,
        status: attempt.status,
        workerGeneration: attempt.workerGeneration,
        engineSessionIdBefore: attempt.engineSessionIdBefore,
        engineSessionIdAfter: attempt.engineSessionIdAfter,
        usage: attempt.usage,
        errorCode: attempt.errorCode,
        errorDetail: attempt.errorDetailRedacted,
        claimedAt: attempt.claimedAt,
        startedAt: attempt.startedAt,
        completedAt: attempt.completedAt,
        events: events.filter((event) => event.attemptId === attempt.id).map((event) => ({
          ordinal: event.ordinal,
          kind: event.kind,
          payload: event.payload,
          createdAt: event.createdAt,
        })),
      })),
      obligations: deliveries.map((delivery) => {
        const message = messageById.get(delivery.messageId);
        return {
          id: delivery.id,
          directive: delivery.directive,
          reason: delivery.reason,
          disposition: delivery.disposition,
          sourceChannelId: delivery.sourceChannelId,
          sourceSeq: delivery.sourceSeq,
          cursorOwnerChannelId: delivery.cursorOwnerChannelId,
          targetSurfaceKind: delivery.targetSurfaceKind,
          targetSurfaceId: delivery.targetSurfaceId,
          message: message ? { id: message.id, senderName: message.senderName, content: message.content } : null,
          sourceState: message ? "available" : "tombstone",
        };
      }),
      operations: operations.map((operation) => ({
        id: operation.id,
        toolName: operation.toolName,
        status: operation.status,
        slot: operation.operationSlot,
        errorCode: operation.errorCode,
        createdAt: operation.createdAt,
        updatedAt: operation.updatedAt,
      })),
      outputs: outputs.map((output) => ({
        id: output.id,
        kind: output.outputKind,
        messageId: output.messageId,
        message: output.messageId ? outputMessageById.get(output.messageId) ?? null : null,
        sourceState: !output.messageId ? "none" : outputMessageById.has(output.messageId) ? "available" : "tombstone",
        handledInputIds: outputInputs.filter((mapping) => mapping.outputId === output.id).map((mapping) => mapping.deliveryItemId),
        createdAt: output.createdAt,
      })),
    };
  }
}
