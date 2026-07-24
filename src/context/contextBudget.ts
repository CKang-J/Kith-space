export const FALLBACK_DYNAMIC_CONTEXT_BUDGET = 8_000;
export const MAX_CONTEXT_MESSAGE_CHARS = 16_000;

export function estimateContextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function boundedContextContent(content: string): string {
  if (content.length <= MAX_CONTEXT_MESSAGE_CHARS) return content;
  return `${content.slice(0, MAX_CONTEXT_MESSAGE_CHARS)}\n[message excerpt truncated; use authoritative query tools for the full source]`;
}
