export type MessageSenderType = "human" | "agent" | "system";

export function canAutoJoinMentionedMembers(senderType: MessageSenderType): boolean {
  return senderType === "human";
}
