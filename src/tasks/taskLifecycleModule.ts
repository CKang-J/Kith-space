import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { decideAgentMessageResponse } from "../agents/agentResponseDelivery.js";
import { assertChannelWritable } from "../channels/channelLifecycle.js";
import type { ThreadModule } from "../channels/threadModule.js";
import { nextSeq } from "../counters.js";
import { dbForSpace, schema } from "../db/index.js";
import { getHumanIdentity, humanIdentityForId } from "../human/humanIdentity.js";
import { humanChannelState } from "../human/humanChannelState.js";
import { persistedMessageMention, serializeMessage } from "../messages/messageSerialization.js";
import {
  assignTaskRecord,
  claimTaskRecord,
  convertMessageRecord,
  transitionTaskRecord,
  unclaimTaskRecord,
  type TaskAuditWrite,
  type TaskDispatchChainInsert,
} from "./taskRepository.js";
import { isTaskStatus, TaskOperationError, type TaskStatus } from "./taskTypes.js";

type ActorRef = { type: "human" | "agent"; id: string };
type TaskExecutionMode = "autopilot" | "plan-first";
type Message = typeof schema.messages.$inferSelect;
type Agent = typeof schema.agents.$inferSelect;

export interface TaskAuditDispatchContext {
  chainId: string;
  dispatchDepth: number;
  taskMessageId: string;
}

export interface TaskLifecycleWakePort {
  prepare(input: {
    spaceId: string;
    messageId: string;
    channelId: string;
    senderType: "human" | "agent" | "system";
    senderId: string | null;
    taskMessageId: string;
  }): Promise<TaskAuditDispatchContext>;
  dispatch(input: {
    spaceId: string;
    dispatch: TaskAuditDispatchContext;
    audit: Message;
    task: Message;
    target: Agent;
    from: string;
    content: string;
    responseDirective: "required" | "optional";
    responseReason: string;
  }): Promise<void>;
}

export interface TaskLifecycleDependencies {
  eventSink: { publish(spaceId: string, event: unknown): Promise<void> };
  threads: ThreadModule;
  wake: TaskLifecycleWakePort;
  onPostCommitError?(operation: string, error: unknown): void;
}

export interface TaskLifecycleModule {
  convertMessage(
    spaceId: string,
    messageId: string,
    by?: ActorRef,
    executionMode?: TaskExecutionMode,
  ): Promise<Message | null>;
  claim(
    spaceId: string,
    messageId: string,
    assigneeType: "human" | "agent",
    assigneeId: string,
    expectedRevision?: number,
  ): Promise<Message | null>;
  unclaim(spaceId: string, messageId: string, by?: ActorRef, expectedRevision?: number): Promise<Message | null>;
  assign(spaceId: string, messageId: string, assigneeId: string, by?: ActorRef, expectedRevision?: number): Promise<Message | null>;
  setExecutionMode(spaceId: string, messageId: string, mode: TaskExecutionMode): Promise<Message | null>;
  setStatus(
    spaceId: string,
    messageId: string,
    status: string,
    by?: ActorRef,
    concurrency?: { from?: TaskStatus; expectedRevision?: number },
  ): Promise<Message | null>;
  delete(spaceId: string, messageId: string): Promise<Message | null>;
}

const STATUS_LABEL: Record<string, string> = {
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  closed: "Closed",
};
const STATUS_EMOJI: Record<string, string> = { in_progress: "🔄", in_review: "👁" };

function taskTitle(content: string): string {
  const title = ((content || "").split("\n")[0] ?? "").trim();
  return title.length > 40 ? `${title.slice(0, 40)}…` : title;
}

