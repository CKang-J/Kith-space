export const CHANNEL_ALL_MENTION_NAME = "all";

const CHANNEL_ALL_PATTERN = /@all(?![\p{L}\p{N}_-])/iu;

export function containsChannelAllMention(text: string): boolean {
  return CHANNEL_ALL_PATTERN.test(text);
}

export function matchesChannelAllMentionQuery(query: string): boolean {
  return CHANNEL_ALL_MENTION_NAME.includes(query.trim().toLowerCase());
}
