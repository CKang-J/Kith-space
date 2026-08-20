export type ConversationActivityPhase =
  | "preparing"
  | "thinking"
  | "searching"
  | "executing"
  | "reading"
  | "writing"
  | "updating"
  | "replying"
  | "waiting"
  | "retrying"
  | "working"
  | "using_tool"
  | "completed"
  | "error";

export interface ConversationActivityEntry {
  agentId: string;
  name: string;
  phase: ConversationActivityPhase;
  toolName?: string;
  streamId?: string;
  updatedAt: number;
}

export type ConversationActivityBuckets = Record<string, Record<string, ConversationActivityEntry>>;

export interface ConversationActivitySocketEvent {
  agentId?: unknown;
  name?: unknown;
  scope?: unknown;
  channelId?: unknown;
  streamId?: unknown;
  activity?: unknown;
  detail?: unknown;
  entries?: unknown;
}

export interface ConversationActivityUpdate {
  surfaceId: string;
  entry: ConversationActivityEntry;
  terminalDelayMs?: number;
}

const COMPLETED_CLEAR_DELAY_MS = 1_200;
const ERROR_CLEAR_DELAY_MS = 4_000;

function normalizedText(...values: unknown[]): string {
  return values.filter((value): value is string => typeof value === "string").join(" ").trim().toLowerCase();
}

function toolPhase(toolName: string, toolInput: string): Pick<ConversationActivityEntry, "phase" | "toolName"> {
  const text = normalizedText(toolName, toolInput);
  if (/websearch|web search|browser|search[_ -]?query/.test(text)) return { phase: "searching" };
  if (/kith-space\s+message\s+send|message[_ -]?send|turn\.reply/.test(text)) return { phase: "replying" };
  if (/kith-space\s+task\s+update|task[_ -]?update/.test(text)) return { phase: "updating" };
  if (/\b(read|grep|glob|find|list|open)\b/.test(text)) return { phase: "reading" };
  if (/\b(write|edit|patch|apply_patch|create)\b/.test(text)) return { phase: "writing" };
  if (/\b(bash|shell|terminal|exec|command)\b/.test(text)) return { phase: "executing" };
  return { phase: "using_tool", toolName: toolName.trim().slice(0, 40) || undefined };
}

function statusPhase(activity: string, detail: string): Pick<ConversationActivityEntry, "phase" | "toolName"> {
  const text = normalizedText(activity, detail);
  if (/approval|confirm|permission|等待|确认/.test(text)) return { phase: "waiting" };
  if (/retry|重试/.test(text)) return { phase: "retrying" };
  if (/websearch|web search|browser|search[_ -]?query/.test(text)) return { phase: "searching" };
  if (/kith-space\s+message\s+send|message[_ -]?send|turn\.reply/.test(text)) return { phase: "replying" };
  if (/kith-space\s+task\s+update|task[_ -]?update/.test(text)) return { phase: "updating" };
  if (activity === "thinking") return { phase: "thinking" };
  if (/starting|agent_start|preparing|queued|waking/.test(text)) return { phase: "preparing" };
  if (activity === "error" || /failed|error/.test(text)) return { phase: "error" };
  if (activity === "online" || activity === "offline" || activity === "sleeping" || activity === "inactive") {
    return { phase: "completed" };
  }
  return { phase: "working" };
}

function entryPhase(raw: Record<string, unknown>): Pick<ConversationActivityEntry, "phase" | "toolName"> | null {
  const toolName = typeof raw.toolName === "string" ? raw.toolName : "";
  const toolInput = typeof raw.toolInput === "string" ? raw.toolInput : "";
  if (toolName) return toolPhase(toolName, toolInput);
  const kind = typeof raw.kind === "string" ? raw.kind.toLowerCase() : "";
  if (kind.includes("thinking")) return { phase: "thinking" };
  if (kind === "text" || kind === "text_preview") return { phase: "replying" };
  return null;
}

