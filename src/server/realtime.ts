// Realtime: the human side runs over socket.io (see socketio.ts); seq comes from the workspace-local counter.
// publish() is the single global entry point; internally it maps to named realtime events and fans out to the server room.
// Note: single-instance direct emit; for multi-instance horizontal scaling switch to @socket.io/redis-adapter (TODO).
import { nextSeq } from "../counters.js";
import { emitMapped } from "./socketio.js";

export function initRealtime(): void { /* socket.io is attached in index.ts; no external fan-out needed */ }

export async function publish(serverId: string, event: unknown): Promise<void> {
  emitMapped(serverId, event);
}

export { nextSeq };
