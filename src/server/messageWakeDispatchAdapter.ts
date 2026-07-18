import type {
  ConversationEventSink,
  WakeDispatchInput,
  WakeDispatchPort,
} from "../messages/messagePostingModule.js";
import type { RuntimeWorkerPort, WakeStartCommand } from "../runtime/contract/runtimeWorkerPort.js";
import { WorkerAdmissionUncertainError } from "../local-runtime/workerHub.js";
import { SqliteDispatchState } from "./dispatchGuard.js";

export function createWakeDispatchPort<TTarget>(dependencies: {
  eventSink: ConversationEventSink;
  runtimeWorker: RuntimeWorkerPort;
  resolveTarget(spaceId: string, agentId: string): Promise<TTarget | { ok: false; reason: string }>;
  resolveTargets(spaceId: string, agentIds: string[]): Promise<ReadonlyMap<string, TTarget | { ok: false; reason: string }>>;
  isTarget(value: TTarget | { ok: false; reason: string }): value is TTarget;
  wakeStartCommand(target: TTarget, input: WakeDispatchInput, deliveryId: string): WakeStartCommand;
  markUnavailable(spaceId: string, agentId: string, reason: string): Promise<void>;
}): WakeDispatchPort {
  async function dispatchResolved(
    input: WakeDispatchInput,
    target: TTarget | { ok: false; reason: string },
  ) {
    const state = new SqliteDispatchState(input.spaceId);
    const reservation = await state.getOrReserveWake({
      ...input.dispatch,
      messageId: input.messageId,
      targetAgentId: input.targetAgent.id,
    });
    if (!reservation.allowed) {
      return {
        status: "blocked" as const,
        code: reservation.code,
        reason: reservation.reason,
        wakeCount: reservation.wakeCount,
      };
    }

    if (!dependencies.isTarget(target)) {
      await state.releaseWake(reservation.reservationId);
      if (target.reason !== "agent not found") {
        await dependencies.markUnavailable(input.spaceId, input.targetAgent.id, target.reason);
      }
      return { status: "unavailable" as const, reason: target.reason };
    }

    const streamId = input.delivery.streamId;
    if (input.delivery.responseDirective === "required" && streamId) {
      await dependencies.eventSink.publish(input.spaceId, {
        type: "agent:reply",
        agentId: input.targetAgent.id,
        channelId: input.delivery.target,
        streamId,
        name: input.targetAgent.displayName || input.targetAgent.name,
        triggerMessageId: input.messageId,
        op: "start",
      });
    }
    let admission;
    try {
      admission = await dependencies.runtimeWorker.start(
        dependencies.wakeStartCommand(target, input, reservation.reservationId),
      );
    } catch (error) {
      if (error instanceof WorkerAdmissionUncertainError) {
        return { status: "pending" as const, reason: error.message };
      }
      return { status: "pending" as const, reason: error instanceof Error ? error.message : String(error) };
    }
    if (admission.status === "rejected") {
      await state.releaseWake(reservation.reservationId);
      if (input.delivery.responseDirective === "required" && streamId) {
        await dependencies.eventSink.publish(input.spaceId, {
          type: "agent:reply",
          agentId: input.targetAgent.id,
          channelId: input.delivery.target,
          streamId,
          name: input.targetAgent.displayName || input.targetAgent.name,
          op: "error",
          text: admission.reason ?? "local runtime worker rejected delivery",
        });
      }
      return { status: "unavailable" as const, reason: admission.reason ?? "local runtime worker rejected delivery" };
    }
    await state.commitWake(reservation.reservationId, {
      agentId: input.targetAgent.id,
      channelId: input.commitChannelId,
      chainId: input.dispatch.chainId,
      dispatchDepth: input.dispatch.dispatchDepth,
    });
    return { status: "sent" as const };
  }

  return {
    async resolveMessageContext(input) {
      return new SqliteDispatchState(input.spaceId).resolveMessageContext({
        messageId: input.messageId,
        channelId: input.channelId,
        senderType: input.senderType,
        senderId: input.senderId,
        taskMessageId: input.taskMessageId,
      });
    },
    async ensureChain(input) {
      await new SqliteDispatchState(input.spaceId).ensureChain({
        ...input.dispatch,
        rootMessageId: input.rootMessageId,
        channelId: input.channelId,
      });
    },
    async prepareTargets(input) {
      const ids = [...new Set(input.targetAgents.map((agent) => agent.id))];
      const targets = await dependencies.resolveTargets(input.spaceId, ids);
      return {
        dispatch(wake) {
          return dispatchResolved(wake, targets.get(wake.targetAgent.id) ?? { ok: false, reason: "agent not found" });
        },
      };
    },
    async dispatch(input) {
      const target = await dependencies.resolveTarget(input.spaceId, input.targetAgent.id);
      return dispatchResolved(input, target);
    },
  };
}
