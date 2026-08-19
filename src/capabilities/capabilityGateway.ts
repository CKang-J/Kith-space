import { createHash, createHmac, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, like, lt, ne, or, sql } from "drizzle-orm";
import { getContentHmacKey } from "../app-data/appDatabase.js";
import { assertAgentSurfaceAccessInTransaction, hasAgentSurfaceAccessInTransaction } from "../channels/agentSurfaceAccess.js";
import { agentHasScope } from "../agents/agentScopes.js";
import type { SpaceTransaction } from "../counters.js";
import { dbForSpace, schema, type SpaceDb } from "../db/index.js";
import { HarnessError } from "../harness/errors.js";
import { TurnInspector } from "../turns/turnInspector.js";
import { isTaskOperationError, parseTaskActionMetadata } from "../tasks/taskTypes.js";
import { taskGatewayPort } from "./taskGatewayPort.js";
import { publish } from "../server/realtime.js";
import type { TurnCapabilityClaims } from "./contracts.js";
import type {
  CanvasAssetImportCommand,
  CanvasContextBundleCreateCommand,
  CanvasAlignNodesCommand,
  CanvasBooleanOpCommand,
  CanvasCreateFrameCommand,
  CanvasCreateImageCommand,
  CanvasCreateShapeCommand,
  CanvasCreateTextCommand,
  CanvasDeleteNodesCommand,
  CanvasDistributeNodesCommand,
  CanvasDuplicateNodesCommand,
  CanvasElementsApplyCommand,
  CanvasElementsGetCommand,
  CanvasExportCommand,
  CanvasFlipNodesCommand,
  CanvasGroupNodesCommand,
  CanvasReorderNodesCommand,
  CanvasSceneSummaryCommand,
  CanvasSetCanvasBackgroundCommand,
  CanvasSnapshotGetCommand,
  CanvasUngroupNodesCommand,
  CanvasUpdateFrameCommand,
  CanvasUpdateNodeCommand,
  ChecklistClearCommand,
  ChecklistUpsertCommand,
  ConversationReadCommand,
  ConversationSearchCommand,
  MemoryGetCommand,
  MemoryRecallCommand,
  ScheduleWakeupCommand,
  TaskAssignCommand,
  TaskClaimCommand,
  TaskCreateCommand,
  TaskDeliverCommand,
  TaskGetCommand,
  TaskListCommand,
  TaskReportCommand,
  TaskUnclaimCommand,
  TaskUpdateCommand,
  TurnProgressCommand,
  GatewayScope,
} from "./gatewayContracts.js";
import { requiredAgentScopes } from "./gatewayContracts.js";
import {
  executeCanvasAssetImport,
  executeCanvasContextBundleCreate,
  executeCanvasElementsApply,
  executeCanvasElementsGet,
  executeCanvasExport,
  executeCanvasSceneSummary,
  executeCanvasSnapshotGet,
  executeCanvasTypedMutation,
  mapCanvasToolError,
} from "../canvas/canvasGatewayTools.js";
import type { CanvasMutationFeedback } from "../canvas/canvasMutationFeedback.js";
import {
  CANVAS_LAST_ERROR_KEY,
  CANVAS_LAST_ERROR_TOOL,
} from "../canvas/canvasSkills.js";
import type { CanvasTypedMutationCommand, CanvasTypedToolName } from "../canvas/canvasAgentTools.js";
import { EpisodicMemoryService, MemoryError, type RecalledMemory } from "../memory/episodicMemoryService.js";
import { UserGlobalMemoryService, type RecalledUserGlobalMemory } from "../memory/userGlobalMemoryService.js";
import { selectUnifiedMemoryRecall } from "../memory/memoryRecallSelection.js";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

type OperationResult = Record<string, unknown>;

/** Shared use-case module behind both MCP and CLI transports. */
export class CapabilityGateway {
  private readonly hmacKey = getContentHmacKey();
  private readonly externalInFlight = new Map<string, { requestHash: string; promise: Promise<OperationResult> }>();

  constructor(
    private readonly spaceId: string,
    private readonly db: SpaceDb = dbForSpace(spaceId),
    private readonly now: () => number = Date.now,
  ) {}

