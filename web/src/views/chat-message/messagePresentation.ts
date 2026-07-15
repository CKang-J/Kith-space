export type ChatMessageTone = "agent" | "human";
export type ChatMessageSurface = ChatMessageTone | "action" | "thread" | "showcase";

export function surfaceForSender(senderType: "agent" | "human"): ChatMessageTone {
  return senderType;
}
