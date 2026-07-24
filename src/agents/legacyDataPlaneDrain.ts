interface DrainState {
  active: number;
  draining: boolean;
  waiters: Set<() => void>;
}

const states = new Map<string, DrainState>();

function state(agentId: string): DrainState {
  let value = states.get(agentId);
  if (!value) {
    value = { active: 0, draining: false, waiters: new Set() };
    states.set(agentId, value);
  }
  return value;
}

/** Returns null once cutover has closed admission; otherwise a mandatory release callback. */
export function enterLegacyDataPlane(agentId: string): (() => void) | null {
  const value = state(agentId);
  if (value.draining) return null;
  value.active += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    value.active = Math.max(0, value.active - 1);
    if (!value.active) {
      for (const waiter of value.waiters) waiter();
      value.waiters.clear();
      if (!value.draining) states.delete(agentId);
    }
  };
}

export function beginLegacyDataPlaneDrain(agentId: string): void {
  state(agentId).draining = true;
}

export async function waitForLegacyDataPlaneDrain(agentId: string, timeoutMs = 5_000): Promise<void> {
  const value = state(agentId);
  if (!value.active) return;
  await new Promise<void>((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      value.waiters.delete(done);
      resolve();
    };
    const timer = setTimeout(() => {
      value.waiters.delete(done);
      reject(new Error(`legacy Agent data plane did not drain within ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
    value.waiters.add(done);
  });
}

export function endLegacyDataPlaneDrain(agentId: string): void {
  const value = states.get(agentId);
  if (!value) return;
  value.draining = false;
  if (!value.active) states.delete(agentId);
}
