export interface MentionInsertion {
  text: string;
  caret: number;
}

export function insertAgentMention(text: string, start: number, end: number, agentName: string): MentionInsertion {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const leadingSpace = before && !/\s$/u.test(before) ? " " : "";
  const trailingSpace = after && /^\s/u.test(after) ? "" : " ";
  const insertion = `${leadingSpace}@${agentName}${trailingSpace}`;
  return {
    text: before + insertion + after,
    caret: before.length + insertion.length,
  };
}
