import { TaskOperationError } from "./taskTypes.js";

export interface TaskMentionTarget {
  type: "human" | "agent";
  id: string;
}

/** Resolve the Human Composer's channel-task shorthand without leaking mention parsing into task persistence. */
export function taskAssigneeFromMentions(input: {
  asTask: boolean;
  senderType: "human" | "agent" | "system";
  channelType: string;
  mentions: TaskMentionTarget[];
}): string | null {
  if (!input.asTask || input.senderType !== "human") return null;
  if (input.channelType !== "channel" && input.channelType !== "private") return null;

  const agentIds = [...new Set(input.mentions.filter((mention) => mention.type === "agent").map((mention) => mention.id))];
  if (agentIds.length > 1) {
    throw new TaskOperationError("INVALID_ARGUMENT", "As Task supports exactly one Agent assignee; remove extra Agent mentions");
  }
  return agentIds[0] ?? null;
}
