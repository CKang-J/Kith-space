import { channel } from "node:diagnostics_channel";
import { performance } from "node:perf_hooks";

export const REALTIME_DIAGNOSTIC_CHANNEL = "kith-space.realtime-event";

export interface RealtimeEventDiagnostic {
  spaceId: string;
  type: string;
  observedAt: number;
}

export const realtimeDiagnosticChannel = channel(REALTIME_DIAGNOSTIC_CHANNEL);

export function publishRealtimeDiagnostic(spaceId: string, event: unknown): void {
  if (!realtimeDiagnosticChannel.hasSubscribers) return;
  const type = event && typeof event === "object" && "type" in event
    ? String((event as { type?: unknown }).type ?? "unknown")
    : "unknown";
  realtimeDiagnosticChannel.publish({ spaceId, type, observedAt: performance.now() } satisfies RealtimeEventDiagnostic);
}
