import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { initialAgentResponseWakeWatermarks } from "./agentResponseSettings.js";
import { nextSeq } from "../counters.js";
import { dbForSpace, schema } from "../db/index.js";
import { DeliveryJournal } from "../deliveries/deliveryJournal.js";
import { getHumanIdentity } from "../human/humanIdentity.js";
import { SessionModule } from "../sessions/sessionModule.js";

const NEW_AGENT_INTRO_REASON = "agent_creation_introduction";

export interface NewV2AgentIntroduction {
  channel: typeof schema.channels.$inferSelect;
  message: typeof schema.messages.$inferSelect;
}

/** Brand-new supported Agents never enter the legacy data plane. */
export async function initializeNewV2Agent(
  spaceId: string,
  agentId: string,
  options: { humanId?: string } = {},
): Promise<NewV2AgentIntroduction> {
  const db = dbForSpace(spaceId);
  const humanId = options.humanId ?? getHumanIdentity()?.id;
  if (!humanId) throw new Error("Human identity is not initialized");
  const agent = db.select().from(schema.agents).where(and(
    eq(schema.agents.id, agentId),
    eq(schema.agents.spaceId, spaceId),
    isNull(schema.agents.deletedAt),
  )).get();
  if (!agent || agent.introducedAt) throw new Error("new Agent introduction is not available");
  const seq = await nextSeq(spaceId);
  const dmName = `dm:${[humanId, agentId].sort().join(":")}`;
  return db.transaction((tx) => {
    const priorState = tx.select().from(schema.agentHarnessState).where(eq(schema.agentHarnessState.agentId, agentId)).get();
    if (priorState) throw new Error("new Agent already has a harness assignment");
    let channel = tx.select().from(schema.channels).where(and(
      eq(schema.channels.spaceId, spaceId),
      eq(schema.channels.type, "dm"),
      eq(schema.channels.name, dmName),
    )).get();
    if (!channel) {
      channel = tx.insert(schema.channels).values({ spaceId, name: dmName, type: "dm" }).returning().get();
    }
    tx.insert(schema.channelAgentMembers).values({
      channelId: channel.id,
      agentId,
      lastReadSeq: seq - 1,
      ...initialAgentResponseWakeWatermarks(seq - 1),
    }).onConflictDoNothing().run();
    tx.insert(schema.humanChannelStates).values({ channelId: channel.id, dmAgentId: agentId, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.humanChannelStates.channelId, set: { dmAgentId: agentId, updatedAt: new Date() } }).run();
    tx.insert(schema.agentHarnessState).values({
      agentId,
      mode: "v2",
      cutoverAt: new Date(),
      migrationAudit: { history: [{ at: Date.now(), from: "new", to: "v2", reason: "supported_runtime_default" }] },
    }).run();
    const content = `You have just been created as ${agent.displayName || agent.name}. Introduce yourself to the Human in 2–3 concise sentences, including your role or strongest capabilities and how they can ask you for help.`;
    const message = tx.insert(schema.messages).values({
      id: randomUUID(),
      seq,
      spaceId,
      channelId: channel.id,
      senderType: "system",
      senderId: null,
      senderName: "Kith-space",
      messageType: "system",
      content,
      memoryPolicy: "exclude",
      searchText: content,
    }).returning().get();
    tx.insert(schema.agentDeliveryItems).values({
      spaceId,
      agentId,
      messageId: message.id,
      sourceChannelId: channel.id,
      sourceSeq: message.seq,
      cursorOwnerChannelId: channel.id,
      targetSurfaceKind: "dm",
      targetSurfaceId: channel.id,
      directive: "required",
      reason: NEW_AGENT_INTRO_REASON,
      policySnapshot: { kind: NEW_AGENT_INTRO_REASON, oneTime: true },
      disposition: "pending",
    }).run();
    tx.update(schema.channels).set({ lastMessageAt: new Date() }).where(eq(schema.channels.id, channel.id)).run();
    tx.update(schema.agents).set({ status: "active", activity: "working" }).where(eq(schema.agents.id, agentId)).run();
    return { channel, message };
  });
}

/** Existing Agent cutover: caller must drain legacy Worker before entering migrating. */
export function migrateExistingAgentToV2(spaceId: string, agentId: string, reason: string): number {
  const db = dbForSpace(spaceId);
  const sessions = new SessionModule(spaceId, db);
  const mode = sessions.harnessMode(agentId);
  if (mode === "legacy") sessions.beginCutover(agentId, { legacyDrained: true, reason });
  else if (mode !== "migrating") throw new Error(`cannot migrate Agent from ${mode} harness mode`);
  const journal = new DeliveryJournal();
  let inserted = 0;
  try {
    inserted = db.transaction((tx) => {
      let count = 0;
      const memberships = tx.select().from(schema.channelAgentMembers)
        .where(eq(schema.channelAgentMembers.agentId, agentId)).all();
      for (const membership of memberships) {
        const channel = tx.select().from(schema.channels).where(and(
          eq(schema.channels.id, membership.channelId),
          eq(schema.channels.spaceId, spaceId),
          isNull(schema.channels.deletedAt),
        )).get();
        if (!channel) continue;
        const messages = tx.select().from(schema.messages).where(and(
          eq(schema.messages.channelId, channel.id),
          gt(schema.messages.seq, membership.lastReadSeq),
        )).orderBy(asc(schema.messages.seq)).all();
        for (const message of messages) {
          const mentions = tx.select().from(schema.messageMentions).where(eq(schema.messageMentions.messageId, message.id)).all()
            .map((mention) => ({ type: mention.mentionType as "agent" | "human", id: mention.mentionId, name: mention.mentionName }));
          count += journal.persistMessageInTransaction(tx, {
            spaceId,
            channel,
            message,
            senderType: message.senderType as "human" | "agent" | "system",
            senderId: message.senderId,
            candidateAgentIds: [agentId],
            mentions,
            explicitTaskAgentId: message.taskAssigneeType === "agent" ? message.taskAssigneeId : null,
            targetSurface: message.taskAssigneeType === "agent" && message.taskAssigneeId === agentId && message.threadId
              ? { kind: "thread", id: message.threadId }
              : undefined,
            allowedHarnessModes: ["migrating"],
          });
        }
      }
      return count;
    });
    sessions.completeCutover(agentId);
    return inserted;
  } catch (error) {
    // A failed backfill must never reopen legacy consumption implicitly. Keep `migrating` for operator recovery.
    throw error;
  }
}

export function canRollbackV2Agent(spaceId: string, agentId: string): boolean {
  const db = dbForSpace(spaceId);
  const activeTurn = db.select({ id: schema.agentTurns.id }).from(schema.agentTurns).where(and(
    eq(schema.agentTurns.agentId, agentId),
    inArray(schema.agentTurns.status, ["pending", "running", "retry_wait"]),
  )).get();
  const unresolved = db.select({ id: schema.agentDeliveryItems.id }).from(schema.agentDeliveryItems).where(and(
    eq(schema.agentDeliveryItems.agentId, agentId),
    inArray(schema.agentDeliveryItems.disposition, ["pending", "bound"]),
  )).get();
  return !activeTurn && !unresolved;
}

export { NEW_AGENT_INTRO_REASON };
