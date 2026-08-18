import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { and, count, desc, eq, inArray, lt, lte } from "drizzle-orm";
import { getContentHmacKey } from "../app-data/appDatabase.js";
import { spaceAgentMemoryDir, spaceMemoryDir, userMemoryDir } from "../paths.js";
import { dbForSpace, schema, spaceRecord, type SpaceDb } from "../db/index.js";
import { HarnessError } from "../harness/errors.js";
import {
  ContextEnvelopeSchema,
  type ContextEnvelope,
  type ContextSourceRefSchema,
} from "./contracts.js";
import type { z } from "zod";
import { assertAgentSurfaceAccessInTransaction } from "../channels/agentSurfaceAccess.js";
import {
  boundedContextContent,
  estimateContextTokens,
  FALLBACK_DYNAMIC_CONTEXT_BUDGET,
} from "./contextBudget.js";
import { EpisodicMemoryService, type RecalledMemory } from "../memory/episodicMemoryService.js";
import { UserGlobalMemoryService, type RecalledUserGlobalMemory } from "../memory/userGlobalMemoryService.js";
import { selectUnifiedMemoryRecall } from "../memory/memoryRecallSelection.js";
import { SessionCompactionMarkerService } from "../sessions/sessionCompactionMarker.js";
import {
  collectBoundObjectRefs,
  contextObjectSnapshotResolvers,
} from "./objectSnapshotResolver.js";
import "./canvasObjectSnapshotResolver.js";
import { listCanvasAccessGrantsInTransaction } from "../canvas/canvasAccessGrant.js";
import { canvasSkillPackText } from "../canvas/canvasSkills.js";
import { isCanvasAgentExecutionEnabled } from "../canvas/canvasAgentExecution.js";

type ContextSourceRef = z.infer<typeof ContextSourceRefSchema>;
type MessageRow = typeof schema.messages.$inferSelect;
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function continuityFor(session: typeof schema.runtimeSessions.$inferSelect): ContextEnvelope["continuityMode"] {
  if (session.status === "resume_failed") return "resume_failed";
  if (session.compactionRevision > session.contextCompactionRevision) return "post_compaction";
  return session.engineSessionId ? "resumed" : "cold";
}

export interface AssembledTurnContext {
  envelope: ContextEnvelope;
  renderedContext: string;
}

/** Core-only bounded context assembly. The manifest is frozen once per logical turn. */
export class ContextAssembler {
  private readonly hmacKey: Buffer;

  constructor(
    private readonly spaceId: string,
    private readonly db: SpaceDb = dbForSpace(spaceId),
    private readonly now: () => number = Date.now,
  ) {
    this.hmacKey = getContentHmacKey();
  }

