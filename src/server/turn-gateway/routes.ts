import type { IncomingMessage, ServerResponse } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import { dbForSpace, schema } from "../../db/index.js";
import { HarnessError } from "../../harness/errors.js";
import { requestPeerIsLoopback } from "../browserSessionHttp.js";
import { coreSessionCapabilityBroker, turnCapabilityService, turnOutputService } from "../harnessComposition.js";
import { readJson, sendErr, sendJson } from "../util.js";
import { assertAgentSurfaceAccessInTransaction } from "../../channels/agentSurfaceAccess.js";

function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name];
  return typeof value === "string" ? value : "";
}

function authorize(req: IncomingMessage, scope: "context.check" | "turn.reply" | "turn.cede") {
  const sessionHandle = header(req, "x-kith-session-handle");
  const activationId = header(req, "x-kith-activation-id");
  const workerGeneration = Number(header(req, "x-kith-worker-generation"));
  if (!sessionHandle || !activationId || !Number.isInteger(workerGeneration)) {
    throw new HarnessError("capability_inactive", "missing broker activation headers");
  }
  const claims = coreSessionCapabilityBroker.resolve({ sessionHandle, activationId, workerGeneration });
  turnCapabilityService(claims.spaceId).resolve({ sessionHandle, activationId, workerGeneration, scope });
  const db = dbForSpace(claims.spaceId);
  const session = db.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.id, claims.sessionId)).get();
  if (!session || session.sessionGeneration !== claims.sessionGeneration || session.retiredAt) {
    throw new HarnessError("session_generation_stale", "Gateway session is no longer current", { sessionId: claims.sessionId });
  }
  db.transaction((tx) => assertAgentSurfaceAccessInTransaction(tx, {
    spaceId: claims.spaceId,
    channelId: session.surfaceId,
    agentId: claims.agentId,
  }));
  return { claims, sessionHandle };
}

function statusFor(error: HarnessError): number {
  if (error.code === "capability_inactive" || error.code === "capability_expired" || error.code === "capability_revoked") return 401;
  if (error.code === "capability_scope_denied" || error.code === "reply_target_denied") return 403;
  return 409;
}

export async function handleTurnGateway(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (!url.pathname.startsWith("/agent-gateway/turn/")) return false;
  if (!requestPeerIsLoopback(req)) {
    sendErr(res, 404, "not found");
    return true;
  }
  try {
    if (url.pathname === "/agent-gateway/turn/context" && method === "GET") {
      const { claims } = authorize(req, "context.check");
      const db = dbForSpace(claims.spaceId);
      const deliveries = claims.allowedInputIds.length ? db.select().from(schema.agentDeliveryItems)
        .where(and(eq(schema.agentDeliveryItems.turnId, claims.turnId), inArray(schema.agentDeliveryItems.id, claims.allowedInputIds))).all() : [];
      const messages = deliveries.length ? db.select().from(schema.messages)
        .where(inArray(schema.messages.id, deliveries.map((delivery) => delivery.messageId))).all() : [];
      const messageById = new Map(messages.map((message) => [message.id, message]));
      const session = db.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.id, claims.sessionId)).get();
      const turn = db.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, claims.turnId)).get();
      sendJson(res, 200, {
        turnId: claims.turnId,
        attemptId: claims.attemptId,
        activationId: claims.activationId,
        target: session ? { surfaceKind: session.surfaceKind, surfaceId: session.surfaceId } : null,
        contextEnvelope: turn?.contextEnvelope ?? null,
        inputs: deliveries.map((delivery) => ({
          id: delivery.id,
          directive: delivery.directive,
          reason: delivery.reason,
          sourceChannelId: delivery.sourceChannelId,
          sourceSeq: delivery.sourceSeq,
          message: messageById.get(delivery.messageId) ?? null,
        })),
      });
      return true;
    }
    if (url.pathname === "/agent-gateway/turn/reply" && method === "POST") {
      const { claims } = authorize(req, "turn.reply");
      const body = await readJson(req);
      const handledInputIds = Array.isArray(body.handledInputIds) ? body.handledInputIds.filter((id: unknown): id is string => typeof id === "string") : [];
      if (handledInputIds.some((id: string) => !claims.allowedInputIds.includes(id))) {
        throw new HarnessError("capability_scope_denied", "reply references an input outside the activation");
      }
      const message = await turnOutputService(claims.spaceId).reply({
        turnId: claims.turnId,
        attemptId: claims.attemptId,
        idempotencyKey: String(body.idempotencyKey ?? "reply:primary"),
        body: String(body.body ?? ""),
        handledInputIds,
      });
      sendJson(res, 200, { ok: true, messageId: message.id, seq: message.seq, channelId: message.channelId });
      return true;
    }
    if (url.pathname === "/agent-gateway/turn/cede" && method === "POST") {
      const { claims } = authorize(req, "turn.cede");
      const body = await readJson(req);
      const inputIds = Array.isArray(body.inputIds) ? body.inputIds.filter((id: unknown): id is string => typeof id === "string") : [];
      if (inputIds.some((id: string) => !claims.allowedInputIds.includes(id))) {
        throw new HarnessError("capability_scope_denied", "cede references an input outside the activation");
      }
      const result = turnOutputService(claims.spaceId).cede({
        turnId: claims.turnId,
        attemptId: claims.attemptId,
        idempotencyKey: String(body.idempotencyKey ?? "cede:primary"),
        inputIds,
        reason: String(body.reason ?? ""),
      });
      sendJson(res, 200, { ok: true, ...result });
      return true;
    }
    sendErr(res, 404, "not found");
    return true;
  } catch (error) {
    if (error instanceof HarnessError) {
      sendErr(res, statusFor(error), error.message, { code: error.code, ...error.details });
      return true;
    }
    throw error;
  }
}
