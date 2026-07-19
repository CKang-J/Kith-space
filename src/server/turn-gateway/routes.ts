import type { IncomingMessage, ServerResponse } from "node:http";
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { dbForSpace, schema } from "../../db/index.js";
import { HarnessError } from "../../harness/errors.js";
import { requestPeerIsLoopback } from "../browserSessionHttp.js";
import { capabilityGateway, coreSessionCapabilityBroker, scheduleV2Turns, turnCapabilityService, turnOutputService } from "../harnessComposition.js";
import { sendErr, sendJson } from "../util.js";
import { parseUpload } from "../attachments.js";
import { deleteObject } from "../../files/localObjectStorage.js";
import { TEMPORARY_ATTACHMENT_TTL_MS, cleanupTemporaryAttachments } from "../../files/temporaryAttachmentCleanup.js";
import { assertAgentSurfaceAccessInTransaction } from "../../channels/agentSurfaceAccess.js";
import {
  ChecklistClearCommandSchema,
  ChecklistUpsertCommandSchema,
  ContextCheckCommandSchema,
  ConversationReadCommandSchema,
  ConversationSearchCommandSchema,
  MemoryGetCommandSchema,
  MemoryRecallCommandSchema,
  ScheduleWakeupCommandSchema,
  TaskAssignCommandSchema,
  TaskClaimCommandSchema,
  TaskCreateCommandSchema,
  TaskDeliverCommandSchema,
  TaskGetCommandSchema,
  TaskListCommandSchema,
  TaskReportCommandSchema,
  TaskUnclaimCommandSchema,
  TaskUpdateCommandSchema,
  TurnCedeCommandSchema,
  TurnReplyCommandSchema,
  TurnProgressCommandSchema,
  type GatewayScope,
} from "../../capabilities/gatewayContracts.js";

function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name];
  return typeof value === "string" ? value : "";
}

class GatewayRequestError extends Error {}

function authorize(req: IncomingMessage, scope: GatewayScope) {
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
  const transport = header(req, "x-kith-gateway-transport");
  if (transport !== "cli" && transport !== "mcp") throw new HarnessError("capability_inactive", "missing Gateway transport identity");
  capabilityGateway(claims.spaceId).observeTransport(claims, transport);
  return { claims, sessionHandle, session };
}

async function readGatewayJson(req: IncomingMessage, maxBytes = 1_048_576): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = "";
    let tooLarge = false;
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      size += Buffer.byteLength(chunk);
      if (size > maxBytes) {
        tooLarge = true;
        body = "";
        return;
      }
      if (!tooLarge) body += chunk;
    });
    req.on("error", reject);
    req.on("end", () => {
      if (tooLarge) return reject(new GatewayRequestError("Gateway request body exceeds 1 MiB"));
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new GatewayRequestError("Gateway request body is not valid JSON")); }
    });
  });
}

function statusFor(error: HarnessError): number {
  if (error.code === "capability_inactive" || error.code === "capability_expired" || error.code === "capability_revoked") return 401;
  if (error.code === "capability_scope_denied" || error.code === "reply_target_denied" || error.code === "disclosure_denied") return 403;
  return 409;
}