export function conversationActivityUpdateFromSocket(
  event: ConversationActivitySocketEvent,
  now = Date.now(),
): ConversationActivityUpdate | null {
  if (event.scope !== "scoped" || typeof event.channelId !== "string" || !event.channelId.trim()) return null;
  if (typeof event.agentId !== "string" || !event.agentId.trim()) return null;
  const name = typeof event.name === "string" && event.name.trim() ? event.name.trim() : "Agent";
  const streamId = typeof event.streamId === "string" && event.streamId ? event.streamId : undefined;
  const entries = Array.isArray(event.entries) ? event.entries : null;
  let summary: Pick<ConversationActivityEntry, "phase" | "toolName"> | null = null;

  if (entries) {
    for (let index = entries.length - 1; index >= 0; index--) {
      const raw = entries[index];
      if (!raw || typeof raw !== "object") continue;
      summary = entryPhase(raw as Record<string, unknown>);
      if (summary) break;
    }
    if (!summary) return null;
  } else {
    const activity = typeof event.activity === "string" ? event.activity.toLowerCase() : "";
    const detail = typeof event.detail === "string" ? event.detail : "";
    if (!activity && !detail) return null;
    summary = statusPhase(activity, detail);
  }

  const entry: ConversationActivityEntry = {
    agentId: event.agentId,
    name,
    ...summary,
    ...(streamId ? { streamId } : {}),
    updatedAt: now,
  };
  return {
    surfaceId: event.channelId,
    entry,
    ...(entry.phase === "completed" ? { terminalDelayMs: COMPLETED_CLEAR_DELAY_MS } : {}),
    ...(entry.phase === "error" ? { terminalDelayMs: ERROR_CLEAR_DELAY_MS } : {}),
  };
}

export function upsertConversationActivity(
  buckets: ConversationActivityBuckets,
  update: ConversationActivityUpdate,
): ConversationActivityBuckets {
  const surface = buckets[update.surfaceId] ?? {};
  const previous = surface[update.entry.agentId];
  if (update.terminalDelayMs && !previous) return buckets;
  if (update.terminalDelayMs && previous?.streamId && update.entry.streamId && previous.streamId !== update.entry.streamId) {
    return buckets;
  }
  return {
    ...buckets,
    [update.surfaceId]: {
      ...surface,
      [update.entry.agentId]: update.entry,
    },
  };
}

export function removeConversationActivity(
  buckets: ConversationActivityBuckets,
  surfaceId: string,
  agentId: string,
  streamId?: string,
): ConversationActivityBuckets {
  const surface = buckets[surfaceId];
  const current = surface?.[agentId];
  if (!current || (streamId && current.streamId && current.streamId !== streamId)) return buckets;
  const nextSurface = { ...surface };
  delete nextSurface[agentId];
  if (Object.keys(nextSurface).length === 0) {
    const next = { ...buckets };
    delete next[surfaceId];
    return next;
  }
  return { ...buckets, [surfaceId]: nextSurface };
}

const PHASE_PRIORITY: Record<ConversationActivityPhase, number> = {
  waiting: 0,
  error: 1,
  retrying: 2,
  searching: 3,
  executing: 3,
  reading: 3,
  writing: 3,
  updating: 3,
  using_tool: 3,
  replying: 4,
  thinking: 5,
  preparing: 6,
  working: 7,
  completed: 8,
};

export function selectConversationActivity(entries: Record<string, ConversationActivityEntry> | undefined): {
  primary: ConversationActivityEntry;
  extraCount: number;
} | null {
  const sorted = Object.values(entries ?? {}).sort((left, right) =>
    PHASE_PRIORITY[left.phase] - PHASE_PRIORITY[right.phase] || right.updatedAt - left.updatedAt);
  if (!sorted.length) return null;
  const activeCount = sorted.filter((entry) => entry.phase !== "completed").length;
  return { primary: sorted[0]!, extraCount: Math.max(0, activeCount - 1) };
}
