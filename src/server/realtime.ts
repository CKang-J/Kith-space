// Realtime: the human side runs over socket.io (see socketio.ts); seq comes from the workspace-local counter.
// publish() is the single global entry point; internally it maps to named realtime events and fans out to the Space room.
// One installation-local Core Service instance owns every Space room, so direct emit is the complete transport.
import { nextSeq } from "../counters.js";
import { emitMapped } from "./socketio.js";
import { publishRealtimeDiagnostic } from "./realtimeDiagnostics.js";

export function initRealtime(): void { /* socket.io is attached in index.ts; no external fan-out needed */ }

export async function publish(spaceId: string, event: unknown): Promise<void> {
  emitMapped(spaceId, event);
  publishRealtimeDiagnostic(spaceId, event);
}

export { nextSeq };
