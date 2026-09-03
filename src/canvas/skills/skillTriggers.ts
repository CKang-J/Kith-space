import type { SkillMetadata, SkillTriggers } from "./contracts.js";

/**
 * Negation window markers (Kith-simplified port of Recombyn
 * `skill_store/runtime.py` `_PROMPT_NEG_MARKERS`). Single-character Chinese
 * markers (别/勿/非) are dropped here because they false-positive on 别的/非常.
 */
const NEGATION_MARKERS = [
  "不要",
  "不是",
  "别做",
  "避免",
  "禁止",
  "无需",
  "不用",
  "don't",
  "do not",
  "not ",
  "no ",
  "never ",
  "avoid ",
  "without ",
];

/** Characters looked at immediately before a keyword hit. Mirrors the upstream 12-char window. */
const NEGATION_WINDOW = 12;

/** True when `needle` appears in `prompt` at least once outside a negation window (case-insensitive). */
export function positivelyPresent(prompt: string | null | undefined, needle: string): boolean {
  const n = needle.trim().toLowerCase();
  const p = (prompt ?? "").toLowerCase();
  if (!n || !p) return false;
  let start = 0;
  for (;;) {
    const index = p.indexOf(n, start);
    if (index < 0) return false;
    const left = p.slice(Math.max(0, index - NEGATION_WINDOW), index);
    if (!NEGATION_MARKERS.some((marker) => left.includes(marker))) return true;
    start = index + Math.max(1, n.length);
  }
}

export function triggerMatches(triggers: SkillTriggers | undefined, prompt: string | null | undefined): boolean {
  if (!triggers?.promptIncludesAny?.length) return false;
  const promptLower = (prompt ?? "").toLowerCase();
  if (!promptLower) return false;
  if (triggers.negatePromptIncludesAny?.some((n) => n.trim() && promptLower.includes(n.trim().toLowerCase()))) {
    return false;
  }
  return triggers.promptIncludesAny.some((needle) => positivelyPresent(promptLower, needle));
}

/** Skill keys whose triggers match the prompt, in the order the skills were given. */
export function matchedSkillKeys(
  prompt: string | null | undefined,
  skills: readonly SkillMetadata[],
): string[] {
  return skills.filter((skill) => triggerMatches(skill.triggers, prompt)).map((skill) => skill.skillKey);
}
