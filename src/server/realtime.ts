// Realtime: the human side runs over socket.io (see socketio.ts); the globally monotonic seq still comes from Redis INCR.
// publish() is the single global entry point; internally it maps to named realtime events and fans out to the server room.
// Note: single-instance direct emit; for multi-instance horizontal scaling switch to @socket.io/redis-adapter (TODO).
import { nextSeq } from "../redis.js";
import { emitMapped } from "./socketio.js";

export function initRealtime(): void { /* socket.io is attached in index.ts, no redis fan-out needed */ }

export async function publish(serverId: string, event: unknown): Promise<void> {
  emitMapped(serverId, event);
}

export { nextSeq };