export async function handleTurnGateway(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (!url.pathname.startsWith("/agent-gateway/")) return false;
  if (!requestPeerIsLoopback(req)) {
    sendErr(res, 404, "not found");
    return true;
  }
  try {
    if (url.pathname === "/agent-gateway/turn/context" && method === "GET") {
      const { claims, sessionHandle } = authorize(req, "context.check");
      const command = ContextCheckCommandSchema.parse({ refresh: url.searchParams.get("refresh") === "true" });
      const result = capabilityGateway(claims.spaceId).contextCheck(claims, command.refresh);
      if (command.refresh) turnCapabilityService(claims.spaceId).refreshSeenWatermark({
        sessionHandle,
        activationId: claims.activationId,
        workerGeneration: claims.workerGeneration,
        channelId: result.target.surfaceId,
        throughSeq: result.refreshedThroughSeq,
      });
      sendJson(res, 200, result);
      return true;
    }
    if (url.pathname === "/agent-gateway/turn/attachment/upload" && method === "POST") {
      const initial = authorize(req, "attachment.upload");
      await cleanupTemporaryAttachments(initial.claims.spaceId);
      const { files } = await parseUpload(initial.claims.spaceId, req);
      try {
        const { claims, session } = authorize(req, "attachment.upload");
        if (!files.length) throw new HarnessError("capability_scope_denied", "attachment upload requires at least one file");
        const attachments = dbForSpace(claims.spaceId).transaction((tx) => {
          capabilityGateway(claims.spaceId).writePrecondition(claims, "attachment.upload")(tx, session.surfaceId);
          return files.map((file) => tx.insert(schema.attachments).values({
            spaceId: claims.spaceId,
            channelId: session.surfaceId,
            uploaderType: "agent",
            uploaderId: claims.agentId,
            filename: file.filename,
            mimeType: file.mimeType,
            sizeBytes: file.size,
            storageKey: file.storageKey,
            uploadState: "temporary",
            sourceTurnId: claims.turnId,
            sourceActivationId: claims.activationId,
            expiresAt: new Date(Date.now() + TEMPORARY_ATTACHMENT_TTL_MS),
          }).returning().get());
        });
        sendJson(res, 200, {
          attachments: attachments.map((attachment) => ({
            attachmentId: attachment.id,
            id: attachment.id,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
          })),
          attachmentId: attachments[0]?.id,
        });
      } catch (error) {
        await Promise.allSettled(files.map((file) => deleteObject(initial.claims.spaceId, file.storageKey)));
        throw error;
      }
      return true;
    }
    if (url.pathname === "/agent-gateway/turn/reply" && method === "POST") {
      const body = TurnReplyCommandSchema.parse(await readGatewayJson(req));
      const { claims } = authorize(req, "turn.reply");
      const handledInputIds = body.handledInputIds;
      if (handledInputIds.some((id: string) => !claims.allowedInputIds.includes(id))) {
        throw new HarnessError("capability_scope_denied", "reply references an input outside the activation");
      }
      const message = await turnOutputService(claims.spaceId).reply({
        turnId: claims.turnId,
        attemptId: claims.attemptId,
        idempotencyKey: body.operationKey,
        body: body.body,
        attachmentIds: body.attachmentIds,
        sourceRefs: body.sourceRefs,
        disclosureGrantId: body.disclosureGrantId,
        allowedDisclosureGrantIds: claims.disclosureGrantIds,
        attachmentActivationId: claims.activationId,
        handledInputIds,
        writePrecondition: capabilityGateway(claims.spaceId).writePrecondition(claims, "turn.reply"),
      });
      sendJson(res, 200, { ok: true, messageId: message.id, seq: message.seq, channelId: message.channelId });
      return true;
    }
    if (url.pathname === "/agent-gateway/turn/progress" && method === "POST") {
      const body = TurnProgressCommandSchema.parse(await readGatewayJson(req));
      const { claims } = authorize(req, "turn.progress");
      sendJson(res, 200, { ok: true, ...capabilityGateway(claims.spaceId).progress(claims, body) });
      return true;
    }
    if (url.pathname === "/agent-gateway/turn/get" && method === "GET") {
      const { claims } = authorize(req, "turn.get");
      sendJson(res, 200, capabilityGateway(claims.spaceId).turnGet(claims));
      return true;
    }
    if (url.pathname === "/agent-gateway/session/checklist" && method === "GET") {
      const { claims } = authorize(req, "session.checklist");
      sendJson(res, 200, capabilityGateway(claims.spaceId).checklistList(claims));
      return true;
    }
    if (url.pathname === "/agent-gateway/session/checklist/upsert" && method === "POST") {
      const body = ChecklistUpsertCommandSchema.parse(await readGatewayJson(req));
      const { claims } = authorize(req, "session.checklist");
      sendJson(res, 200, { ok: true, ...capabilityGateway(claims.spaceId).checklistUpsert(claims, body) });
      return true;
    }
    if (url.pathname === "/agent-gateway/session/checklist/clear" && method === "POST") {
      const body = ChecklistClearCommandSchema.parse(await readGatewayJson(req));
      const { claims } = authorize(req, "session.checklist");
      sendJson(res, 200, { ok: true, ...capabilityGateway(claims.spaceId).checklistClear(claims, body) });
      return true;
    }
    if (url.pathname === "/agent-gateway/session/wakeup" && method === "POST") {
      const body = ScheduleWakeupCommandSchema.parse(await readGatewayJson(req));
      const { claims } = authorize(req, "session.schedule_wakeup");
      const result = capabilityGateway(claims.spaceId).scheduleWakeup(claims, body);
      await scheduleV2Turns(claims.spaceId);
      sendJson(res, 200, { ok: true, ...result });
      return true;
    }
    if (url.pathname === "/agent-gateway/conversation/read" && method === "POST") {
      const body = ConversationReadCommandSchema.parse(await readGatewayJson(req));
      const { claims } = authorize(req, "conversation.read");
      sendJson(res, 200, capabilityGateway(claims.spaceId).conversationRead(claims, body));
      return true;
    }
    if (url.pathname === "/agent-gateway/conversation/search" && method === "POST") {
      const body = ConversationSearchCommandSchema.parse(await readGatewayJson(req));
      const { claims } = authorize(req, "conversation.search");
      sendJson(res, 200, capabilityGateway(claims.spaceId).conversationSearch(claims, body));
      return true;
    }
    if (url.pathname === "/agent-gateway/memory/recall" && method === "POST") {
      const body = MemoryRecallCommandSchema.parse(await readGatewayJson(req));
      const { claims } = authorize(req, "memory.read");
      sendJson(res, 200, capabilityGateway(claims.spaceId).memoryRecall(claims, body));
      return true;
    }
    if (url.pathname === "/agent-gateway/memory/get" && method === "POST") {
      const body = MemoryGetCommandSchema.parse(await readGatewayJson(req));
      const { claims } = authorize(req, "memory.read");
      sendJson(res, 200, capabilityGateway(claims.spaceId).memoryGet(claims, body));
      return true;
    }
    if (url.pathname === "/agent-gateway/capability/describe" && method === "GET") {
      const { claims } = authorize(req, "capability.describe");
      sendJson(res, 200, capabilityGateway(claims.spaceId).capabilityDescribe(claims));
      return true;
    }
    if (url.pathname === "/agent-gateway/task/list" && method === "POST") {
      const body = TaskListCommandSchema.parse(await readGatewayJson(req));
      const { claims } = authorize(req, "task.read");
      sendJson(res, 200, capabilityGateway(claims.spaceId).taskList(claims, body));
      return true;
    }
    if (url.pathname === "/agent-gateway/task/get" && method === "POST") {
      const body = TaskGetCommandSchema.parse(await readGatewayJson(req));
      const { claims } = authorize(req, "task.read");
      sendJson(res, 200, await capabilityGateway(claims.spaceId).taskGet(claims, body));
      return true;
    }
    if (url.pathname === "/agent-gateway/task/create" && method === "POST") {
      const body = TaskCreateCommandSchema.parse(await readGatewayJson(req));
      const { claims } = authorize(req, "task.write");
      sendJson(res, 200, { ok: true, ...await capabilityGateway(claims.spaceId).taskCreate(claims, body) });
      return true;
    }
    if (url.pathname === "/agent-gateway/task/claim" && method === "POST") {
      const body = TaskClaimCommandSchema.parse(await readGatewayJson(req));
      const { claims } = authorize(req, "task.write");
      sendJson(res, 200, { ok: true, ...await capabilityGateway(claims.spaceId).taskClaim(claims, body) });
      return true;
    }
    if (url.pathname === "/agent-gateway/task/update" && method === "POST") {
      const body = TaskUpdateCommandSchema.parse(await readGatewayJson(req));
      const { claims } = authorize(req, "task.write");
      sendJson(res, 200, { ok: true, ...await capabilityGateway(claims.spaceId).taskUpdate(claims, body) });
      return true;
    }
    if (url.pathname === "/agent-gateway/task/assign" && method === "POST") {
      const body = TaskAssignCommandSchema.parse(await readGatewayJson(req));
      const { claims } = authorize(req, "task.write");
      sendJson(res, 200, { ok: true, ...await capabilityGateway(claims.spaceId).taskAssign(claims, body) });
      return true;
    }
    if (url.pathname === "/agent-gateway/task/unclaim" && method === "POST") {
      const body = TaskUnclaimCommandSchema.parse(await readGatewayJson(req));
      const { claims } = authorize(req, "task.write");
      sendJson(res, 200, { ok: true, ...await capabilityGateway(claims.spaceId).taskUnclaim(claims, body) });
      return true;
    }
    if (url.pathname === "/agent-gateway/task/report" && method === "POST") {
      const body = TaskReportCommandSchema.parse(await readGatewayJson(req));
      const { claims } = authorize(req, "task.write");
      sendJson(res, 200, { ok: true, ...await capabilityGateway(claims.spaceId).taskReport(claims, body) });
      return true;
    }
    if (url.pathname === "/agent-gateway/task/deliver" && method === "POST") {
      const body = TaskDeliverCommandSchema.parse(await readGatewayJson(req));
      const { claims } = authorize(req, "task.write");
      sendJson(res, 200, { ok: true, ...await capabilityGateway(claims.spaceId).taskDeliver(claims, body) });
      return true;
    }
    if (url.pathname === "/agent-gateway/turn/cede" && method === "POST") {
      const body = TurnCedeCommandSchema.parse(await readGatewayJson(req));
      const { claims } = authorize(req, "turn.cede");
      const inputIds = body.inputIds;
      if (inputIds.some((id: string) => !claims.allowedInputIds.includes(id))) {
        throw new HarnessError("capability_scope_denied", "cede references an input outside the activation");
      }
      const result = turnOutputService(claims.spaceId).cede({
        turnId: claims.turnId,
        attemptId: claims.attemptId,
        idempotencyKey: body.operationKey,
        inputIds,
        reason: body.reason,
        writePrecondition: capabilityGateway(claims.spaceId).writePrecondition(claims, "turn.cede"),
      });
      sendJson(res, 200, { ok: true, ...result });
      return true;
    }
    sendErr(res, 404, "not found");
    return true;
  } catch (error) {
    if (error instanceof GatewayRequestError) {
      sendErr(res, 400, error.message, { code: "invalid_command" });
      return true;
    }
    if (error instanceof ZodError) {
      sendErr(res, 400, "invalid gateway command", { code: "invalid_command", issues: error.issues });
      return true;
    }
    if (error instanceof HarnessError) {
      sendErr(res, statusFor(error), error.message, { code: error.code, ...error.details });
      return true;
    }
    throw error;
  }
}
