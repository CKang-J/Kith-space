import type { IncomingMessage, ServerResponse } from "node:http";
import { and, eq, like } from "drizzle-orm";
import { decideAgentMessageResponse, type AgentResponseDeliveryDecision } from "../../agents/agentResponseDelivery.js";
import { dbForSpace, schema } from "../../db/index.js";
import { getHumanIdentity } from "../../human/humanIdentity.js";
import { humanChannelState } from "../../human/humanChannelState.js";
import { canAgentReadChannel, resolveTarget } from "../core.js";

export interface AgentHttpContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  path: string;
  agent: typeof schema.agents.$inferSelect;
  spaceId: string;
}

export async function agentChannels(spaceId: string, agentId: string) {
  return dbForSpace(spaceId).select().from(schema.channelAgentMembers)
    .where(eq(schema.channelAgentMembers.agentId, agentId));
}

/** A stable target agents can pass back to message send. */
export async function addressableTarget(
  spaceId: string,
  channel: typeof schema.channels.$inferSelect,
  selfAgentId: string,
): Promise<string> {
  const db = dbForSpace(spaceId);
  if (channel.type === "thread" && channel.parentMessageId) {
    return `thread:${channel.parentMessageId.slice(0, 8)}`;
  }
  if (channel.type === "dm") {
    const members = await db.select().from(schema.channelAgentMembers)
      .where(eq(schema.channelAgentMembers.channelId, channel.id));
    const humanState = await humanChannelState(spaceId, channel.id);
    if (humanState?.dmAgentId === selfAgentId) {
      const human = getHumanIdentity();
      if (human) return `dm:@${human.handle}`;
    }
    const peer = members.find((member) => member.agentId !== selfAgentId);
    const name = peer
      ? (await db.select().from(schema.agents).where(eq(schema.agents.id, peer.agentId)))[0]?.name
      : null;
    return name ? `dm:@${name}` : `dm:${channel.id}`;
  }
  return `#${channel.name}`;
}

const pad2 = (value: number) => String(value).padStart(2, "0");

function localTime(value: Date | string | null | undefined): string {
  const time = value instanceof Date ? value : new Date(value ?? Date.now());
  return `${time.getFullYear()}-${pad2(time.getMonth() + 1)}-${pad2(time.getDate())} ${pad2(time.getHours())}:${pad2(time.getMinutes())}:${pad2(time.getSeconds())}`;
}

export function formatAgentMessage(
  message: typeof schema.messages.$inferSelect,
  target: string,
  attachments: { filename: string; id: string }[] = [],
  responseDirective?: AgentResponseDeliveryDecision["directive"],
): string {
  const taskSuffix = message.taskStatus
    ? ` [task #${message.taskNumber} status=${message.taskStatus} mode=${message.taskExecutionMode}]`
    : "";
  const attachmentSuffix = attachments.length
    ? ` [${attachments.length} attachment${attachments.length > 1 ? "s" : ""}: ${attachments.map((attachment) => `${attachment.filename} (id:${attachment.id})`).join(", ")} — use kith-space attachment view to download]`
    : "";
  const directive = responseDirective ? ` directive=${responseDirective}` : "";
  return `[target=${target}${message.threadId ? ":" + message.id.slice(0, 8) : ""} msg=${message.id.slice(0, 8)} time=${localTime(message.createdAt)} type=${message.senderType}${directive}] @${message.senderName}: ${message.content}${taskSuffix}${attachmentSuffix}`;
}

export function serializeAgentMessage(message: typeof schema.messages.$inferSelect) {
  return {
    id: message.id,
    seq: message.seq,
    channelId: message.channelId,
    senderType: message.senderType,
    senderName: message.senderName,
    content: message.content,
    taskStatus: message.taskStatus,
    taskExecutionMode: message.taskExecutionMode,
    dispatchChainId: message.dispatchChainId,
    dispatchDepth: message.dispatchDepth,
    createdAt: message.createdAt,
  };
}

export async function findParentMessage(
  context: AgentHttpContext,
  raw: string,
  channelTarget: string | null,
) {
  const value = raw.trim();
  if (!value) return null;
  const target = channelTarget
    ? await resolveTarget(context.spaceId, channelTarget, context.agent.id)
    : null;
  const idCondition = value.length >= 32
    ? eq(schema.messages.id, value)
    : like(schema.messages.id, `${value}%`);
  const conditions = [
    eq(schema.messages.spaceId, context.spaceId),
    idCondition,
    ...(target ? [eq(schema.messages.channelId, target.channelId)] : []),
  ];
  const parent = dbForSpace(context.spaceId).select().from(schema.messages)
    .where(and(...conditions)).get() ?? null;
  if (parent && !(await canAgentReadChannel(context.spaceId, parent.channelId, context.agent.id))) {
    return null;
  }
  return parent;
}

export { decideAgentMessageResponse };
