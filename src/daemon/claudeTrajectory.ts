import type { TrajectoryEntry } from "./runtime.js";

const MAX_DETAIL_CHARS = 16_000;

function clip(value: unknown): string {
  return String(value ?? "").slice(0, MAX_DETAIL_CHARS);
}

function serialize(value: unknown): string {
  if (typeof value === "string") return clip(value);
  if (value == null) return "";
  try { return clip(JSON.stringify(value, null, 2)); }
  catch { return clip(value); }
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return clip(content);
  if (!Array.isArray(content)) return serialize(content);
  return clip(content.map((block) => {
    if (typeof block === "string") return block;
    if (block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string") {
      return (block as { text: string }).text;
    }
    return serialize(block);
  }).filter(Boolean).join("\n"));
}

export interface ClaudeTrajectoryState {
  toolNamesById: Map<string, string>;
}

export function createClaudeTrajectoryState(): ClaudeTrajectoryState {
  return { toolNamesById: new Map() };
}

export function parseClaudeTrajectoryEvent(
  event: any,
  state: ClaudeTrajectoryState,
): TrajectoryEntry[] {
  const content = event?.message?.content;
  if (!Array.isArray(content)) return [];

  if (event.type === "assistant") {
    return content.flatMap((block: any): TrajectoryEntry[] => {
      if (block?.type === "thinking" && block.thinking) {
        return [{ kind: "thinking", text: clip(block.thinking) }];
      }
      if (block?.type === "text" && block.text) {
        return [{ kind: "text", text: clip(block.text) }];
      }
      if (block?.type === "tool_use") {
        const toolCallId = typeof block.id === "string" ? block.id : "";
        const toolName = typeof block.name === "string" ? block.name : "tool";
        if (toolCallId) state.toolNamesById.set(toolCallId, toolName);
        return [{
          kind: "tool",
          eventKind: "tool_started",
          toolCallId,
          toolName,
          toolInput: serialize(block.input),
        }];
      }
      return [];
    });
  }

  if (event.type === "user") {
    return content.flatMap((block: any): TrajectoryEntry[] => {
      if (block?.type !== "tool_result") return [];
      const toolCallId = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
      const toolName = state.toolNamesById.get(toolCallId) ?? "tool";
      if (toolCallId) state.toolNamesById.delete(toolCallId);
      return [{
        kind: "tool",
        eventKind: block.is_error === true ? "tool_failed" : "tool_completed",
        toolCallId,
        toolName,
        toolOutput: toolResultText(block.content),
      }];
    });
  }

  return [];
}
