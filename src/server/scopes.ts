// Agent permission scopes (14 scopes).
// Default mode = all granted; custom mode = the subset the user explicitly checked. Enforcement happens at the /agent-api gateway.
export interface ScopeDef { key: string; group: string; label: string; description: string; }

export const SCOPES: ScopeDef[] = [
  { key: "inbox:receive", group: "Notifications", label: "Receive inbox events", description: "Receive new inbox events; get woken by others'/agents' activity." },
  { key: "server:read", group: "Server", label: "Read workspace info", description: "List channels, members, and agents (basic workspace info)." },
  { key: "channel:read", group: "Channels", label: "View channel members", description: "View members of joined channels." },
  { key: "channel:join", group: "Channels", label: "Join channels", description: "Join visible public channels." },
  { key: "channel:leave", group: "Channels", label: "Leave channels", description: "Leave joined channels." },
  { key: "thread:unfollow", group: "Threads", label: "Unfollow threads", description: "Stop receiving deliveries from a thread." },
  { key: "message:read", group: "Messages", label: "Read messages", description: "View, read, search, and resolve messages." },
  { key: "message:send", group: "Messages", label: "Send messages", description: "Send messages to channels, DMs, and threads." },
  { key: "attachment:upload", group: "Attachments", label: "Upload attachments", description: "Upload files as message attachments." },
  { key: "attachment:view", group: "Attachments", label: "View attachments", description: "Download and view attachments." },
  { key: "task:read", group: "Tasks", label: "Read tasks", description: "List tasks on channel task boards." },
  { key: "task:write", group: "Tasks", label: "Write tasks", description: "Create, claim, release, and update tasks." },
  { key: "knowledge:read", group: "Knowledge", label: "Read knowledge", description: "Fetch topics from the agent knowledge base." },
  { key: "action:prepare", group: "Action", label: "Prepare action cards", description: "Allow the agent to prepare quick-commit action cards." },
];
export const ALL_SCOPE_KEYS = SCOPES.map((s) => s.key);
const SCOPE_SET = new Set(ALL_SCOPE_KEYS);
export const isScopeLiteral = (s: unknown): s is string => typeof s === "string" && SCOPE_SET.has(s);

export interface AgentScopes { granted: string[]; mode: "default" | "custom"; revision: number; updatedAt: string; }

/** agent.scopes null = default mode (all granted); otherwise use the stored custom set. */
export function effectiveScopes(stored: AgentScopes | null | undefined): AgentScopes {
  if (!stored) return { granted: [...ALL_SCOPE_KEYS], mode: "default", revision: 0, updatedAt: new Date(0).toISOString() };
  return stored;
}
export function agentHasScope(stored: AgentScopes | null | undefined, scope: string): boolean {
  return effectiveScopes(stored).granted.includes(scope);
}
