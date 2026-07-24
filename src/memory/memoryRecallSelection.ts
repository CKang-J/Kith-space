import { estimateContextTokens } from "../context/contextBudget.js";

export interface RankedMemoryCandidate {
  score: number;
  reasons: string[];
  content: string | null;
}

/** Applies one cross-store ranking and budget after each SQLite store returns normalized candidates. */
export function selectUnifiedMemoryRecall<T extends RankedMemoryCandidate>(items: T[]): T[] {
  const ranked = [...items].sort((left, right) => right.score - left.score);
  const selected: T[] = [];
  let continuityCount = 0;
  let queryCount = 0;
  let continuityTokens = 0;
  let queryTokens = 0;
  for (const item of ranked) {
    const tokens = item.content ? estimateContextTokens(item.content) : 0;
    const continuityOnly = item.reasons.includes("continuity") && !item.reasons.includes("query");
    if (continuityOnly) {
      if (continuityCount >= 12 || continuityTokens + tokens > 2_000) continue;
      continuityCount += 1;
      continuityTokens += tokens;
    } else {
      if (queryCount >= 8 || queryTokens + tokens > 4_000) continue;
      queryCount += 1;
      queryTokens += tokens;
    }
    selected.push(item);
  }
  return selected;
}
