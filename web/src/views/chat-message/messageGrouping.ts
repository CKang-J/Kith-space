import { isSameLocalDay } from "../../format.ts";

interface GroupableMessage {
  senderType: string;
  senderId?: string | null;
  senderName: string;
  messageType?: string | null;
  createdAt?: string;
}

const isHumanOrAgentMessage = (message: GroupableMessage) => (
  (message.senderType === "human" || message.senderType === "agent")
  && message.messageType !== "action"
);

export function shouldGroupMessage(previous?: GroupableMessage, current?: GroupableMessage): boolean {
  if (!previous || !current || !isHumanOrAgentMessage(previous) || !isHumanOrAgentMessage(current)) return false;
  if (previous.senderType !== current.senderType || !isSameLocalDay(previous.createdAt, current.createdAt)) return false;
  if (previous.senderId || current.senderId) return Boolean(previous.senderId && previous.senderId === current.senderId);
  return previous.senderName === current.senderName;
}
