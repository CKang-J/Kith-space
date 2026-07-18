import type { Runtime, RuntimeCallbacks, StartOpts, TrajectoryEntry } from "../runtime.js";

export interface FakeRuntimeSessionRecord {
  id: string;
  start: StartOpts;
  deliveries: string[];
  stopped: boolean;
  exitCode?: number | null;
}

export interface FakeRuntimeSnapshot {
  totalStarts: number;
  activeSessions: number;
  peakActiveSessions: number;
  totalDeliveries: number;
  totalStops: number;
  totalExits: number;
}

interface InternalSession extends FakeRuntimeSessionRecord {
  callbacks: RuntimeCallbacks;
}

export function createFakeRuntimeHarness(name = "fake"): {
  runtime: Runtime;
  sessions(): FakeRuntimeSessionRecord[];
  snapshot(): FakeRuntimeSnapshot;
  trajectory(sessionId: string, entries: TrajectoryEntry[]): void;
  exit(sessionId: string, code: number | null): void;
} {
  const records: InternalSession[] = [];
  let peakActiveSessions = 0;
  let totalDeliveries = 0;
  let totalStops = 0;
  let totalExits = 0;

  const activeSessions = () => records.filter((record) => record.exitCode === undefined).length;
  const exit = (sessionId: string, code: number | null) => {
    const record = records.find((candidate) => candidate.id === sessionId);
    if (!record || record.exitCode !== undefined) return;
    record.exitCode = code;
    totalExits++;
    record.callbacks.onExit(code);
  };

  const runtime: Runtime = {
    name,
    start(start, callbacks) {
      const id = `${name}-session-${records.length + 1}`;
      const record: InternalSession = {
        id,
        start: { ...start, env: { ...start.env } },
        deliveries: [],
        stopped: false,
        callbacks,
      };
      records.push(record);
      peakActiveSessions = Math.max(peakActiveSessions, activeSessions());
      callbacks.onSession(id);
      return {
        deliver(text) {
          if (record.exitCode !== undefined) return;
          record.deliveries.push(text);
          totalDeliveries++;
        },
        stop() {
          if (record.exitCode !== undefined) return;
          record.stopped = true;
          totalStops++;
          exit(id, 0);
        },
      };
    },
  };

  return {
    runtime,
    sessions: () => records.map(({ callbacks: _callbacks, ...record }) => ({
      ...record,
      start: { ...record.start, env: { ...record.start.env } },
      deliveries: [...record.deliveries],
    })),
    snapshot: () => ({
      totalStarts: records.length,
      activeSessions: activeSessions(),
      peakActiveSessions,
      totalDeliveries,
      totalStops,
      totalExits,
    }),
    trajectory(sessionId, entries) {
      const record = records.find((candidate) => candidate.id === sessionId);
      if (!record || record.exitCode !== undefined) return;
      record.callbacks.onTrajectory(entries);
    },
    exit,
  };
}
