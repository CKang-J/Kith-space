import { and, eq, inArray, isNull } from "drizzle-orm";
import { dbForSpace, schema } from "../db/index.js";
import { DeliveryJournal } from "../deliveries/deliveryJournal.js";
import { SqliteDispatchState } from "./dispatchGuard.js";

/** Binds durable v2 deliveries to the existing per-message dispatch budget without leaking transport into turns/. */
export const turnDispatchAdapter = {
  async preparePending(spaceId: string): Promise<void> {
    const db = dbForSpace(spaceId);
    const deliveries = db.select().from(schema.agentDeliveryItems).where(and(
      eq(schema.agentDeliveryItems.spaceId, spaceId),
      eq(schema.agentDeliveryItems.disposition, "pending"),
      isNull(schema.agentDeliveryItems.dispatchWakeId),
      inArray(schema.agentDeliveryItems.directive, ["required", "optional"]),
    )).all();
    const state = new SqliteDispatchState(spaceId);
    const journal = new DeliveryJournal();
    for (const delivery of deliveries) {
      const message = db.select().from(schema.messages).where(eq(schema.messages.id, delivery.messageId)).get();
      if (!message) continue;
      const chainId = message.dispatchChainId ?? message.id;
      const dispatchDepth = message.dispatchDepth ?? 0;
      const chain = db.select().from(schema.dispatchChains).where(eq(schema.dispatchChains.id, chainId)).get();
      await state.ensureChain({
        chainId,
        dispatchDepth,
        taskMessageId: message.taskStatus ? message.id : chain?.taskMessageId ?? null,
        rootMessageId: message.id,
        channelId: message.channelId,
      });
      const reservation = await state.getOrReserveWake({
        chainId,
        dispatchDepth,
        taskMessageId: message.taskStatus ? message.id : chain?.taskMessageId ?? null,
        messageId: message.id,
        targetAgentId: delivery.agentId,
      });
      if (reservation.allowed) {
        db.update(schema.agentDeliveryItems).set({ dispatchWakeId: reservation.reservationId }).where(and(
          eq(schema.agentDeliveryItems.id, delivery.id),
          eq(schema.agentDeliveryItems.disposition, "pending"),
          isNull(schema.agentDeliveryItems.dispatchWakeId),
        )).run();
        continue;
      }
      db.transaction((tx) => {
        const current = tx.select().from(schema.agentDeliveryItems).where(eq(schema.agentDeliveryItems.id, delivery.id)).get();
        if (!current || current.disposition !== "pending") return;
        tx.update(schema.agentDeliveryItems).set({
          disposition: "dispatch_blocked",
          reason: `dispatch_${reservation.code.toLowerCase()}`,
          policySnapshot: { ...current.policySnapshot, dispatchBlock: { code: reservation.code, reason: reservation.reason, wakeCount: reservation.wakeCount } },
          settledAt: new Date(),
        }).where(eq(schema.agentDeliveryItems.id, current.id)).run();
        journal.advanceTerminalFrontier(tx, current.agentId, current.cursorOwnerChannelId);
      });
    }
  },

  async commitTurn(spaceId: string, turnId: string): Promise<void> {
    const db = dbForSpace(spaceId);
    const deliveries = db.select().from(schema.agentDeliveryItems).where(and(
      eq(schema.agentDeliveryItems.turnId, turnId),
      eq(schema.agentDeliveryItems.disposition, "bound"),
    )).all();
    const state = new SqliteDispatchState(spaceId);
    for (const delivery of deliveries) {
      if (!delivery.dispatchWakeId) throw new Error(`delivery ${delivery.id} has no dispatch reservation`);
      const message = db.select().from(schema.messages).where(eq(schema.messages.id, delivery.messageId)).get();
      if (!message) throw new Error(`delivery ${delivery.id} source message is missing`);
      await state.commitWake(delivery.dispatchWakeId, {
        agentId: delivery.agentId,
        channelId: delivery.targetSurfaceId,
        chainId: message.dispatchChainId ?? message.id,
        dispatchDepth: message.dispatchDepth ?? 0,
      });
    }
  },

  async releaseTurn(spaceId: string, turnId: string): Promise<void> {
    const db = dbForSpace(spaceId);
    const wakeIds = db.select({ id: schema.agentDeliveryItems.dispatchWakeId }).from(schema.agentDeliveryItems)
      .where(eq(schema.agentDeliveryItems.turnId, turnId)).all().flatMap((row) => row.id ? [row.id] : []);
    const state = new SqliteDispatchState(spaceId);
    for (const wakeId of wakeIds) await state.releaseWake(wakeId);
  },
};
