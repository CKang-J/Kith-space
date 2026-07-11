// Human-facing realtime over socket.io.
// Auth: the client handshake auth carries { token, spaceId }; the server verifies the JWT +
// resolves it to the one app.db Human, then joins room space:<spaceId>.
// Events: the server fans out named events like 42["message:new",payload] (see emitMapped).
import { Server as IOServer, type Socket } from "socket.io";
import type { Server } from "node:http";
import { and, eq, isNull } from "drizzle-orm";
import { dbForSpace, schema, spaceRecord } from "../db/index.js";
import { localHumanForSubject } from "../human/humanAuthority.js";
import { canHumanReadChannel } from "./channelAccess.js";
import { verifyUser } from "./auth.js";
import { createLogger } from "../log.js";
import { spaceRoom } from "./util.js";

const log = createLogger("server:io");
let io: IOServer | null = null;

/** Mirror the HTTP CORS whitelist for socket.io handshake/polling requests.
 *  ALLOWED_ORIGIN (comma-separated) gates which browser origins may connect.
 *  Dev fallback (unset): any localhost / 127.0.0.1 origin is allowed. */
function socketIoCorsOrigin(): string | ((origin: string | undefined, cb: (err: Error | null, ok: boolean) => void) => void) {
  const v = process.env.ALLOWED_ORIGIN?.trim();
  if (v) {
    const origins = new Set(v.split(",").map(s => s.trim()).filter(Boolean));
    return (origin, cb) => cb(null, !origin || origins.has(origin));
  }
  // Dev mode: allow localhost / 127.0.0.1 (any port) or no origin (same-origin, postman)
  return (origin, cb) => {
    const ok = !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    cb(ok ? null : new Error("CORS: origin not allowed"), ok);
  };
}

export function attachSocketIO(server: Server): void {
  io = new IOServer(server, { cors: { origin: socketIoCorsOrigin() }, path: "/socket.io/" });
  io.on("connection", async (socket: Socket) => {
    const auth = (socket.handshake.auth || {}) as { token?: string; spaceId?: string };
    const subjectId = verifyUser(auth.token ?? null);
    const human = localHumanForSubject(subjectId);
    const spaceId = auth.spaceId?.trim() || null;
    if (!human || !spaceId || !spaceRecord(spaceId)) { socket.disconnect(true); return; }
    const humanId = human.id;
    let db: ReturnType<typeof dbForSpace>;
    try { db = dbForSpace(spaceId); } catch { socket.disconnect(true); return; }
    socket.data.humanId = humanId; socket.data.spaceId = spaceId;
    socket.join(spaceRoom(spaceId));
    // The canonical Human owns the Space, so realtime follows every live
    // container. Agent membership remains isolated on the agent data plane.
    const myChans = await db.select({ channelId: schema.channels.id }).from(schema.channels)
      .where(and(eq(schema.channels.spaceId, spaceId), isNull(schema.channels.deletedAt)));
    for (const c of myChans) socket.join(`channel:${c.channelId}`);
    socket.emit("rooms:joined");
    log.debug("socket connected", { humanId, spaceId, channels: myChans.length });
    // Mid-session join covers containers created after the socket connected.
    socket.on("join:channel", async (channelId: string) => {
      if (!channelId || typeof channelId !== "string") return;
      if (await canHumanReadChannel(spaceId, channelId)) socket.join(`channel:${channelId}`);
    });
    socket.on("leave:channel", (channelId: string) => { if (typeof channelId === "string") socket.leave(`channel:${channelId}`); });
    socket.on("disconnect", (reason) => log.debug("socket disconnected", { humanId, reason }));
  });
  log.info("socket.io attached", { path: "/socket.io/" });
}

// Internal event object → named realtime events. Content-bearing events (message/task) only fan out to channel:<channelId> rooms (members only),
// preventing private channel content from leaking to non-members; Space metadata events fan out to space:<spaceId>.
export function emitMapped(spaceId: string, event: any): void {
  if (!io) return;
  const srv = io;                                                           // capture non-null (io is not narrowed inside the closure)
  const room = srv.to(spaceRoom(spaceId));                                // Space-level (the single Human session)
  const chan = (cid: string) => srv.to(`channel:${cid}`);                   // channel-level (channel members only)
  switch (event?.type) {
    case "message": chan(event.message.channelId).emit("message:new", event.message); break; // content → channel members only
    case "task": {
      if (event.op === "deleted") { chan(event.channelId).emit("task:deleted", { channelId: event.channelId, taskId: event.taskId }); break; }
      const t = event.task; // = serializeMsg(message), includes channelId
      if (event.op === "created") chan(t.channelId).emit("task:created", { channelId: t.channelId, tasks: [t] });
      else chan(t.channelId).emit("task:updated", { channelId: t.channelId, task: t });
      chan(t.channelId).emit("message:updated", t); // task ops also emit message:updated to sync the source message's task fields (channel members only)
      break;
    }
    // agent:activity merges status + trajectory (carries entries[]). Internally we still keep status/trajectory as two sources; map both to this single event here.
    case "agent": room.emit("agent:activity", { agentId: event.id, name: event.name, status: event.status, activity: event.activity, detail: event.detail ?? "" }); break;
    case "trajectory": room.emit("agent:activity", { agentId: event.agentId, name: event.name, entries: event.entries }); break;
    case "agent:reply": chan(event.channelId).emit("agent:reply", event); break; // ephemeral streaming preview → channel members only, never server-wide
    case "message:updated": chan(event.message.channelId).emit("message:updated", event.message); break; // reactions/edits (content) → channel members only
    case "thread:updated": room.emit("thread:updated", { threadChannelId: event.threadChannelId, parentMessageId: event.parentMessageId, parentChannelId: event.parentChannelId, replyCount: event.replyCount, participantIds: event.participantIds, senderId: event.senderId, senderType: event.senderType }); break;
    case "agent:created": room.emit("agent:created", event.agent); break;
    case "agent:deleted": room.emit("agent:deleted", { id: event.id }); break;
    default: if (event?.type) room.emit(String(event.type), event);
  }
}
