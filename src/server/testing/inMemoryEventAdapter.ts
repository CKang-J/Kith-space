import { realtimeDiagnosticChannel, type RealtimeEventDiagnostic } from "../realtimeDiagnostics.js";

export function createInMemoryEventAdapter(): {
  events(): RealtimeEventDiagnostic[];
  clear(): void;
  disconnect(): void;
} {
  const events: RealtimeEventDiagnostic[] = [];
  let connected = true;
  const listener = (message: unknown) => {
    const event = message as RealtimeEventDiagnostic;
    events.push({ ...event });
  };
  realtimeDiagnosticChannel.subscribe(listener);
  return {
    events: () => events.map((event) => ({ ...event })),
    clear: () => { events.length = 0; },
    disconnect() {
      if (!connected) return;
      connected = false;
      realtimeDiagnosticChannel.unsubscribe(listener);
    },
  };
}
