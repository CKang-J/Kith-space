const activeIntroductionTokens = new Map<string, string>();
const completedIntroductionTokens = new Map<string, Set<string>>();

const introductionKey = (spaceId: string, agentId: string) => `${spaceId}:${agentId}`;

export type AgentIntroductionTokenStatus = "active" | "completed" | "revoked";

/** Register or revoke the one-turn capability that distinguishes an introduction from an ordinary reply. */
export function setAgentIntroductionTurn(spaceId: string, agentId: string, token: string | null): void {
  const key = introductionKey(spaceId, agentId);
  if (token) activeIntroductionTokens.set(key, token);
  else activeIntroductionTokens.delete(key);
}

export function agentIntroductionTokenStatus(spaceId: string, agentId: string, token: string): AgentIntroductionTokenStatus {
  const key = introductionKey(spaceId, agentId);
  if (activeIntroductionTokens.get(key) === token) return "active";
  if (completedIntroductionTokens.get(key)?.has(token)) return "completed";
  return "revoked";
}

/** Called immediately before the synchronous SQLite transaction, after every asynchronous target check. */
export function consumeAgentIntroductionTurn(spaceId: string, agentId: string, token: string): boolean {
  const key = introductionKey(spaceId, agentId);
  if (activeIntroductionTokens.get(key) !== token) return false;
  activeIntroductionTokens.delete(key);
  return true;
}

export function completeAgentIntroductionTurn(spaceId: string, agentId: string, token: string): void {
  const key = introductionKey(spaceId, agentId);
  const completed = completedIntroductionTokens.get(key) ?? new Set<string>();
  completed.add(token);
  completedIntroductionTokens.set(key, completed);
}

export function restoreAgentIntroductionTurn(spaceId: string, agentId: string, token: string): void {
  const key = introductionKey(spaceId, agentId);
  if (!activeIntroductionTokens.has(key)) activeIntroductionTokens.set(key, token);
}

export function clearAgentIntroductionTurns(spaceId: string, agentId: string): void {
  const key = introductionKey(spaceId, agentId);
  activeIntroductionTokens.delete(key);
  completedIntroductionTokens.delete(key);
}
