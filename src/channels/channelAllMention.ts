export const CHANNEL_ALL_MENTION_NAME = "all";
export const CHANNEL_ALL_MENTION_TYPE = "channel_all" as const;

export type MessageMentionType = "human" | "agent" | typeof CHANNEL_ALL_MENTION_TYPE;

export interface MessageMention {
  type: MessageMentionType;
  id: string;
  name: string;
}

const CHANNEL_ALL_PATTERN = /@all(?![\p{L}\p{N}_-])/iu;

export function containsChannelAllMention(content: string): boolean {
  return CHANNEL_ALL_PATTERN.test(content);
}

export function mergeChannelAllMentions(
  ordinaryMentions: readonly MessageMention[],
  recipients: readonly MessageMention[],
  scopeChannelId: string,
): MessageMention[] {
  const merged = new Map<string, MessageMention>();
  for (const mention of [...ordinaryMentions, ...recipients]) {
    merged.set(`${mention.type}:${mention.id}`, mention);
  }
  const marker: MessageMention = {
    type: CHANNEL_ALL_MENTION_TYPE,
    id: scopeChannelId,
    name: CHANNEL_ALL_MENTION_NAME,
  };
  merged.set(`${marker.type}:${marker.id}`, marker);
  return [...merged.values()];
}
