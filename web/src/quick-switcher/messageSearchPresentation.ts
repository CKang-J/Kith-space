export interface MessageSearchResult {
  id: string;
  channelId: string;
  channelName: string;
  channelType: "channel" | "dm" | "thread";
  conversationName?: string | null;
  conversationAvatarUrl?: string | null;
  parentMessageId?: string | null;
  parentChannelId?: string | null;
  parentChannelName?: string | null;
  parentPreview?: string | null;
  replyCount?: number | null;
  senderName: string;
  senderDeleted?: boolean;
  snippet?: string;
  content: string;
  createdAt?: string | null;
}

export interface SearchTextSegment {
  text: string;
  matched: boolean;
}

export function messageSearchTextSegments(text: string, query: string): SearchTextSegment[] {
  const needle = query.trim();
  if (!needle) return [{ text, matched: false }];
  const haystack = text.toLocaleLowerCase();
  const normalizedNeedle = needle.toLocaleLowerCase();
  const segments: SearchTextSegment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const matchAt = haystack.indexOf(normalizedNeedle, cursor);
    if (matchAt < 0) {
      segments.push({ text: text.slice(cursor), matched: false });
      break;
    }
    if (matchAt > cursor) segments.push({ text: text.slice(cursor, matchAt), matched: false });
    segments.push({ text: text.slice(matchAt, matchAt + needle.length), matched: true });
    cursor = matchAt + needle.length;
  }
  return segments.length ? segments : [{ text, matched: false }];
}
