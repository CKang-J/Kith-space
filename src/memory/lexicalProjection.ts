const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
const CJK_ONLY = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u;
const WORD = /[\p{Letter}\p{Number}_]+/gu;

function ngrams(value: string, size: number): string[] {
  const chars = [...value];
  const out: string[] = [];
  for (let index = 0; index + size <= chars.length; index += 1) {
    out.push(chars.slice(index, index + size).join(""));
  }
  return out;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export interface LexicalProjection {
  normalizedText: string;
  lexicalText: string;
  cjkBigrams: string;
  cjkTrigrams: string;
  shortExactTerms: string[];
}

/** Deterministic local projection used by P-A10 memory FTS and exact fallback. */
export function projectLexicalText(input: string): LexicalProjection {
  const normalizedText = input.normalize("NFKC").toLocaleLowerCase("und").replace(/\s+/g, " ").trim();
  const cjkRuns = [...normalizedText.matchAll(CJK_RUN)].map((match) => match[0]);
  const lexicalTokens = [...normalizedText.matchAll(WORD)]
    .map((match) => match[0])
    .filter((token) => !CJK_ONLY.test(token));
  const bigrams = unique(cjkRuns.flatMap((run) => ngrams(run, 2)));
  const trigrams = unique(cjkRuns.flatMap((run) => ngrams(run, 3)));
  const shortExactTerms = unique(cjkRuns.flatMap((run) => [...ngrams(run, 1), ...ngrams(run, 2)]));
  return {
    normalizedText,
    lexicalText: unique(lexicalTokens).join(" "),
    cjkBigrams: bigrams.join(" "),
    cjkTrigrams: trigrams.join(" "),
    shortExactTerms,
  };
}
