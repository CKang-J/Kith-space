import { ZodError, z } from "zod";
import { MemoryAdvisorService, scheduleMemoryAdvisorProcessing } from "../../memory/memoryAdvisorService.js";
import { MemoryError } from "../../memory/episodicMemoryService.js";
import { readJson, sendErr, sendJson } from "../util.js";
import type { SpaceCtx } from "./ctx.js";
import { AdvisorProviderSettingsService } from "../../advisor-provider/advisorProviderSettingsService.js";
import { AdvisorProviderError } from "../../advisor-provider/contracts.js";

const SettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  paused: z.boolean().optional(),
  autoActivatePrivate: z.boolean().optional(),
  dailyTokenLimit: z.number().int().nonnegative().optional(),
  dailyCostMicrosLimit: z.number().int().nonnegative().optional(),
}).strict();

function sendMemoryError(ctx: SpaceCtx, error: unknown): boolean {
  if (error instanceof ZodError) return (sendErr(ctx.res, 400, "invalid advisor settings", { code: "MEMORY_INVALID", issues: error.issues }), true);
  if (!(error instanceof MemoryError)) throw error;
  const status = error.code === "MEMORY_NOT_FOUND" ? 404 : error.code === "MEMORY_FORBIDDEN" ? 403 : error.code === "MEMORY_CONFLICT" ? 409 : 400;
  return (sendErr(ctx.res, status, error.message, { code: error.code }), true);
}

/** Human-only advisor settings, debug queue, and proposal decisions. */
export async function handleMemoryAdvisor(ctx: SpaceCtx): Promise<boolean> {
  const settings = /^\/api\/agents\/([^/]+)\/memory-advisor$/.exec(ctx.p);
  const consent = /^\/api\/agents\/([^/]+)\/memory-advisor\/(consent|revoke)$/.exec(ctx.p);
  const proposal = /^\/api\/memories\/([^/]+)\/(accept|reject)$/.exec(ctx.p);
  if (!settings && !consent && !proposal && ctx.p !== "/api/memory-advisor/jobs" && ctx.p !== "/api/memory-advisor/process") return false;
  const service = new MemoryAdvisorService(ctx.spaceId);
  try {
    if (settings && ctx.method === "GET") {
      sendJson(ctx.res, 200, service.settings(settings[1]!));
      return true;
    }
    if (settings && ctx.method === "PATCH") {
      const body = SettingsPatchSchema.parse(await readJson(ctx.req));
      const result = service.updateSettings(settings[1]!, body);
      if (body.enabled !== false && body.paused !== true) void scheduleMemoryAdvisorProcessing(ctx.spaceId);
      sendJson(ctx.res, 200, result);
      return true;
    }
    if (consent && ctx.method === "POST") {
      const providers = new AdvisorProviderSettingsService();
      if (consent[2] === "revoke") {
        await providers.revokeAgent(ctx.spaceId, consent[1]!);
        sendJson(ctx.res, 200, service.settings(consent[1]!));
      } else {
        const body = z.object({ sourceScope: z.object({ public: z.boolean(), private: z.boolean(), dm: z.boolean() }).strict() }).strict().parse(await readJson(ctx.req));
        sendJson(ctx.res, 200, providers.consentAgent(ctx.spaceId, consent[1]!, ctx.humanId, body.sourceScope));
      }
      return true;
    }
    if (ctx.p === "/api/memory-advisor/jobs" && ctx.method === "GET") {
      sendJson(ctx.res, 200, { items: service.listJobs({
        agentId: ctx.url.searchParams.get("agentId") || undefined,
        status: ctx.url.searchParams.get("status") || undefined,
        limit: Number(ctx.url.searchParams.get("limit") ?? 50),
      }) });
      return true;
    }
    if (ctx.p === "/api/memory-advisor/process" && ctx.method === "POST") {
      void scheduleMemoryAdvisorProcessing(ctx.spaceId);
      sendJson(ctx.res, 202, { queued: true });
      return true;
    }
    if (proposal && ctx.method === "POST") {
      const body = await readJson<Record<string, unknown>>(ctx.req);
      const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
      const result = service.decideProposal(proposal[1]!, proposal[2] === "accept" ? "accept" : "reject", {
        type: "human",
        id: ctx.humanId,
      }, idempotencyKey);
      sendJson(ctx.res, 200, result);
      return true;
    }
    return false;
  } catch (error) {
    if (error instanceof AdvisorProviderError) return (sendErr(ctx.res, 409, error.message, { code: error.code }), true);
    return sendMemoryError(ctx, error);
  }
}
