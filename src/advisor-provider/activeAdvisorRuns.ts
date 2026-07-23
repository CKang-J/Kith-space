type ActiveAdvisorRun = {
  runId: string;
  spaceId: string;
  agentId: string;
  channelIds?: readonly string[];
  cancel: () => Promise<void>;
};

const active = new Map<string, ActiveAdvisorRun>();

export function registerActiveAdvisorRun(run: ActiveAdvisorRun): () => void {
  active.set(run.runId, run);
  return () => { if (active.get(run.runId) === run) active.delete(run.runId); };
}

/** Gate writers await this ACK before publishing a new provider epoch or completed revocation. */
export async function cancelActiveAdvisorRuns(filter: { spaceId?: string; agentId?: string; channelId?: string } = {}): Promise<string[]> {
  const selected = [...active.values()].filter((run) => (!filter.spaceId || run.spaceId === filter.spaceId)
    && (!filter.agentId || run.agentId === filter.agentId)
    && (!filter.channelId || run.channelIds?.includes(filter.channelId)));
  await Promise.all(selected.map((run) => run.cancel()));
  return selected.map((run) => run.runId);
}
