export type ChatMessageTone = "agent" | "human";
export type ChatMessageSurface = ChatMessageTone | "action" | "thread";

export function surfaceForSender(senderType: "agent" | "human"): ChatMessageTone {
  return senderType;
}