  contextCheck(claims: TurnCapabilityClaims, refresh: boolean) {
    this.db.transaction((tx) => this.assertLiveCapabilityInTransaction(tx, claims, "context.check"));
    const turn = this.db.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, claims.turnId)).get();
    const session = this.db.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.id, claims.sessionId)).get();
    if (!turn || !session) throw new HarnessError("capability_inactive", "turn session is unavailable");
    const deliveries = claims.allowedInputIds.length ? this.db.select().from(schema.agentDeliveryItems).where(and(
      eq(schema.agentDeliveryItems.turnId, claims.turnId),
      inArray(schema.agentDeliveryItems.id, claims.allowedInputIds),
    )).orderBy(asc(schema.agentDeliveryItems.sourceSeq)).all() : [];
    const messages = deliveries.length ? this.db.select().from(schema.messages)
      .where(inArray(schema.messages.id, deliveries.map((delivery) => delivery.messageId))).all() : [];
    const messageById = new Map(messages.map((message) => [message.id, message]));
    let refreshedThroughSeq = claims.seenWatermarks.find((item) => item.channelId === session.surfaceId)?.throughSeq ?? 0;
    let laterMessages: Array<typeof schema.messages.$inferSelect> = [];
    if (refresh) {
      laterMessages = this.db.select().from(schema.messages).where(and(
        eq(schema.messages.channelId, session.surfaceId),
        gt(schema.messages.seq, refreshedThroughSeq),
        or(
          eq(schema.messages.senderType, "human"),
          and(eq(schema.messages.senderType, "agent"), or(isNull(schema.messages.senderId), ne(schema.messages.senderId, claims.agentId))),
        ),
      )).orderBy(asc(schema.messages.seq)).limit(50).all();
      if (laterMessages.length) {
        refreshedThroughSeq = laterMessages[laterMessages.length - 1]!.seq;
        this.auditMessages(claims, laterMessages, "context_refresh", session.surfaceId, refreshedThroughSeq);
      }
    }
    return {
      turnId: claims.turnId,
      attemptId: claims.attemptId,
      activationId: claims.activationId,
      capabilityMode: this.capabilityMode(claims),
      target: { surfaceKind: session.surfaceKind, surfaceId: session.surfaceId },
      directive: turn.effectiveDirective,
      contextEnvelope: turn.contextEnvelope ?? null,
      inputs: deliveries.map((delivery) => ({
        id: delivery.id,
        directive: delivery.directive,
        reason: delivery.reason,
        sourceChannelId: delivery.sourceChannelId,
        sourceSeq: delivery.sourceSeq,
        message: messageById.get(delivery.messageId) ?? null,
      })),
      later: laterMessages,
      refreshedThroughSeq,
    };
  }

  conversationRead(claims: TurnCapabilityClaims, command: ConversationReadCommand) {
    this.db.transaction((tx) => this.assertLiveCapabilityInTransaction(tx, claims, "conversation.read", command.channelId));
    const rows = this.db.select().from(schema.messages).where(and(
      eq(schema.messages.spaceId, this.spaceId),
      eq(schema.messages.channelId, command.channelId),
      command.afterSeq === undefined ? undefined : gt(schema.messages.seq, command.afterSeq),
    )).orderBy(command.afterSeq === undefined ? desc(schema.messages.seq) : asc(schema.messages.seq)).limit(command.limit).all();
    const messages = command.afterSeq === undefined ? rows.reverse() : rows;
    this.auditMessages(claims, messages, "conversation_read");
    return { channelId: command.channelId, messages: messages.map((message) => this.projectMessage(claims, message)) };
  }

  conversationSearch(claims: TurnCapabilityClaims, command: ConversationSearchCommand) {
    this.db.transaction((tx) => this.assertLiveCapabilityInTransaction(tx, claims, "conversation.search"));
    const memberships = this.db.select({ channelId: schema.channelAgentMembers.channelId }).from(schema.channelAgentMembers)
      .where(eq(schema.channelAgentMembers.agentId, claims.agentId)).all();
    const channelIds = this.db.transaction((tx) => memberships.flatMap(({ channelId }) =>
      hasAgentSurfaceAccessInTransaction(tx, { spaceId: this.spaceId, channelId, agentId: claims.agentId, now: this.now() })
        && this.projectionFor(claims, channelId) === "canonical" ? [channelId] : []));
    if (!channelIds.length) return { query: command.query, results: [] };
    const rows = this.db.select().from(schema.messages).where(and(
      eq(schema.messages.spaceId, this.spaceId),
      inArray(schema.messages.channelId, channelIds),
      like(schema.messages.searchText, `%${command.query}%`),
    )).orderBy(desc(schema.messages.seq)).limit(command.limit).all();
    this.auditMessages(claims, rows, "conversation_search");
    return { query: command.query, results: rows.map((message) => this.projectMessage(claims, message)) };
  }

  memoryRecall(claims: TurnCapabilityClaims, command: MemoryRecallCommand) {
    this.db.transaction((tx) => this.assertLiveCapabilityInTransaction(tx, claims, "memory.read"));
    const targetSurfaceId = this.targetSurfaceId(claims);
    try {
      const workspace = new EpisodicMemoryService(this.spaceId, this.db, this.now).recall({
        agentId: claims.agentId,
        targetSurfaceId,
        query: command.query,
        includeContinuity: command.includeContinuity,
      }).map((item) => ({ ...item, scope: "workspace" as const }));
      const global = new UserGlobalMemoryService(undefined, this.now).recall({
        currentSpaceId: this.spaceId,
        agentId: claims.agentId,
        targetSurfaceId,
        query: command.query,
        includeContinuity: command.includeContinuity,
      }).map((item) => ({ ...item, scope: "user_global" as const }));
      const results = selectUnifiedMemoryRecall([...workspace, ...global]);
      this.auditMemories(claims, results, "memory_recall");
      return { query: command.query, results };
    } catch (error) {
      throw this.memoryHarnessError(error);
    }
  }

  memoryGet(claims: TurnCapabilityClaims, command: MemoryGetCommand) {
    this.db.transaction((tx) => this.assertLiveCapabilityInTransaction(tx, claims, "memory.read"));
    const targetSurfaceId = this.targetSurfaceId(claims);
    try {
      let result: (RecalledMemory & { scope: "workspace" }) | (RecalledUserGlobalMemory & { scope: "user_global" });
      try {
        result = { ...new EpisodicMemoryService(this.spaceId, this.db, this.now)
          .getForAgent(command.memoryId, claims.agentId, targetSurfaceId), scope: "workspace" };
      } catch (error) {
        if (!(error instanceof MemoryError) || error.code !== "MEMORY_NOT_FOUND") throw error;
        result = { ...new UserGlobalMemoryService(undefined, this.now)
          .getForAgent(command.memoryId, this.spaceId, claims.agentId, targetSurfaceId), scope: "user_global" };
      }
      this.auditMemories(claims, [result], "memory_get");
      return { memory: result };
    } catch (error) {
      throw this.memoryHarnessError(error);
    }
  }

  turnGet(claims: TurnCapabilityClaims) {
    this.db.transaction((tx) => this.assertLiveCapabilityInTransaction(tx, claims, "turn.get"));
    const detail = new TurnInspector(this.spaceId, this.db).inspect(claims.turnId);
    if (!detail || detail.turn.agent?.id !== claims.agentId) throw new HarnessError("capability_scope_denied", "turn is outside the activation");
    return detail;
  }

  taskList(claims: TurnCapabilityClaims, command: TaskListCommand) {
    const channelId = this.resolveChannel(claims, command.channel);
    this.db.transaction((tx) => this.assertLiveCapabilityInTransaction(tx, claims, "task.read", channelId));
    const tasks = this.db.select().from(schema.messages).where(and(
      eq(schema.messages.channelId, channelId), isNotNull(schema.messages.taskStatus),
    )).orderBy(asc(schema.messages.taskNumber)).all();
    return { channelId, tasks: tasks.map((task) => ({
      ...this.projectMessage(claims, task),
      number: task.taskNumber,
      status: task.taskStatus,
      executionMode: task.taskExecutionMode,
      parentTaskId: task.taskParentId,
      assigneeId: task.taskAssigneeId,
      revision: task.taskRevision,
    })) };
  }

  async taskGet(claims: TurnCapabilityClaims, command: TaskGetCommand) {
    const taskId = this.resolveTaskId(claims, command.taskId);
    const before = this.db.select({ channelId: schema.messages.channelId }).from(schema.messages).where(eq(schema.messages.id, taskId)).get();
    if (!before) throw new HarnessError("capability_scope_denied", "task is unavailable");
    this.db.transaction((tx) => this.assertLiveCapabilityInTransaction(tx, claims, "task.read", before.channelId));
    const details = await taskGatewayPort().details(this.spaceId, taskId);
    if (!details) throw new HarnessError("capability_scope_denied", "task is unavailable");
    this.db.transaction((tx) => this.assertLiveCapabilityInTransaction(tx, claims, "task.read", details.task.channelId));
    return {
      task: this.projectMessage(claims, details.task),
      parent: details.parent ? this.projectMessage(claims, details.parent) : null,
      children: details.children.map((message) => this.projectMessage(claims, message)),
      reports: details.reports.map((message) => this.projectMessage(claims, message)),
      deliveries: details.deliveries.map((message) => this.projectMessage(claims, message)),
    };
  }

  async taskCreate(claims: TurnCapabilityClaims, command: TaskCreateCommand): Promise<OperationResult> {
    const channelId = this.resolveChannel(claims, command.channel);
    const parentTaskId = command.parentTaskId ? this.resolveTaskId(claims, command.parentTaskId) : null;
    return this.externalOperation(claims, "task.create", command.idempotencyKey, { ...command, channelId, parentTaskId }, "task", {
      reconcile: (operationId) => this.taskMutationResult(operationId, () => true),
      execute: async (operationId) => {
        const actor = this.agentActor(claims.agentId);
        const task = await taskGatewayPort().create({
          messageId: operationId, spaceId: this.spaceId, channelId, actor, title: command.title,
          executionMode: command.executionMode, parentTaskId, writePrecondition: this.writePrecondition(claims, "task.write"),
        });
        return this.taskResult(task);
      },
    });
  }

  async taskClaim(claims: TurnCapabilityClaims, command: TaskClaimCommand): Promise<OperationResult> {
    const taskId = this.resolveTaskId(claims, command.taskId);
    return this.externalOperation(claims, "task.claim", command.idempotencyKey, { ...command, taskId }, "task", {
      reconcile: () => null,
      execute: async () => {
        const task = await taskGatewayPort().claim(this.spaceId, taskId, claims.agentId, command.expectedRevision, this.writePrecondition(claims, "task.write"));
        if (!task) throw new HarnessError("capability_scope_denied", "task is unavailable");
        return this.taskResult(task);
      },
    });
  }

  async taskUpdate(claims: TurnCapabilityClaims, command: TaskUpdateCommand): Promise<OperationResult> {
    const taskId = this.resolveTaskId(claims, command.taskId);
    return this.externalOperation(claims, "task.update", command.idempotencyKey, { ...command, taskId }, "task", {
      reconcile: () => null,
      execute: async () => {
        const task = await taskGatewayPort().update(this.spaceId, taskId, command.status, claims.agentId, {
          from: command.from, expectedRevision: command.expectedRevision,
        }, this.writePrecondition(claims, "task.write"));
        if (!task) throw new HarnessError("capability_scope_denied", "task is unavailable");
        return this.taskResult(task);
      },
    });
  }

  async taskAssign(claims: TurnCapabilityClaims, command: TaskAssignCommand): Promise<OperationResult> {
    const taskId = this.resolveTaskId(claims, command.taskId);
    const handle = command.to.replace(/^@/, "");
    const target = this.db.select().from(schema.agents).where(and(
      eq(schema.agents.spaceId, this.spaceId), eq(schema.agents.name, handle), isNull(schema.agents.deletedAt),
    )).get();
    if (!target) throw new HarnessError("capability_scope_denied", "task assignee is unavailable");
    return this.externalOperation(claims, "task.assign", command.idempotencyKey, { ...command, taskId, targetAgentId: target.id }, "task", {
      reconcile: () => null,
      execute: async () => {
        const task = await taskGatewayPort().assign(this.spaceId, taskId, target.id, claims.agentId, command.expectedRevision, this.writePrecondition(claims, "task.write"));
        if (!task) throw new HarnessError("capability_scope_denied", "task is unavailable");
        return { ...this.taskResult(task), to: target.name };
      },
    });
  }

  async taskUnclaim(claims: TurnCapabilityClaims, command: TaskUnclaimCommand): Promise<OperationResult> {
    const taskId = this.resolveTaskId(claims, command.taskId);
    return this.externalOperation(claims, "task.unclaim", command.idempotencyKey, { ...command, taskId }, "task", {
      reconcile: () => null,
      execute: async () => {
        const task = await taskGatewayPort().unclaim(this.spaceId, taskId, claims.agentId, command.expectedRevision, this.writePrecondition(claims, "task.write"));
        if (!task) throw new HarnessError("capability_scope_denied", "task is unavailable");
        return this.taskResult(task);
      },
    });
  }

  async taskReport(claims: TurnCapabilityClaims, command: TaskReportCommand): Promise<OperationResult> {
    const taskId = this.resolveTaskId(claims, command.taskId);
    return this.externalOperation(claims, "task.report", command.idempotencyKey, { ...command, taskId }, "task", {
      reconcile: (operationId) => {
        const report = this.db.select().from(schema.messages).where(eq(schema.messages.id, operationId)).get();
        return report ? { taskId, reportMessageId: report.id, threadId: report.channelId, threadTarget: `thread:${taskId.slice(0, 8)}` } : null;
      },
      execute: async (operationId) => {
        const actor = this.agentActor(claims.agentId);
        const result = await taskGatewayPort().report({
          spaceId: this.spaceId, taskId, actor, kind: command.kind, content: command.content, messageId: operationId,
          writePrecondition: this.writePrecondition(claims, "task.write"),
        });
        return { taskId, reportMessageId: result.report.id, threadId: result.report.channelId, threadTarget: `thread:${taskId.slice(0, 8)}` };
      },
    });
  }

  async taskDeliver(claims: TurnCapabilityClaims, command: TaskDeliverCommand): Promise<OperationResult> {
    const taskId = this.resolveTaskId(claims, command.taskId);
    const childTaskIds = command.childTaskIds.map((id) => this.resolveTaskId(claims, id));
    return this.externalOperation(claims, "task.deliver", command.idempotencyKey, { ...command, taskId, childTaskIds }, "task", {
      reconcile: (operationId) => {
        const delivery = this.db.select().from(schema.messages).where(eq(schema.messages.id, operationId)).get();
        const metadata = delivery ? parseTaskActionMetadata(delivery.actionMetadata) : null;
        if (!delivery || metadata?.kind !== "task-delivery" || metadata.taskId !== taskId) return null;
        const task = this.db.select().from(schema.messages).where(eq(schema.messages.id, taskId)).get();
        return task ? { ...this.taskResult(task), deliveryMessageId: delivery.id } : null;
      },
      execute: async (operationId) => {
        const result = await taskGatewayPort().deliver({
          spaceId: this.spaceId, taskId, actor: this.agentActor(claims.agentId), expectedRevision: command.expectedRevision,
          summary: command.summary, childTaskIds, messageId: operationId, writePrecondition: this.writePrecondition(claims, "task.write"),
        });
        return { ...this.taskResult(result.task), deliveryMessageId: result.delivery.id, childTaskIds: result.children.map((child) => child.id) };
      },
    });
  }

  checklistList(claims: TurnCapabilityClaims) {
    this.db.transaction((tx) => this.assertLiveCapabilityInTransaction(tx, claims, "session.checklist"));
    const session = this.db.select({ revision: schema.runtimeSessions.checklistRevision }).from(schema.runtimeSessions)
      .where(eq(schema.runtimeSessions.id, claims.sessionId)).get();
    return {
      sessionId: claims.sessionId,
      revision: session?.revision ?? 0,
      items: this.db.select().from(schema.sessionChecklistItems)
        .where(eq(schema.sessionChecklistItems.runtimeSessionId, claims.sessionId))
        .orderBy(asc(schema.sessionChecklistItems.sortOrder), asc(schema.sessionChecklistItems.createdAt)).all()
        .map((item) => ({ ...item, status: item.status === "open" ? "pending" : item.status })),
    };
  }

  checklistUpsert(claims: TurnCapabilityClaims, command: ChecklistUpsertCommand): OperationResult {
    return this.operation(claims, "session.checklist_upsert", command.idempotencyKey, command, "checklist", "session.checklist", (tx) => {
      const existing = command.id ? tx.select().from(schema.sessionChecklistItems).where(and(
        eq(schema.sessionChecklistItems.id, command.id),
        eq(schema.sessionChecklistItems.runtimeSessionId, claims.sessionId),
      )).get() : null;
      if (command.id && !existing) throw new HarnessError("capability_scope_denied", "checklist item is outside the current session");
      if (existing && command.expectedRevision !== undefined && existing.rowVersion !== command.expectedRevision) {
        throw new HarnessError("idempotency_conflict", "checklist revision changed", { expectedRevision: command.expectedRevision, actualRevision: existing.rowVersion });
      }
      const now = new Date(this.now());
      const item = existing
        ? tx.update(schema.sessionChecklistItems).set({
            text: command.text,
            status: command.status,
            sortOrder: command.order,
            sourceTurnId: claims.turnId,
            rowVersion: existing.rowVersion + 1,
            updatedAt: now,
          }).where(eq(schema.sessionChecklistItems.id, existing.id)).returning().get()
        : tx.insert(schema.sessionChecklistItems).values({
            id: command.id ?? randomUUID(),
            runtimeSessionId: claims.sessionId,
            text: command.text,
            status: command.status,
            sortOrder: command.order,
            sourceTurnId: claims.turnId,
          }).returning().get();
      const collection = tx.update(schema.runtimeSessions).set({ checklistRevision: sql`${schema.runtimeSessions.checklistRevision} + 1` })
        .where(eq(schema.runtimeSessions.id, claims.sessionId)).returning({ revision: schema.runtimeSessions.checklistRevision }).get();
      return { revision: collection!.revision, item: { ...item, createdAt: item.createdAt.getTime(), updatedAt: item.updatedAt.getTime() } };
    });
  }

  checklistClear(claims: TurnCapabilityClaims, command: ChecklistClearCommand): OperationResult {
    return this.operation(claims, "session.checklist_clear", command.idempotencyKey, command, "checklist", "session.checklist", (tx) => {
      const rows = tx.select().from(schema.sessionChecklistItems).where(eq(schema.sessionChecklistItems.runtimeSessionId, claims.sessionId)).all();
      const ids = rows.filter((row) => command.includeCompleted || !["done", "cancelled"].includes(row.status)).map((row) => row.id);
      let revision = tx.select({ revision: schema.runtimeSessions.checklistRevision }).from(schema.runtimeSessions)
        .where(eq(schema.runtimeSessions.id, claims.sessionId)).get()!.revision;
      if (ids.length) {
        tx.delete(schema.sessionChecklistItems).where(inArray(schema.sessionChecklistItems.id, ids)).run();
        revision = tx.update(schema.runtimeSessions).set({ checklistRevision: sql`${schema.runtimeSessions.checklistRevision} + 1` })
          .where(eq(schema.runtimeSessions.id, claims.sessionId)).returning({ revision: schema.runtimeSessions.checklistRevision }).get()!.revision;
      }
      return { cleared: ids.length, revision };
    });
  }

  scheduleWakeup(claims: TurnCapabilityClaims, command: ScheduleWakeupCommand): OperationResult {
    return this.operation(claims, "session.schedule_wakeup", command.idempotencyKey, command, "wakeup", "session.schedule_wakeup", (tx) => {
      const operationKey = command.idempotencyKey;
      const existing = tx.select().from(schema.sessionWakeups).where(and(
        eq(schema.sessionWakeups.runtimeSessionId, claims.sessionId),
        eq(schema.sessionWakeups.idempotencyKey, operationKey),
      )).get();
      const wakeup = existing ?? tx.insert(schema.sessionWakeups).values({
        id: randomUUID(),
        runtimeSessionId: claims.sessionId,
        sessionGeneration: claims.sessionGeneration,
        ownerAgentId: claims.agentId,
        dueAt: new Date(this.now() + command.delaySeconds * 1_000),
        reason: command.reason,
        idempotencyKey: operationKey,
        sourceTurnId: claims.turnId,
      }).returning().get();
      return { wakeup: { ...wakeup, dueAt: wakeup.dueAt.getTime(), createdAt: wakeup.createdAt.getTime() } };
    });
  }

  progress(claims: TurnCapabilityClaims, command: TurnProgressCommand): OperationResult {
    return this.operation(claims, "turn.progress", command.idempotencyKey, command, "progress", "turn.progress", (tx) => {
      const prior = tx.select({ ordinal: schema.agentTurnEvents.ordinal }).from(schema.agentTurnEvents)
        .where(and(eq(schema.agentTurnEvents.attemptId, claims.attemptId), lt(schema.agentTurnEvents.ordinal, 0)))
        .orderBy(asc(schema.agentTurnEvents.ordinal)).get();
      const ordinal = (prior?.ordinal ?? 0) - 1;
      tx.insert(schema.agentTurnEvents).values({
        attemptId: claims.attemptId,
        ordinal,
        kind: "progress",
        payload: { text: command.text },
      }).run();
      return { progress: { ordinal, text: command.text } };
    });
  }

  capabilityDescribe(claims: TurnCapabilityClaims) {
    this.db.transaction((tx) => this.assertLiveCapabilityInTransaction(tx, claims, "capability.describe"));
    return { capabilityMode: this.capabilityMode(claims), scopes: claims.scopes, serverName: "kith-core" };
  }

  canvasSnapshotGet(claims: TurnCapabilityClaims, command: CanvasSnapshotGetCommand) {
    try {
      return this.db.transaction((tx) => {
        this.assertLiveCapabilityInTransaction(tx, claims, "canvas.read");
        return executeCanvasSnapshotGet(tx, claims, command, this.now());
      });
    } catch (error) {
      mapCanvasToolError(error);
    }
  }

  canvasElementsGet(claims: TurnCapabilityClaims, command: CanvasElementsGetCommand) {
    try {
      return this.db.transaction((tx) => {
        this.assertLiveCapabilityInTransaction(tx, claims, "canvas.read");
        return executeCanvasElementsGet(this.db, tx, this.spaceId, claims, command, this.now());
      });
    } catch (error) {
      mapCanvasToolError(error);
    }
  }

  canvasElementsApply(claims: TurnCapabilityClaims, command: CanvasElementsApplyCommand) {
    try {
      const result = this.operation(
        claims,
        "canvas.elements_apply",
        command.idempotencyKey,
        {
          canvasId: command.canvasId ?? null,
          snapshotId: command.snapshotId ?? null,
          expectedRevision: command.expectedRevision,
          operations: command.operations,
          confirmDestructive: command.confirmDestructive ?? false,
        },
        "canvas:apply",
        "canvas.write",
        (tx, operationId) => executeCanvasElementsApply(
          this.db,
          tx,
          this.spaceId,
          claims,
          command,
          operationId,
          this.now(),
        ) as OperationResult,
      );
      this.clearCanvasLastError(claims);

      // Publish realtime event so frontend updates immediately
      const feedback = result as CanvasMutationFeedback;
      if (feedback.canvasId && feedback.sequence !== undefined) {
        void publish(this.spaceId, {
          type: "canvas:changed",
          canvasId: feedback.canvasId,
          sequence: feedback.sequence,
          revision: feedback.revision,
        }).catch((error) => {
          console.error("Failed to publish canvas:changed event", error);
        });
      }

      return result;
    } catch (error) {
      this.recordCanvasLastError(claims, error);
      mapCanvasToolError(error);
    }
  }

  canvasSceneSummary(claims: TurnCapabilityClaims, command: CanvasSceneSummaryCommand) {
    try {
      return this.db.transaction((tx) => {
        this.assertLiveCapabilityInTransaction(tx, claims, "canvas.read");
        return executeCanvasSceneSummary(this.db, tx, this.spaceId, claims, command, this.now());
      });
    } catch (error) {
      mapCanvasToolError(error);
    }
  }

  canvasCreateFrame(claims: TurnCapabilityClaims, command: CanvasCreateFrameCommand): CanvasMutationFeedback {
    return this.canvasTypedWrite(claims, "canvas.create_frame", command);
  }

  canvasCreateText(claims: TurnCapabilityClaims, command: CanvasCreateTextCommand): CanvasMutationFeedback {
    return this.canvasTypedWrite(claims, "canvas.create_text", command);
  }

  canvasCreateShape(claims: TurnCapabilityClaims, command: CanvasCreateShapeCommand): CanvasMutationFeedback {
    return this.canvasTypedWrite(claims, "canvas.create_shape", command);
  }

  canvasCreateImage(claims: TurnCapabilityClaims, command: CanvasCreateImageCommand): CanvasMutationFeedback {
    return this.canvasTypedWrite(claims, "canvas.create_image", command);
  }

  canvasUpdateNode(claims: TurnCapabilityClaims, command: CanvasUpdateNodeCommand): CanvasMutationFeedback {
    return this.canvasTypedWrite(claims, "canvas.update_node", command);
  }

  canvasDeleteNodes(claims: TurnCapabilityClaims, command: CanvasDeleteNodesCommand): CanvasMutationFeedback {
    return this.canvasTypedWrite(claims, "canvas.delete_nodes", command);
  }

  canvasUpdateFrame(claims: TurnCapabilityClaims, command: CanvasUpdateFrameCommand): CanvasMutationFeedback {
    return this.canvasTypedWrite(claims, "canvas.update_frame", command);
  }

  canvasAlignNodes(claims: TurnCapabilityClaims, command: CanvasAlignNodesCommand): CanvasMutationFeedback {
    return this.canvasTypedWrite(claims, "canvas.align_nodes", command);
  }

  canvasDistributeNodes(claims: TurnCapabilityClaims, command: CanvasDistributeNodesCommand): CanvasMutationFeedback {
    return this.canvasTypedWrite(claims, "canvas.distribute_nodes", command);
  }

  canvasReorderNodes(claims: TurnCapabilityClaims, command: CanvasReorderNodesCommand): CanvasMutationFeedback {
    return this.canvasTypedWrite(claims, "canvas.reorder_nodes", command);
  }

  canvasGroupNodes(claims: TurnCapabilityClaims, command: CanvasGroupNodesCommand): CanvasMutationFeedback {
    return this.canvasTypedWrite(claims, "canvas.group_nodes", command);
  }

  canvasUngroupNodes(claims: TurnCapabilityClaims, command: CanvasUngroupNodesCommand): CanvasMutationFeedback {
    return this.canvasTypedWrite(claims, "canvas.ungroup_nodes", command);
  }

  canvasDuplicateNodes(claims: TurnCapabilityClaims, command: CanvasDuplicateNodesCommand): CanvasMutationFeedback {
    return this.canvasTypedWrite(claims, "canvas.duplicate_nodes", command);
  }

  canvasFlipNodes(claims: TurnCapabilityClaims, command: CanvasFlipNodesCommand): CanvasMutationFeedback {
    return this.canvasTypedWrite(claims, "canvas.flip_nodes", command);
  }

  canvasBooleanOp(claims: TurnCapabilityClaims, command: CanvasBooleanOpCommand): CanvasMutationFeedback {
    return this.canvasTypedWrite(claims, "canvas.boolean_op", command);
  }

  canvasSetCanvasBackground(claims: TurnCapabilityClaims, command: CanvasSetCanvasBackgroundCommand): CanvasMutationFeedback {
    return this.canvasTypedWrite(claims, "canvas.set_canvas_background", command);
  }

  private canvasTypedWrite(
    claims: TurnCapabilityClaims,
    toolName: Exclude<CanvasTypedToolName, "canvas.scene_summary">,
    command: CanvasTypedMutationCommand,
  ): CanvasMutationFeedback {
    try {
      const result = this.operation(
        claims,
        toolName,
        command.idempotencyKey,
        command,
        "canvas:apply",
        "canvas.write",
        (tx, operationId) => executeCanvasTypedMutation(
          this.db,
          tx,
          this.spaceId,
          claims,
          toolName,
          command,
          operationId,
          this.now(),
        ) as OperationResult,
      ) as CanvasMutationFeedback;
      this.clearCanvasLastError(claims);

      // Publish realtime event so frontend updates immediately
      if (result.canvasId && result.sequence !== undefined) {
        void publish(this.spaceId, {
          type: "canvas:changed",
          canvasId: result.canvasId,
          sequence: result.sequence,
          revision: result.revision,
        }).catch((error) => {
          console.error("Failed to publish canvas:changed event", error);
        });
      }

      return result;
    } catch (error) {
      this.recordCanvasLastError(claims, error);
      mapCanvasToolError(error);
    }
  }

  private recordCanvasLastError(claims: TurnCapabilityClaims, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    try {
      this.db.transaction((tx) => {
        const existing = tx.select().from(schema.turnOperations).where(and(
          eq(schema.turnOperations.turnId, claims.turnId),
          eq(schema.turnOperations.toolName, CANVAS_LAST_ERROR_TOOL),
          eq(schema.turnOperations.idempotencyKey, CANVAS_LAST_ERROR_KEY),
        )).get();
        const now = new Date(this.now());
        if (existing) {
          tx.update(schema.turnOperations).set({
            status: "failed",
            errorCode: message,
            requestHash: hash({ error: message }),
            updatedAt: now,
          }).where(eq(schema.turnOperations.id, existing.id)).run();
          return;
        }
        tx.insert(schema.turnOperations).values({
          id: randomUUID(),
          turnId: claims.turnId,
          toolName: CANVAS_LAST_ERROR_TOOL,
          idempotencyKey: CANVAS_LAST_ERROR_KEY,
          requestHash: hash({ error: message }),
          operationSlot: "canvas:last_error",
          status: "failed",
          errorCode: message,
        }).run();
      });
    } catch {
      // Persistence of LAST_ERROR must not replace the original tool failure.
    }
  }

  private clearCanvasLastError(claims: TurnCapabilityClaims): void {
    try {
      this.db.update(schema.turnOperations).set({
        status: "committed",
        errorCode: null,
        updatedAt: new Date(this.now()),
      }).where(and(
        eq(schema.turnOperations.turnId, claims.turnId),
        eq(schema.turnOperations.toolName, CANVAS_LAST_ERROR_TOOL),
      )).run();
    } catch {
      // ignore
    }
  }

  canvasExport(claims: TurnCapabilityClaims, command: CanvasExportCommand) {
    try {
      return this.operation(
        claims,
        "canvas.export",
        command.idempotencyKey,
        {
          snapshotId: command.snapshotId,
          canvasId: command.canvasId ?? null,
        },
        "canvas:export",
        "canvas.export",
        (tx) => executeCanvasExport(tx, claims, command, this.now()) as OperationResult,
      );
    } catch (error) {
      mapCanvasToolError(error);
    }
  }

  canvasContextBundleCreate(claims: TurnCapabilityClaims, command: CanvasContextBundleCreateCommand) {
    try {
      return this.operation(
        claims,
        "canvas.context_bundle_create",
        command.idempotencyKey,
        {
          snapshotId: command.snapshotId,
          canvasId: command.canvasId ?? null,
        },
        "canvas:bundle",
        "canvas.read",
        (tx) => executeCanvasContextBundleCreate(tx, claims, command, this.now()) as OperationResult,
      );
    } catch (error) {
      mapCanvasToolError(error);
    }
  }

  canvasAssetImport(claims: TurnCapabilityClaims, command: CanvasAssetImportCommand): OperationResult {
    try {
      return this.operation(
        claims,
        "canvas.asset_import",
        command.idempotencyKey,
        {
          canvasId: command.canvasId ?? null,
          snapshotId: command.snapshotId ?? null,
          attachmentId: command.attachmentId ?? null,
          assetId: command.assetId ?? null,
          url: command.url ?? null,
          dataUrl: command.dataUrl ?? null,
        },
        "canvas:import",
        "canvas.import",
        (tx) => executeCanvasAssetImport(this.db, tx, this.spaceId, claims, command, this.now()),
      );
    } catch (error) {
      mapCanvasToolError(error);
    }
  }

  observeTransport(claims: TurnCapabilityClaims, transport: "cli" | "mcp"): void {
    this.db.transaction((tx) => {
      this.assertLiveCapabilityInTransaction(tx, claims, "capability.describe");
      const declared = this.declaredCapabilityMode(claims);
      const capabilityMode = transport === "mcp" ? "mcp" : declared === "cli_only" ? "cli_only" : "cli_fallback";
      tx.insert(schema.agentTurnEvents).values({
        attemptId: claims.attemptId,
        ordinal: -1_000_000_000,
        kind: "gateway_transport",
        payload: { transport, capabilityMode },
      }).onConflictDoUpdate({
        target: [schema.agentTurnEvents.attemptId, schema.agentTurnEvents.ordinal],
        set: {
          kind: "gateway_transport",
          payload: { transport, capabilityMode },
          createdAt: new Date(this.now()),
        },
      }).run();
    });
  }

  private capabilityMode(claims: TurnCapabilityClaims): string {
    const observed = this.db.select({ payload: schema.agentTurnEvents.payload }).from(schema.agentTurnEvents).where(and(
      eq(schema.agentTurnEvents.attemptId, claims.attemptId),
      eq(schema.agentTurnEvents.kind, "gateway_transport"),
    )).orderBy(asc(schema.agentTurnEvents.ordinal)).get();
    if (typeof observed?.payload.capabilityMode === "string") return observed.payload.capabilityMode;
    const declared = this.declaredCapabilityMode(claims);
    return declared ? `configured:${declared}` : "unknown";
  }

  private declaredCapabilityMode(claims: TurnCapabilityClaims): string | null {
    const started = this.db.select({ payload: schema.agentTurnEvents.payload }).from(schema.agentTurnEvents).where(and(
      eq(schema.agentTurnEvents.attemptId, claims.attemptId), eq(schema.agentTurnEvents.kind, "turn_started"),
    )).get();
    return typeof started?.payload.capabilityMode === "string" ? started.payload.capabilityMode : null;
  }

  private projectMessage(claims: TurnCapabilityClaims, message: typeof schema.messages.$inferSelect) {
    if (this.projectionFor(claims, message.channelId) === "canonical") return { ...message, projection: "canonical" as const };
    return {
      id: message.id,
      seq: message.seq,
      channelId: message.channelId,
      createdAt: message.createdAt,
      projection: "ref_only" as const,
      content: null,
      searchText: null,
      senderType: null,
      senderId: null,
      senderName: null,
    };
  }

  private projectionFor(claims: TurnCapabilityClaims, sourceChannelId: string): "canonical" | "ref_only" {
    const session = this.db.select({ surfaceId: schema.runtimeSessions.surfaceId }).from(schema.runtimeSessions)
      .where(eq(schema.runtimeSessions.id, claims.sessionId)).get();
    if (!session) throw new HarnessError("capability_inactive", "turn session is unavailable");
    const disclosureRoot = (channelId: string): { rootId: string; public: boolean } => {
      const channel = this.db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
      if (!channel) return { rootId: channelId, public: false };
      if (channel.type !== "thread" || !channel.parentMessageId) return { rootId: channel.id, public: channel.type === "channel" };
      const parent = this.db.select({ channelId: schema.messages.channelId }).from(schema.messages)
        .where(eq(schema.messages.id, channel.parentMessageId)).get();
      if (!parent) return { rootId: channel.id, public: false };
      const root = this.db.select({ type: schema.channels.type }).from(schema.channels).where(eq(schema.channels.id, parent.channelId)).get();
      return { rootId: parent.channelId, public: root?.type === "channel" };
    };
    const source = disclosureRoot(sourceChannelId);
    const target = disclosureRoot(session.surfaceId);
    return source.public || source.rootId === target.rootId ? "canonical" : "ref_only";
  }

  private operation(
    claims: TurnCapabilityClaims,
    toolName: string,
    idempotencyKey: string,
    request: unknown,
    slot: string,
    scope: GatewayScope,
    execute: (tx: SpaceTransaction, operationId: string) => OperationResult,
  ): OperationResult {
    this.assertClaims(claims);
    const requestHash = hash(request);
    return this.db.transaction((tx) => {
      this.assertLiveCapabilityInTransaction(tx, claims, scope);
      const prior = tx.select().from(schema.turnOperations).where(and(
        eq(schema.turnOperations.turnId, claims.turnId),
        eq(schema.turnOperations.toolName, toolName),
        eq(schema.turnOperations.idempotencyKey, idempotencyKey),
      )).get();
      if (prior) {
        if (prior.requestHash !== requestHash) throw new HarnessError("idempotency_conflict", "idempotency key was reused with a different request");
        if (prior.status === "committed" && prior.resultRef) return prior.resultRef;
        throw new HarnessError("idempotency_conflict", "operation is incomplete and requires reconciliation");
      }
      const operation = tx.insert(schema.turnOperations).values({
        id: randomUUID(), turnId: claims.turnId, toolName, idempotencyKey, requestHash, operationSlot: slot, status: "pending",
      }).returning().get();
      const result = execute(tx, operation.id);
      tx.update(schema.turnOperations).set({ status: "committed", resultRef: result, updatedAt: new Date(this.now()) })
        .where(eq(schema.turnOperations.id, operation.id)).run();
      return result;
    });
  }

  private async externalOperation(
    claims: TurnCapabilityClaims,
    toolName: string,
    idempotencyKey: string,
    request: unknown,
    slot: string,
    handlers: {
      reconcile: (operationId: string) => OperationResult | null;
      execute: (operationId: string) => Promise<OperationResult>;
    },
  ): Promise<OperationResult> {
    this.assertClaims(claims);
    const requestHash = hash(request);
    const flightKey = `${claims.turnId}\u0000${toolName}\u0000${idempotencyKey}`;
    const active = this.externalInFlight.get(flightKey);
    if (active) {
      if (active.requestHash !== requestHash) {
        throw new HarnessError("idempotency_conflict", "idempotency key was reused with a different request");
      }
      return active.promise;
    }
    const promise = this.runExternalOperation(claims, toolName, idempotencyKey, requestHash, slot, handlers);
    this.externalInFlight.set(flightKey, { requestHash, promise });
    try {
      return await promise;
    } finally {
      if (this.externalInFlight.get(flightKey)?.promise === promise) this.externalInFlight.delete(flightKey);
    }
  }

  private async runExternalOperation(
    claims: TurnCapabilityClaims,
    toolName: string,
    idempotencyKey: string,
    requestHash: string,
    slot: string,
    handlers: {
      reconcile: (operationId: string) => OperationResult | null;
      execute: (operationId: string) => Promise<OperationResult>;
    },
  ): Promise<OperationResult> {
    const prior = this.db.transaction((tx) => {
      this.assertLiveCapabilityInTransaction(tx, claims, "task.write");
      return tx.select().from(schema.turnOperations).where(and(
        eq(schema.turnOperations.turnId, claims.turnId),
        eq(schema.turnOperations.toolName, toolName),
        eq(schema.turnOperations.idempotencyKey, idempotencyKey),
      )).get();
    });
    if (prior?.requestHash !== undefined && prior.requestHash !== requestHash) {
      throw new HarnessError("idempotency_conflict", "idempotency key was reused with a different request");
    }
    if (prior?.status === "committed" && prior.resultRef) return prior.resultRef;
    const operation = prior ?? this.db.transaction((tx) => {
      this.assertLiveCapabilityInTransaction(tx, claims, "task.write");
      const raced = tx.select().from(schema.turnOperations).where(and(
        eq(schema.turnOperations.turnId, claims.turnId),
        eq(schema.turnOperations.toolName, toolName),
        eq(schema.turnOperations.idempotencyKey, idempotencyKey),
      )).get();
      if (raced) return raced;
      return tx.insert(schema.turnOperations).values({
        id: randomUUID(), turnId: claims.turnId, toolName, idempotencyKey, requestHash, operationSlot: slot, status: "pending",
      }).returning().get();
    });
    if (operation.requestHash !== requestHash) {
      throw new HarnessError("idempotency_conflict", "idempotency key was reused with a different request");
    }
    if (operation.status === "committed" && operation.resultRef) return operation.resultRef;
    const reconciled = handlers.reconcile(operation.id);
    if (reconciled) {
      this.db.update(schema.turnOperations).set({ status: "committed", resultRef: reconciled, errorCode: null, updatedAt: new Date(this.now()) })
        .where(eq(schema.turnOperations.id, operation.id)).run();
      return reconciled;
    }
    try {
      const result = await handlers.execute(operation.id);
      this.db.update(schema.turnOperations).set({ status: "committed", resultRef: result, errorCode: null, updatedAt: new Date(this.now()) })
        .where(eq(schema.turnOperations.id, operation.id)).run();
      return result;
    } catch (error) {
      this.db.update(schema.turnOperations).set({ status: "failed", errorCode: this.operationErrorCode(error), updatedAt: new Date(this.now()) })
        .where(eq(schema.turnOperations.id, operation.id)).run();
      if (isTaskOperationError(error)) {
        throw new HarnessError(error.code === "NOT_FOUND" ? "capability_scope_denied" : "idempotency_conflict", error.message, {
          taskCode: error.code, ...(error.current ? { current: error.current } : {}),
        });
      }
      throw error;
    }
  }

  private operationErrorCode(error: unknown): string {
    if (isTaskOperationError(error)) return `task_${error.code.toLowerCase()}`;
    if (error instanceof HarnessError) return error.code;
    return "task_operation_failed";
  }

  private resolveChannel(claims: TurnCapabilityClaims, reference: string): string {
    const raw = reference.trim();
    const channel = this.db.select().from(schema.channels).where(and(
      eq(schema.channels.spaceId, this.spaceId),
      raw.startsWith("#") ? eq(schema.channels.name, raw.slice(1)) : eq(schema.channels.id, raw),
    )).get();
    if (!channel) throw new HarnessError("capability_scope_denied", "task channel is unavailable");
    this.assertSurfaceAccess(claims, channel.id);
    return channel.id;
  }

  private resolveTaskId(claims: TurnCapabilityClaims, reference: string): string {
    const raw = reference.trim().toLowerCase();
    const full = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(raw);
    if (!full && !/^[0-9a-f]{6,}$/.test(raw)) {
      throw new HarnessError("capability_scope_denied", "task reference is invalid");
    }
    const task = this.db.select().from(schema.messages).where(and(
      eq(schema.messages.spaceId, this.spaceId),
      full ? eq(schema.messages.id, raw) : like(schema.messages.id, `${raw}%`),
      isNotNull(schema.messages.taskStatus),
    )).limit(1).get();
    if (!task) throw new HarnessError("capability_scope_denied", "task is unavailable");
    this.assertSurfaceAccess(claims, task.channelId);
    return task.id;
  }

  private taskMutationResult(
    taskId: string,
    matches: (task: typeof schema.messages.$inferSelect) => boolean,
  ): OperationResult | null {
    const task = this.db.select().from(schema.messages).where(eq(schema.messages.id, taskId)).get();
    return task && matches(task) ? this.taskResult(task) : null;
  }

  private taskResult(task: typeof schema.messages.$inferSelect): OperationResult {
    return {
      taskId: task.id,
      number: task.taskNumber,
      status: task.taskStatus,
      revision: task.taskRevision,
      assigneeId: task.taskAssigneeId,
      threadId: task.threadId,
    };
  }

  private agentActor(agentId: string): { type: "agent"; id: string; name: string } {
    const agent = this.db.select().from(schema.agents).where(and(
      eq(schema.agents.id, agentId), eq(schema.agents.spaceId, this.spaceId), isNull(schema.agents.deletedAt),
    )).get();
    if (!agent) throw new HarnessError("capability_scope_denied", "task actor is unavailable");
    return { type: "agent", id: agent.id, name: agent.name };
  }

  writePrecondition(claims: TurnCapabilityClaims, scope: GatewayScope) {
    return (tx: SpaceTransaction, channelId: string): void => {
      this.assertLiveCapabilityInTransaction(tx, claims, scope, channelId);
    };
  }

  private assertLiveCapabilityInTransaction(
    tx: SpaceTransaction,
    claims: TurnCapabilityClaims,
    scope: GatewayScope,
    channelId?: string,
  ): void {
    const now = this.now();
    const activation = tx.select().from(schema.turnCapabilityActivations).where(eq(schema.turnCapabilityActivations.id, claims.activationId)).get();
    const attempt = tx.select().from(schema.agentTurnAttempts).where(eq(schema.agentTurnAttempts.id, claims.attemptId)).get();
    const turn = tx.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, claims.turnId)).get();
    const session = tx.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.id, claims.sessionId)).get();
    const agent = tx.select({ scopes: schema.agents.scopes }).from(schema.agents).where(and(
      eq(schema.agents.id, claims.agentId), isNull(schema.agents.deletedAt),
    )).get();
    if (!activation || activation.status !== "active" || activation.turnId !== claims.turnId || activation.attemptId !== claims.attemptId
      || !attempt || attempt.turnId !== claims.turnId || !["admitted", "running", "finalizing"].includes(attempt.status)
      || !turn || turn.status !== "running" || turn.runtimeSessionId !== claims.sessionId || turn.agentId !== claims.agentId
      || !session || session.agentId !== claims.agentId || session.retiredAt
      || session.sessionGeneration !== claims.sessionGeneration || attempt.workerGeneration !== claims.workerGeneration) {
      throw new HarnessError("capability_inactive", "Gateway capability is no longer active");
    }
    if (activation.expiresAt.getTime() <= now || attempt.leaseExpiresAt.getTime() <= now) {
      throw new HarnessError("capability_expired", "Gateway capability lease expired");
    }
    if (!claims.scopes.includes(scope)) throw new HarnessError("capability_scope_denied", `activation does not allow ${scope}`);
    if (requiredAgentScopes(scope).some((required) => !agentHasScope(agent?.scopes, required))) {
      throw new HarnessError("capability_scope_denied", `${scope} is no longer granted`);
    }
    const targetChannelId = channelId ?? session.surfaceId;
    if (!claims.allowedOutputSurfaceIds.includes(session.surfaceId)) {
      throw new HarnessError("capability_scope_denied", "Gateway output surface is outside the activation");
    }
    assertAgentSurfaceAccessInTransaction(tx, {
      spaceId: this.spaceId, channelId: targetChannelId, agentId: claims.agentId, now,
    });
  }

  private auditMessages(claims: TurnCapabilityClaims, messages: Array<typeof schema.messages.$inferSelect>, reason: string, watermarkChannelId?: string, throughSeq?: number): void {
    const turnId = claims.turnId;
    if (!messages.length && throughSeq === undefined) return;
    this.db.transaction((tx) => {
      const prior = tx.select().from(schema.turnContextSources).where(and(
        eq(schema.turnContextSources.turnId, turnId),
        eq(schema.turnContextSources.phase, "later_query"),
      )).all();
      const existing = new Set(prior.filter((row) => row.sourceKind === "message").map((row) => row.sourceId));
      let ordinal = prior.reduce((max, row) => Math.max(max, row.ordinal), -1) + 1;
      for (const message of messages) {
        if (existing.has(message.id)) continue;
        const channel = tx.select().from(schema.channels).where(eq(schema.channels.id, message.channelId)).get();
        const projection = this.projectionFor(claims, message.channelId);
        tx.insert(schema.turnContextSources).values({
          id: randomUUID(), turnId, phase: "later_query", ordinal: ordinal++, sourceKind: "message", sourceId: message.id,
          sourceRevision: message.seq, visibility: channel?.type === "channel" ? "public" : channel?.type === "dm" ? "dm" : "private",
          disclosureProjection: projection, injectionMode: projection === "canonical" ? "content" : "reference", reason,
          tokenEstimate: projection === "canonical" ? Math.max(1, Math.ceil(message.content.length / 4)) : 0,
          contentHmac: createHmac("sha256", this.hmacKey).update(canonicalJson({ id: message.id, seq: message.seq, content: message.content })).digest("hex"),
        }).run();
      }
      if (watermarkChannelId && throughSeq !== undefined) {
        const existingWatermark = prior.some((row) => row.sourceKind === "surface_watermark"
          && row.sourceId === watermarkChannelId && row.sourceRevision === throughSeq);
        if (!existingWatermark) tx.insert(schema.turnContextSources).values({
          id: randomUUID(), turnId, phase: "later_query", ordinal, sourceKind: "surface_watermark", sourceId: watermarkChannelId,
          sourceRevision: throughSeq, visibility: "private", disclosureProjection: "ref_only", injectionMode: "reference",
          reason: "context_refresh_watermark", tokenEstimate: 0,
          contentHmac: createHmac("sha256", this.hmacKey).update(`${watermarkChannelId}:${throughSeq}`).digest("hex"),
        }).run();
      }
    });
  }

  private auditMemories(
    claims: TurnCapabilityClaims,
    memories: Array<(RecalledMemory | RecalledUserGlobalMemory) & { scope: "workspace" | "user_global" }>,
    reason: string,
  ): void {
    if (!memories.length) return;
    this.db.transaction((tx) => {
      const prior = tx.select().from(schema.turnContextSources).where(and(
        eq(schema.turnContextSources.turnId, claims.turnId),
        eq(schema.turnContextSources.phase, "later_query"),
      )).all();
      const existing = new Set(prior.filter((row) => row.sourceKind === "memory" || row.sourceKind === "user_global_memory")
        .map((row) => `${row.sourceKind}:${row.sourceId}:${row.sourceRevision}`));
      let ordinal = prior.reduce((max, row) => Math.max(max, row.ordinal), -1) + 1;
      for (const memory of memories) {
        const sourceKind = memory.scope === "workspace" ? "memory" : "user_global_memory";
        const key = `${sourceKind}:${memory.memoryId}:${memory.memoryRevision}`;
        if (existing.has(key)) continue;
        tx.insert(schema.turnContextSources).values({
          id: randomUUID(), turnId: claims.turnId, phase: "later_query", ordinal: ordinal++, sourceKind,
          sourceId: memory.memoryId, sourceRevision: memory.memoryRevision, visibility: "private",
          disclosureProjection: memory.projection, injectionMode: memory.content == null ? "reference" : "content",
          reason, tokenEstimate: memory.content == null ? 0 : Math.max(1, Math.ceil(memory.content.length / 4)),
          contentHmac: memory.contentHash,
        }).run();
      }
    });
  }

  private targetSurfaceId(claims: TurnCapabilityClaims): string {
    const session = this.db.select({ surfaceId: schema.runtimeSessions.surfaceId }).from(schema.runtimeSessions)
      .where(eq(schema.runtimeSessions.id, claims.sessionId)).get();
    if (!session) throw new HarnessError("capability_inactive", "turn session is unavailable");
    return session.surfaceId;
  }

  private memoryHarnessError(error: unknown): Error {
    if (!(error instanceof MemoryError)) return error instanceof Error ? error : new Error(String(error));
    return new HarnessError(
      error.code === "MEMORY_NOT_FOUND" ? "capability_scope_denied" : "disclosure_denied",
      error.message,
      { memoryCode: error.code },
    );
  }

  private assertClaims(claims: TurnCapabilityClaims): void {
    if (claims.spaceId !== this.spaceId) throw new HarnessError("capability_scope_denied", "activation belongs to another Space");
  }

  private assertSurfaceAccess(claims: TurnCapabilityClaims, channelId: string): void {
    this.assertClaims(claims);
    const allowed = this.db.transaction((tx) => hasAgentSurfaceAccessInTransaction(tx, {
      spaceId: this.spaceId, channelId, agentId: claims.agentId, now: this.now(),
    }));
    if (!allowed) throw new HarnessError("disclosure_denied", "conversation is outside current Agent access", { channelId });
  }
}
