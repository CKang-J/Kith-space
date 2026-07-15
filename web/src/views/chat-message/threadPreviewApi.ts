import type { ThreadMeta } from "../../threadUnread.ts";

export type ThreadPreviewApi = (method: string, path: string, body?: unknown) => Promise<any>;

export async function fetchThreadMetadata(
  api: ThreadPreviewApi,
  channelId: string,
  parentMessageIds: string[],
): Promise<Record<string, ThreadMeta>> {
  if (!parentMessageIds.length) return {};
  const ids = parentMessageIds.map(encodeURIComponent).join(",");
  return await api("GET", `/api/channels/${encodeURIComponent(channelId)}/threads?parentMessageIds=${ids}`) || {};
}