export function createTaskLifecycleModule(dependencies: TaskLifecycleDependencies): TaskLifecycleModule {
  const { eventSink, threads, wake } = dependencies;

  async function runPostCommit(operation: string, callback: () => Promise<void>): Promise<void> {
    try {
      await callback();
    } catch (error) {
      dependencies.onPostCommitError?.(operation, error);
    }
  }

  async function actorName(spaceId: string, actor: ActorRef | undefined): Promise<string> {
    if (!actor) return "Someone";
    if (actor.type === "human") return humanIdentityForId(actor.id)?.displayName ?? "someone";
    const agent = dbForSpace(spaceId).select().from(schema.agents)
      .where(eq(schema.agents.id, actor.id)).get();
    return agent?.displayName || agent?.name || "agent";
  }

  async function assertMessageWritable(spaceId: string, messageId: string): Promise<Message | null> {
    const message = dbForSpace(spaceId).select().from(schema.messages).where(and(
      eq(schema.messages.id, messageId),
      eq(schema.messages.spaceId, spaceId),
    )).get() ?? null;
    if (!message) return null;
    await assertChannelWritable(spaceId, message.channelId);
    return message;
  }

  async function taskMentions(spaceId: string, messageId: string) {
    return dbForSpace(spaceId).select().from(schema.messageMentions)
      .where(eq(schema.messageMentions.messageId, messageId)).all()
      .map(persistedMessageMention);
  }

  async function publishTask(spaceId: string, operation: "created" | "updated", task: Message): Promise<void> {
    await eventSink.publish(spaceId, {
      type: "task",
      op: operation,
      task: serializeMessage(task, await taskMentions(spaceId, task.id)),
    });
  }

  async function publishThreadUpdate(spaceId: string, audit: Message, actor?: ActorRef): Promise<void> {
    const db = dbForSpace(spaceId);
    const channel = db.select().from(schema.channels).where(eq(schema.channels.id, audit.channelId)).get();
    if (channel?.type !== "thread" || !channel.parentMessageId) return;
    const replies = db.select({ id: schema.messages.id }).from(schema.messages)
      .where(eq(schema.messages.channelId, channel.id)).all();
    const participants = db.select({ id: schema.channelAgentMembers.agentId }).from(schema.channelAgentMembers)
      .where(eq(schema.channelAgentMembers.channelId, channel.id)).all();
    const humanState = await humanChannelState(spaceId, channel.id);
    const parent = db.select({ channelId: schema.messages.channelId }).from(schema.messages)
      .where(eq(schema.messages.id, channel.parentMessageId)).get();
    await eventSink.publish(spaceId, {
      type: "thread:updated",
      threadChannelId: channel.id,
      parentMessageId: channel.parentMessageId,
      parentChannelId: parent?.channelId ?? null,
      replyCount: replies.length,
      participantIds: [
        ...participants.map((participant) => participant.id),
        ...(humanState?.threadFollowedAt
          ? [getHumanIdentity()?.id].filter((id): id is string => Boolean(id))
          : []),
      ],
      senderId: actor?.id ?? null,
      senderType: "system",
    });
  }

  async function publishAudit(spaceId: string, audit: Message, actor?: ActorRef): Promise<void> {
    const channel = dbForSpace(spaceId).select().from(schema.channels)
      .where(eq(schema.channels.id, audit.channelId)).get();
    await eventSink.publish(spaceId, {
      type: "message",
      channelId: audit.channelId,
      message: { ...serializeMessage(audit, [], []), channelType: channel?.type ?? null },
    });
    await publishThreadUpdate(spaceId, audit, actor);
  }

  function systemAudit(input: {
    id: string;
    seq: number;
    spaceId: string;
    channelId: string;
    content: string;
    actor?: ActorRef;
    dispatch?: TaskAuditDispatchContext;
    taskMessageId?: string;
    membershipAgentId?: string | null;
  }): TaskAuditWrite {
    const message = {
      id: input.id,
      seq: input.seq,
      spaceId: input.spaceId,
      channelId: input.channelId,
      senderType: "system",
      senderId: input.actor?.id ?? null,
      senderName: "system",
      messageType: "system",
      content: input.content,
      searchText: input.content,
      dispatchChainId: input.dispatch?.chainId ?? null,
      dispatchDepth: input.dispatch?.dispatchDepth ?? null,
    } satisfies typeof schema.messages.$inferInsert;
    const dispatchChain: TaskDispatchChainInsert | undefined = input.dispatch && input.taskMessageId
      ? {
          id: input.dispatch.chainId,
          spaceId: input.spaceId,
          rootMessageId: input.id,
          taskMessageId: input.taskMessageId,
          channelId: input.channelId,
          dispatchDepth: input.dispatch.dispatchDepth,
        }
      : undefined;
    return {
      message,
      dispatchChain,
      agentMembership: input.membershipAgentId
        ? { channelId: input.channelId, agentId: input.membershipAgentId, watermark: input.seq - 1 }
        : undefined,
    };
  }

  return {
    async convertMessage(spaceId, messageId, by, executionMode = "autopilot") {
      if (!(await assertMessageWritable(spaceId, messageId))) return null;
      const auditSeed = { id: randomUUID(), seq: await nextSeq(spaceId) };
      const name = await actorName(spaceId, by);
      const result = convertMessageRecord({
        spaceId,
        messageId,
        executionMode,
        audit: (task) => systemAudit({
          ...auditSeed,
          spaceId,
          channelId: task.channelId,
          content: `${name} converted a message to task #${task.taskNumber} "${taskTitle(task.content)}"`,
          actor: by,
        }),
      });
      if (!result) return null;
      if (!result.changed) return result.task;
      await runPostCommit("publish converted task", () => publishTask(spaceId, "created", result.task));
      if (result.audit) await runPostCommit("publish conversion audit", () => publishAudit(spaceId, result.audit!, by));
      return result.task;
    },

    async claim(spaceId, messageId, assigneeType, assigneeId, expectedRevision) {
      if (!(await assertMessageWritable(spaceId, messageId))) return null;
      const auditSeed = { id: randomUUID(), seq: await nextSeq(spaceId) };
      const actor = { type: assigneeType, id: assigneeId } as ActorRef;
      const name = await actorName(spaceId, actor);
      const result = claimTaskRecord({
        spaceId,
        messageId,
        assigneeType,
        assigneeId,
        expectedRevision,
        audit: (task) => systemAudit({
          ...auditSeed,
          spaceId,
          channelId: task.channelId,
          content: `${name} claimed #${task.taskNumber} "${taskTitle(task.content)}"`,
          actor,
        }),
      });
      if (!result) return null;
      if (!result.changed) return result.task;
      await runPostCommit("publish claimed task", () => publishTask(spaceId, "updated", result.task));
      if (result.audit) await runPostCommit("publish claim audit", () => publishAudit(spaceId, result.audit!, actor));
      return result.task;
    },

    async unclaim(spaceId, messageId, by, expectedRevision) {
      if (!(await assertMessageWritable(spaceId, messageId))) return null;
      const auditSeed = { id: randomUUID(), seq: await nextSeq(spaceId) };
      const name = await actorName(spaceId, by);
      const result = unclaimTaskRecord({
        spaceId,
        messageId,
        by,
        expectedRevision,
        audit: (task) => systemAudit({
          ...auditSeed,
          spaceId,
          channelId: task.channelId,
          content: `${name} released #${task.taskNumber} "${taskTitle(task.content)}"`,
          actor: by,
        }),
      });
      if (!result) return null;
      if (!result.changed) return result.task;
      await runPostCommit("publish released task", () => publishTask(spaceId, "updated", result.task));
      if (result.audit) await runPostCommit("publish release audit", () => publishAudit(spaceId, result.audit!, by));
      return result.task;
    },

    async assign(spaceId, messageId, assigneeId, by, expectedRevision) {
      const db = dbForSpace(spaceId);
      const target = db.select().from(schema.agents).where(and(
        eq(schema.agents.id, assigneeId),
        eq(schema.agents.spaceId, spaceId),
        isNull(schema.agents.deletedAt),
      )).get();
      if (!target || !(await assertMessageWritable(spaceId, messageId))) return null;
      const thread = await threads.getOrCreateThread(spaceId, messageId);
      const auditSeed = { id: randomUUID(), seq: await nextSeq(spaceId) };
      const dispatch = await wake.prepare({
        spaceId,
        messageId: auditSeed.id,
        channelId: thread.id,
        senderType: by?.type ?? "system",
        senderId: by?.id ?? null,
        taskMessageId: messageId,
      });
      const name = await actorName(spaceId, by);
      const assigneeName = target.displayName || target.name;
      const result = assignTaskRecord({
        spaceId,
        messageId,
        assigneeId,
        by,
        expectedRevision,
        audit: (task) => systemAudit({
          ...auditSeed,
          spaceId,
          channelId: thread.id,
          content: `${name} assigned #${task.taskNumber} "${taskTitle(task.content)}" to ${assigneeName}`,
          actor: by,
          dispatch,
          taskMessageId: task.id,
          membershipAgentId: target.id,
        }),
      });
      if (!result) return null;
      if (!result.changed) return result.task;
      if (!result.task.threadId) {
        db.update(schema.messages).set({ threadId: thread.id }).where(eq(schema.messages.id, result.task.id)).run();
        result.task.threadId = thread.id;
      }
      await runPostCommit("publish assigned task", () => publishTask(spaceId, "updated", result.task));
      if (result.audit) await runPostCommit("publish assignment audit", () => publishAudit(spaceId, result.audit!, by));
      if (result.audit) {
        const decision = decideAgentMessageResponse({
          agentId: target.id,
          channelType: "thread",
          senderType: "system",
          effectiveMode: target.defaultResponseMode,
          messageSeq: result.audit.seq,
          explicitTaskAssignment: true,
        });
        if (decision.wake && decision.directive !== "observe") {
          await runPostCommit("dispatch assignment wake", () => wake.dispatch({
            spaceId,
            dispatch,
            audit: result.audit!,
            task: result.task,
            target,
            from: name,
            content: `#${result.task.taskNumber} assigned to you`,
            responseDirective: decision.directive as "required" | "optional",
            responseReason: decision.reason,
          }));
        }
      }
      return result.task;
    },

    async setExecutionMode(spaceId, messageId, mode) {
      if (!(await assertMessageWritable(spaceId, messageId))) return null;
      const task = dbForSpace(spaceId).update(schema.messages).set({
        taskExecutionMode: mode,
        taskRevision: sql`${schema.messages.taskRevision} + 1`,
        updatedAt: new Date(),
      }).where(and(
        eq(schema.messages.id, messageId),
        eq(schema.messages.spaceId, spaceId),
        isNotNull(schema.messages.taskStatus),
      )).returning().get();
      if (!task) return null;
      await runPostCommit("publish execution mode", () => publishTask(spaceId, "updated", task));
      return task;
    },

    async setStatus(spaceId, messageId, status, by, concurrency = {}) {
      if (!isTaskStatus(status)) {
        throw new TaskOperationError("INVALID_TRANSITION", `invalid task status: ${status}`);
      }
      const db = dbForSpace(spaceId);
      const current = db.select().from(schema.messages).where(and(
        eq(schema.messages.id, messageId),
        eq(schema.messages.spaceId, spaceId),
        isNotNull(schema.messages.taskStatus),
      )).get();
      if (!current) return null;
      if (current.taskStatus === status) return current;
      await assertChannelWritable(spaceId, current.channelId);
      const thread = await threads.getOrCreateThread(spaceId, current.id);
      const auditSeed = { id: randomUUID(), seq: await nextSeq(spaceId) };
      const dispatch = await wake.prepare({
        spaceId,
        messageId: auditSeed.id,
        channelId: thread.id,
        senderType: by?.type ?? "system",
        senderId: by?.id ?? null,
        taskMessageId: current.id,
      });
      const name = await actorName(spaceId, by);
      const label = STATUS_LABEL[status] ?? status;
      const emoji = STATUS_EMOJI[status] ? `${STATUS_EMOJI[status]} ` : "";
      const content = `${emoji}${name} moved #${current.taskNumber} "${taskTitle(current.content)}" to ${label}`;
      const auditWrite = systemAudit({
        ...auditSeed,
        spaceId,
        channelId: thread.id,
        content,
        actor: by,
        dispatch,
        taskMessageId: current.id,
        membershipAgentId: current.taskAssigneeType === "agent" ? current.taskAssigneeId : null,
      });
      const result = transitionTaskRecord({
        spaceId,
        messageId,
        to: status,
        ...concurrency,
        audit: auditWrite.message,
        dispatchChain: auditWrite.dispatchChain,
        agentMembership: auditWrite.agentMembership,
      });
      if (!result) return null;
      if (!result.changed) return result.task;
      if (!result.task.threadId) {
        db.update(schema.messages).set({ threadId: thread.id }).where(eq(schema.messages.id, result.task.id)).run();
        result.task.threadId = thread.id;
      }
      await runPostCommit("publish task status", () => publishTask(spaceId, "updated", result.task));
      if (result.audit) await runPostCommit("publish status audit", () => publishAudit(spaceId, result.audit!, by));
      if (result.audit && result.task.taskAssigneeType === "agent" && result.task.taskAssigneeId
        && by?.id !== result.task.taskAssigneeId) {
        const target = db.select().from(schema.agents)
          .where(eq(schema.agents.id, result.task.taskAssigneeId)).get();
        if (target) {
          const decision = decideAgentMessageResponse({
            agentId: target.id,
            channelType: "thread",
            senderType: "system",
            effectiveMode: target.defaultResponseMode,
            messageSeq: result.audit.seq,
            explicitTaskAssignment: true,
          });
          if (decision.wake && decision.directive !== "observe") {
            await runPostCommit("dispatch status wake", () => wake.dispatch({
              spaceId,
              dispatch,
              audit: result.audit!,
              task: result.task,
              target,
              from: name,
              content: `#${result.task.taskNumber} → ${label}`,
              responseDirective: decision.directive as "required" | "optional",
              responseReason: decision.reason,
            }));
          }
        }
      }
      return result.task;
    },

    async delete(spaceId, messageId) {
      if (!(await assertMessageWritable(spaceId, messageId))) return null;
      const task = dbForSpace(spaceId).update(schema.messages).set({
        taskStatus: null,
        taskNumber: null,
        taskAssigneeType: null,
        taskAssigneeId: null,
        taskClaimedAt: null,
        taskCompletedAt: null,
        taskParentId: null,
        taskRevision: 0,
        updatedAt: new Date(),
      }).where(and(
        eq(schema.messages.id, messageId),
        eq(schema.messages.spaceId, spaceId),
        isNotNull(schema.messages.taskStatus),
      )).returning().get();
      if (!task) return null;
      await runPostCommit("publish deleted task", () => eventSink.publish(spaceId, {
        type: "task",
        op: "deleted",
        channelId: task.channelId,
        taskId: task.id,
      }));
      return task;
    },
  };
}
