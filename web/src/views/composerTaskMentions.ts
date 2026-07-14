export interface MentionableAgent {
  id: string;
  name: string;
}

export function uniqueMentionedAgentIds(text: string, agents: readonly MentionableAgent[]): string[] {
  const agentIdByName = new Map(agents.map((agent) => [agent.name.toLowerCase(), agent.id]));
  const mentioned = new Set<string>();
  for (const match of text.matchAll(/@([\p{L}\p{N}_-]+)/gu)) {
    const agentId = agentIdByName.get(match[1]!.toLowerCase());
    if (agentId) mentioned.add(agentId);
  }
  return [...mentioned];
}