  assemble(turnId: string, capabilityActivationId: string, continuityHint?: ContextEnvelope["continuityMode"]): AssembledTurnContext {
    const turn = this.db.select().from(schema.agentTurns).where(and(
      eq(schema.agentTurns.id, turnId),
      eq(schema.agentTurns.spaceId, this.spaceId),
    )).get();
    if (!turn) throw new HarnessError("delivery_not_actionable", "context turn does not exist", { turnId });
    const session = this.db.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.id, turn.runtimeSessionId)).get();
    if (!session || session.retiredAt || session.sessionGeneration !== turn.sessionGeneration) {
      throw new HarnessError("session_generation_stale", "context targets a stale runtime session", { turnId });
    }
    this.db.transaction((tx) => assertAgentSurfaceAccessInTransaction(tx, {
      spaceId: this.spaceId,
      channelId: session.surfaceId,
      agentId: turn.agentId,
      now: this.now(),
    }));
    if (turn.contextEnvelope) {
      const envelope = ContextEnvelopeSchema.parse(turn.contextEnvelope);
      return { envelope, renderedContext: this.render(envelope) };
    }
    const deliveries = this.db.select().from(schema.agentDeliveryItems).where(and(
      eq(schema.agentDeliveryItems.turnId, turn.id),
      eq(schema.agentDeliveryItems.disposition, "bound"),
    )).all().sort((a, b) => a.sourceSeq - b.sourceSeq);
    if (!deliveries.length) throw new HarnessError("required_input_unresolved", "turn has no bound context inputs", { turnId });
    const messageIds = [...new Set(deliveries.map((delivery) => delivery.messageId))];
    const messages = this.db.select().from(schema.messages).where(inArray(schema.messages.id, messageIds)).all();
    const messageById = new Map(messages.map((message) => [message.id, message]));
    if (messageById.size !== messageIds.length) {
      throw new HarnessError("required_input_unresolved", "one or more required context messages are unavailable", { turnId });
    }
    const targetChannel = this.db.select().from(schema.channels).where(and(
      eq(schema.channels.id, session.surfaceId),
      eq(schema.channels.spaceId, this.spaceId),
    )).get();
    if (!targetChannel) throw new HarnessError("reply_target_denied", "turn surface is unavailable", { turnId });

    const continuityMode = continuityHint ?? continuityFor(session);
    const auditRefs: ContextSourceRef[] = [];
    const snapshotRows: Array<typeof schema.turnContextSnapshots.$inferInsert> = [];
    const compactionMarker = continuityMode === "post_compaction"
      ? new SessionCompactionMarkerService(this.spaceId, this.db).latestPending(session)
      : null;
    if (continuityMode === "post_compaction" && !compactionMarker) {
      throw new HarnessError("session_generation_stale", "pending compaction cursor has no durable event marker", { sessionId: session.id });
    }
    const refForMessage = (message: MessageRow, reason: string, mode: ContextSourceRef["injectionMode"] = "content"): ContextSourceRef => {
      const content = boundedContextContent(message.content);
      const ref: ContextSourceRef = {
        sourceKind: "message",
        sourceId: message.id,
        sourceRevision: message.seq,
        snapshotId: null,
        contentHmac: this.hmac({ kind: "message", id: message.id, seq: message.seq, content: message.content }),
        visibility: this.messageVisibility(message),
        disclosureProjection: "canonical",
        injectionMode: mode,
        estimatedTokens: mode === "content" ? estimateContextTokens(content) : 0,
        reason,
      };
      auditRefs.push(ref);
      return ref;
    };
    const currentBatch = deliveries.map((delivery) => refForMessage(messageById.get(delivery.messageId)!, `delivery:${delivery.id}`));
    const recallQuery = messages.map((message) => boundedContextContent(message.content)).join("\n");
    const workspaceMemory = new EpisodicMemoryService(this.spaceId, this.db, this.now);
    const recallOmissions: Array<{ sourceKind: string; reason: string; count: number }> = [];
    let workspaceRecall: RecalledMemory[] = [];
    try {
      workspaceRecall = workspaceMemory.recall({
        agentId: turn.agentId,
        targetSurfaceId: session.surfaceId,
        query: recallQuery,
        includeContinuity: true,
      });
    } catch {
      recallOmissions.push({ sourceKind: "memory", reason: "recall_unavailable; source may be queried later", count: 1 });
    }
    const userGlobalMemory = new UserGlobalMemoryService(undefined, this.now);
    let globalRecall: RecalledUserGlobalMemory[] = [];
    try {
      globalRecall = userGlobalMemory.recall({
        currentSpaceId: this.spaceId,
        agentId: turn.agentId,
        targetSurfaceId: session.surfaceId,
        query: recallQuery,
      });
    } catch {
      recallOmissions.push({ sourceKind: "user_global_memory", reason: "recall_unavailable; source may be queried later", count: 1 });
    }
    const recalledMemoryRefs: ContextEnvelope["recalledMemories"] = [];
    const memorySourceRefs: ContextSourceRef[] = [];
    const appendMemoryRef = (
      item: RecalledMemory | RecalledUserGlobalMemory,
      sourceKind: "memory" | "user_global_memory",
    ) => {
      recalledMemoryRefs.push({
        memoryId: item.memoryId,
        memoryRevision: item.memoryRevision,
        contentHash: item.contentHash,
        score: item.score,
        scoreBreakdown: item.scoreBreakdown,
        reasons: item.reasons,
        evidenceRefs: item.evidenceRefs,
        disclosure: item.disclosure,
        ...(item.relation ? { relation: item.relation } : {}),
        projection: item.projection,
      });
      const ref: ContextSourceRef = {
        sourceKind,
        sourceId: item.memoryId,
        sourceRevision: item.memoryRevision,
        snapshotId: null,
        contentHmac: item.contentHash,
        visibility: "private",
        disclosureProjection: item.projection,
        injectionMode: item.content == null ? "reference" : "content",
        estimatedTokens: item.content == null ? 0 : estimateContextTokens(item.content),
        reason: `recall:${item.reasons.join(",")}`,
      };
      auditRefs.push(ref);
      memorySourceRefs.push(ref);
    };
    const unifiedRecall = selectUnifiedMemoryRecall([
      ...workspaceRecall.map((item) => ({ item, sourceKind: "memory" as const, ...item })),
      ...globalRecall.map((item) => ({ item, sourceKind: "user_global_memory" as const, ...item })),
    ]);
    unifiedRecall.forEach(({ item, sourceKind }) => appendMemoryRef(item, sourceKind));

    let rootMessage: ContextSourceRef | undefined;
    let root: MessageRow | undefined;
    let parentSnapshot: ContextEnvelope["parentSnapshot"];
    const threadMembership = targetChannel.type === "thread"
      ? this.db.select().from(schema.channelAgentMembers).where(and(
          eq(schema.channelAgentMembers.channelId, targetChannel.id),
          eq(schema.channelAgentMembers.agentId, turn.agentId),
        )).get()
      : null;
    if (targetChannel.type === "thread" && targetChannel.parentMessageId) {
      root = this.db.select().from(schema.messages).where(and(
        eq(schema.messages.id, targetChannel.parentMessageId),
        eq(schema.messages.spaceId, this.spaceId),
      )).get();
      if (root) {
        rootMessage = refForMessage(root, "thread_root");
        if (threadMembership?.accessKind !== "task_scoped") {
          const preceding = this.db.select().from(schema.messages).where(and(
            eq(schema.messages.spaceId, this.spaceId),
            eq(schema.messages.channelId, root.channelId),
            lt(schema.messages.seq, root.seq),
            inArray(schema.messages.senderType, ["human", "agent"]),
          )).orderBy(desc(schema.messages.seq)).limit(8).all();
          const selected: MessageRow[] = [];
          let tokens = 0;
          for (const message of preceding) {
            const next = estimateContextTokens(boundedContextContent(message.content));
            if (tokens + next > 4_000) break;
            selected.push(message);
            tokens += next;
          }
          const total = this.db.select({ value: count() }).from(schema.messages).where(and(
            eq(schema.messages.spaceId, this.spaceId),
            eq(schema.messages.channelId, root.channelId),
            lt(schema.messages.seq, root.seq),
            inArray(schema.messages.senderType, ["human", "agent"]),
          )).get()?.value ?? selected.length;
          parentSnapshot = {
            asOfSeq: root.seq,
            messageRefs: selected.reverse().map((message) => refForMessage(message, "thread_parent_as_of_root")),
            omittedCount: Math.max(0, Number(total) - selected.length),
          };
        }
      }
    }

    const currentIds = new Set(messageIds);
    const surfaceInputWatermark = deliveries
      .filter((delivery) => delivery.sourceChannelId === session.surfaceId)
      .reduce((max, delivery) => Math.max(max, delivery.sourceSeq), 0);
    const recentSurface = continuityMode === "resumed" || surfaceInputWatermark === 0
      ? []
      : this.db.select().from(schema.messages).where(and(
          eq(schema.messages.spaceId, this.spaceId),
          eq(schema.messages.channelId, session.surfaceId),
          lte(schema.messages.seq, surfaceInputWatermark),
          inArray(schema.messages.senderType, ["human", "agent"]),
        )).orderBy(desc(schema.messages.seq)).limit(12).all()
        .filter((message) => !currentIds.has(message.id) && message.id !== root?.id)
        .reverse()
        .map((message) => refForMessage(message, `surface_recovery:${continuityMode}`));

    const objectSnapshots: ContextSourceRef[] = [];
    if (compactionMarker) {
      const markerRef = this.persistSnapshot("runtime_compaction", `${compactionMarker.turnId}:${compactionMarker.attemptId}:${compactionMarker.eventOrdinal}`, {
        sourceTurnId: compactionMarker.turnId,
        sourceAttemptId: compactionMarker.attemptId,
        eventOrdinal: compactionMarker.eventOrdinal,
        eventCreatedAt: compactionMarker.eventCreatedAt,
        compactionRevision: compactionMarker.revision,
      }, "post_compaction_marker", auditRefs, snapshotRows);
      markerRef.injectionMode = "reference";
      markerRef.estimatedTokens = 0;
      objectSnapshots.push(markerRef);
    }
    for (const message of [...new Map([...messages, ...(root ? [root] : [])].map((item) => [item.id, item])).values()]) {
      if (message.taskStatus) {
        objectSnapshots.push(this.persistSnapshot("task", message.id, {
          id: message.id,
          number: message.taskNumber,
          status: message.taskStatus,
          assigneeType: message.taskAssigneeType,
          assigneeId: message.taskAssigneeId,
          executionMode: message.taskExecutionMode,
          revision: message.taskRevision,
        }, "task_state_at_turn_start", auditRefs, snapshotRows));
      }
      const attachments = this.db.select({
        id: schema.attachments.id,
        filename: schema.attachments.filename,
        mimeType: schema.attachments.mimeType,
        sizeBytes: schema.attachments.sizeBytes,
      }).from(schema.attachments).where(eq(schema.attachments.messageId, message.id)).all();
      if (attachments.length) {
        objectSnapshots.push(this.persistSnapshot("attachments", message.id, {
          messageId: message.id,
          attachments,
        }, "attachment_metadata_at_turn_start", auditRefs, snapshotRows));
      }
    }
    const uiSnapshots = messages
      .map((message) => message.contextSnapshot)
      .filter((snapshot): snapshot is Record<string, unknown> => snapshot != null);
    const uiSnapshot = uiSnapshots[0] ?? null;
    const uiSnapshotRef = uiSnapshot
      ? this.persistSnapshot("ui", `${turn.id}:ui`, uiSnapshot, "ui_context_at_send", auditRefs, snapshotRows)
      : null;
    const boundObjectRefs = collectBoundObjectRefs(uiSnapshots);
    const refsByType = new Map<string, typeof boundObjectRefs>();
    for (const ref of boundObjectRefs) {
      const group = refsByType.get(ref.type) ?? [];
      group.push(ref);
      refsByType.set(ref.type, group);
    }
    for (const resolver of contextObjectSnapshotResolvers()) {
      const refs = refsByType.get(resolver.type) ?? [];
      if (!refs.length) continue;
      for (const resolved of resolver.resolve({
        spaceId: this.spaceId,
        turnId: turn.id,
        agentId: turn.agentId,
        surfaceId: session.surfaceId,
        refs,
        messageIds,
        db: this.db,
        now: this.now(),
      })) {
        const snapshotRef = this.persistSnapshot(
          resolved.sourceKind,
          resolved.sourceId,
          resolved.payload,
          resolved.reason,
          auditRefs,
          snapshotRows,
        );
        snapshotRef.sourceRevision = resolved.sourceRevision;
        snapshotRef.visibility = resolved.visibility;
        snapshotRef.disclosureProjection = resolved.disclosureProjection;
        objectSnapshots.push(snapshotRef);
      }
    }

    const seenByChannel = new Map<string, number>();
    for (const delivery of deliveries) {
      seenByChannel.set(delivery.sourceChannelId, Math.max(seenByChannel.get(delivery.sourceChannelId) ?? 0, delivery.sourceSeq));
    }
    // The output watermark is the frozen turn frontier, never a later unbound message that happened to arrive before assembly.
    seenByChannel.set(session.surfaceId, seenByChannel.get(session.surfaceId) ?? 0);

    let fileMemoryRefs = this.fileMemoryRefs(turn.agentId);
    const requiredUnique = new Map<string, ContextSourceRef>();
    for (const ref of [...currentBatch, ...(rootMessage ? [rootMessage] : [])]) {
      requiredUnique.set(`${ref.sourceKind}:${ref.sourceId}:${ref.snapshotId ?? ""}`, ref);
    }
    const requiredTokens = [...requiredUnique.values()].reduce((sum, ref) => sum + ref.estimatedTokens, 0);
    if (requiredTokens > FALLBACK_DYNAMIC_CONTEXT_BUDGET) {
      throw new HarnessError("context_capacity_exhausted", "required delivery batch and thread root exceed the conservative context budget", { turnId });
    }
    const uniqueInjected = new Map<string, ContextSourceRef>();
    for (const ref of [...currentBatch, ...(rootMessage ? [rootMessage] : []), ...(parentSnapshot?.messageRefs ?? []), ...recentSurface, ...memorySourceRefs, ...objectSnapshots, ...(uiSnapshotRef ? [uiSnapshotRef] : [])]) {
      if (ref.injectionMode !== "omitted") uniqueInjected.set(`${ref.sourceKind}:${ref.sourceId}:${ref.snapshotId ?? ""}`, ref);
    }
    let used = [...uniqueInjected.values()].reduce((sum, ref) => sum + ref.estimatedTokens, 0)
      + fileMemoryRefs.reduce((sum, ref) => sum + estimateContextTokens(ref.path), 0);
    const omittedByKind = new Map<string, number>();
    const omit = (ref: ContextSourceRef, reason: string) => {
      if (ref.injectionMode === "omitted") return;
      used -= ref.estimatedTokens;
      ref.injectionMode = "omitted";
      ref.estimatedTokens = 0;
      ref.reason = `${ref.reason};${reason}`;
      omittedByKind.set(ref.sourceKind, (omittedByKind.get(ref.sourceKind) ?? 0) + 1);
    };
    while (used > FALLBACK_DYNAMIC_CONTEXT_BUDGET && fileMemoryRefs.length) {
      const removed = fileMemoryRefs.pop()!;
      used -= estimateContextTokens(removed.path);
      omittedByKind.set("file_memory", (omittedByKind.get("file_memory") ?? 0) + 1);
    }
    const optionalByEvictionPriority = [
      ...[...memorySourceRefs].reverse(),
      ...objectSnapshots,
      ...(uiSnapshotRef ? [uiSnapshotRef] : []),
      ...recentSurface,
      ...(parentSnapshot?.messageRefs ?? []),
    ];
    for (const ref of optionalByEvictionPriority) {
      if (used <= FALLBACK_DYNAMIC_CONTEXT_BUDGET) break;
      omit(ref, "fallback_budget");
    }
    const omissions = [...recallOmissions, ...[...omittedByKind.entries()].map(([sourceKind, count]) => ({
      sourceKind,
      reason: "fallback_budget_exceeded; source may be queried later",
      count,
    }))];
    const envelope = ContextEnvelopeSchema.parse({
      schemaVersion: 1,
      turnId: turn.id,
      session: { spaceId: session.spaceId, agentId: session.agentId, surfaceKind: session.surfaceKind, surfaceId: session.surfaceId },
      responseDirective: turn.effectiveDirective,
      deliveryItemIds: deliveries.map((delivery) => delivery.id),
      seenWatermarks: [...seenByChannel.entries()].map(([channelId, throughSeq]) => ({ channelId, throughSeq })),
      continuityMode,
      ...(rootMessage ? { rootMessage } : {}),
      ...(parentSnapshot ? { parentSnapshot } : {}),
      currentBatch,
      recentSurface,
      objectSnapshots,
      recalledMemories: recalledMemoryRefs,
      fileMemoryRefs,
      ...(uiSnapshot ? { uiSnapshot } : {}),
      capabilityActivationId,
      budget: { available: FALLBACK_DYNAMIC_CONTEXT_BUDGET, used, estimator: "approximate_chars_div_4_fallback" },
      omissions,
      assembledAt: this.now(),
    });
    this.db.transaction((tx) => {
      const current = tx.select({ contextEnvelope: schema.agentTurns.contextEnvelope }).from(schema.agentTurns)
        .where(eq(schema.agentTurns.id, turn.id)).get();
      if (current?.contextEnvelope) return;
      if (snapshotRows.length) tx.insert(schema.turnContextSnapshots).values(snapshotRows).run();
      tx.insert(schema.turnContextSources).values(auditRefs.map((ref, ordinal) => ({
        ...this.sourceRow(ref),
        turnId: turn.id,
        phase: "initial" as const,
        ordinal,
      }))).run();
      tx.update(schema.agentTurns).set({ contextEnvelope: envelope as unknown as Record<string, unknown> })
        .where(eq(schema.agentTurns.id, turn.id)).run();
      if (envelope.continuityMode === "post_compaction") {
        tx.update(schema.runtimeSessions).set({ contextCompactionRevision: compactionMarker!.revision })
          .where(and(
            eq(schema.runtimeSessions.id, session.id),
            eq(schema.runtimeSessions.sessionGeneration, session.sessionGeneration),
            eq(schema.runtimeSessions.contextCompactionRevision, session.contextCompactionRevision),
          )).run();
      }
    });
    const persisted = this.db.select({ contextEnvelope: schema.agentTurns.contextEnvelope }).from(schema.agentTurns)
      .where(eq(schema.agentTurns.id, turn.id)).get()?.contextEnvelope;
    const frozen = ContextEnvelopeSchema.parse(persisted ?? envelope);
    return { envelope: frozen, renderedContext: this.render(frozen) };
  }

  private sourceRow(ref: ContextSourceRef): Omit<typeof schema.turnContextSources.$inferInsert, "turnId" | "phase" | "ordinal"> {
    return {
      sourceKind: ref.sourceKind,
      sourceId: ref.sourceId,
      sourceRevision: ref.sourceRevision,
      snapshotId: ref.snapshotId,
      visibility: ref.visibility,
      disclosureProjection: ref.disclosureProjection,
      injectionMode: ref.injectionMode,
      reason: ref.reason,
      tokenEstimate: ref.estimatedTokens,
      contentHmac: ref.contentHmac,
    };
  }

  private persistSnapshot(
    sourceKind: string,
    sourceId: string,
    payload: Record<string, unknown>,
    reason: string,
    auditRefs: ContextSourceRef[],
    snapshotRows: Array<typeof schema.turnContextSnapshots.$inferInsert>,
  ): ContextSourceRef {
    const snapshotId = randomUUID();
    const payloadHmac = this.hmac({ sourceKind, sourceId, payload });
    snapshotRows.push({
      id: snapshotId,
      payload,
      payloadHmac,
      retentionClass: "turn_audit",
    });
    const ref: ContextSourceRef = {
      sourceKind,
      sourceId,
      sourceRevision: null,
      snapshotId,
      contentHmac: payloadHmac,
      visibility: "private",
      disclosureProjection: "canonical",
      injectionMode: "content",
      estimatedTokens: estimateContextTokens(canonicalJson(payload)),
      reason,
    };
    auditRefs.push(ref);
    return ref;
  }

  private hmac(value: unknown): string {
    return createHmac("sha256", this.hmacKey).update(canonicalJson(value)).digest("hex");
  }

  private messageVisibility(message: MessageRow): ContextSourceRef["visibility"] {
    const channel = this.db.select().from(schema.channels).where(eq(schema.channels.id, message.channelId)).get();
    if (channel?.type === "channel") return "public";
    if (channel?.type === "dm") return "dm";
    if (channel?.type === "thread" && channel.parentMessageId) {
      const parent = this.db.select({ channelId: schema.messages.channelId }).from(schema.messages)
        .where(eq(schema.messages.id, channel.parentMessageId)).get();
      if (parent) {
        const parentChannel = this.db.select({ type: schema.channels.type }).from(schema.channels)
          .where(eq(schema.channels.id, parent.channelId)).get();
        return parentChannel?.type === "channel" ? "public" : parentChannel?.type === "dm" ? "dm" : "private";
      }
    }
    return "private";
  }

  private fileMemoryRefs(agentId: string): ContextEnvelope["fileMemoryRefs"] {
    const root = spaceRecord(this.spaceId)?.rootPath;
    if (!root) return [];
    const paths = [
      path.join(userMemoryDir(), "MEMORY.md"),
      path.join(spaceMemoryDir(root), "MEMORY.md"),
      path.join(spaceAgentMemoryDir(root, agentId), "MEMORY.md"),
    ];
    return paths.map((file, index) => {
      const content = existsSync(file) ? readFileSync(file) : Buffer.from("");
      return {
        path: file,
        contentHash: this.hmac({ path: file, content: content.toString("utf8") }),
        reason: ["user_memory_index", "space_memory_index", "agent_memory_index"][index]!,
      };
    });
  }

  private render(envelope: ContextEnvelope): string {
    const refs = this.db.select().from(schema.turnContextSources).where(and(
      eq(schema.turnContextSources.turnId, envelope.turnId),
      eq(schema.turnContextSources.phase, "initial"),
    )).all().sort((a, b) => a.ordinal - b.ordinal);
    const seen = new Set<string>();
    const lines = [
      "Kith-space durable turn context",
      `Turn: ${envelope.turnId}`,
      `Surface: ${envelope.session.surfaceKind}:${envelope.session.surfaceId}`,
      `Directive: ${envelope.responseDirective}. Settle every listed input with turn.reply or turn.cede; do not invent a reply target.`,
      `Continuity: ${envelope.continuityMode}`,
      "",
      "Injected sources:",
    ];
    for (const ref of refs) {
      const key = `${ref.sourceKind}:${ref.sourceId}:${ref.snapshotId ?? ""}`;
      if (seen.has(key) || ref.injectionMode !== "content") continue;
      seen.add(key);
      if (ref.sourceKind === "message") {
        const message = this.db.select().from(schema.messages).where(eq(schema.messages.id, ref.sourceId)).get();
        lines.push(message
          ? `[message ${message.id} seq=${message.seq} from=${message.senderName} reason=${ref.reason}]\n${boundedContextContent(message.content)}`
          : `[message ${ref.sourceId} deleted; lineage HMAC=${ref.contentHmac}]`);
      } else if (ref.snapshotId) {
        const snapshot = this.db.select().from(schema.turnContextSnapshots).where(eq(schema.turnContextSnapshots.id, ref.snapshotId)).get();
        lines.push(snapshot
          ? `[${ref.sourceKind} ${ref.sourceId} reason=${ref.reason}]\n${canonicalJson(snapshot.payload)}`
          : `[${ref.sourceKind} ${ref.sourceId} snapshot deleted; lineage HMAC=${ref.contentHmac}]`);
      } else if (ref.sourceKind === "memory" || ref.sourceKind === "user_global_memory") {
        const projection = ref.disclosureProjection as "canonical" | "internal_summary" | "shareable_summary" | "ref_only";
        let sourceAccessible = false;
        let content: string | null = null;
        let revisionExists = false;
        try {
          if (ref.sourceKind === "memory") {
            const service = new EpisodicMemoryService(this.spaceId, this.db, this.now);
            revisionExists = ref.sourceRevision != null && service.revisionContent(ref.sourceId, ref.sourceRevision, projection) != null;
            sourceAccessible = service.hasSourceAccess(ref.sourceId, envelope.session.agentId);
            content = sourceAccessible && ref.sourceRevision != null
              ? service.revisionContent(ref.sourceId, ref.sourceRevision, projection)
              : null;
          } else {
            const service = new UserGlobalMemoryService(undefined, this.now);
            revisionExists = ref.sourceRevision != null && service.revisionContent(ref.sourceId, ref.sourceRevision, projection) != null;
            sourceAccessible = service.hasSourceAccess(ref.sourceId, this.spaceId, envelope.session.agentId);
            content = sourceAccessible && ref.sourceRevision != null
              ? service.revisionContent(ref.sourceId, ref.sourceRevision, projection)
              : null;
          }
        } catch {
          sourceAccessible = false;
          content = null;
        }
        lines.push(content
          ? `[${ref.sourceKind} ${ref.sourceId} revision=${ref.sourceRevision} projection=${projection} reason=${ref.reason}]\n${boundedContextContent(content)}`
          : `[${ref.sourceKind} ${ref.sourceId} ${revisionExists ? "source revoked or unavailable" : "forgotten or unavailable"}; lineage HMAC=${ref.contentHmac}]`);
      }
    }
    lines.push("", "File memory indexes (read selectively when relevant):");
    for (const ref of envelope.fileMemoryRefs) lines.push(`- ${ref.path} (${ref.reason}, hash=${ref.contentHash})`);
    if (isCanvasAgentExecutionEnabled()) {
      const grants = this.db.transaction((tx) => listCanvasAccessGrantsInTransaction(tx, envelope.turnId, envelope.session.agentId));
      const skillPack = canvasSkillPackText(grants);
      if (skillPack) {
        lines.push("", skillPack);
      }
    }
    lines.push("", "Use `kith-space turn context` to inspect the authoritative input IDs before settling them.");
    return lines.join("\n");
  }
}

export function inferContinuityMode(session: typeof schema.runtimeSessions.$inferSelect): ContextEnvelope["continuityMode"] {
  return continuityFor(session);
}
