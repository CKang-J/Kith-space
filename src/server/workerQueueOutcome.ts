import type { WorkerQueueOutcome } from "../runtime/contract/runtimeWorkerPort.js";

export interface TerminalWakeReplyEvent {
  type: "agent:reply";
  agentId: string;
  channelId: string;
  streamId: string;
  name: string;
  op: "error";
  text: string;
}

/** Translate a failed queued wake into the terminal event consumed by Chat reply previews. */
export function terminalWakeReplyEvent(
  outcome: WorkerQueueOutcome,
  agentName: string,
): TerminalWakeReplyEvent | null {
  if (
    outcome.source !== "wake"
    || outcome.status === "completed"
    || !outcome.channelId
    || !outcome.streamId
  ) return null;
  return {
    type: "agent:reply",
    agentId: outcome.agentId,
    channelId: outcome.channelId,
    streamId: outcome.streamId,
    name: agentName,
    op: "error",
    text: outcome.reason ?? "local runtime worker did not complete the queued wake",
  };
}
