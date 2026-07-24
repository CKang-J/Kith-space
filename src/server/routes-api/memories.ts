import { ZodError } from "zod";
import { EpisodicMemoryService, MemoryError } from "../../memory/episodicMemoryService.js";
import { UserGlobalMemoryService } from "../../memory/userGlobalMemoryService.js";
import { MemoryManagementService } from "../../memory/memoryManagementService.js";
import { readJson, sendErr, sendJson } from "../util.js";
import type { SpaceCtx } from "./ctx.js";

function memoryError(ctx: SpaceCtx, error: unknown): boolean {
  if (error instanceof ZodError) {
    sendErr(ctx.res, 400, "invalid memory command", { code: "MEMORY_INVALID", issues: error.issues });
    return true;
  }
  if (!(error instanceof MemoryError)) throw error;
  const status = error.code === "MEMORY_NOT_FOUND" ? 404
    : error.code === "MEMORY_FORBIDDEN" ? 403
    : error.code === "MEMORY_CONFLICT" || error.code === "MEMORY_SUPPRESSED" ? 409
    : 400;
  sendErr(ctx.res, status, error.message, { code: error.code });
  return true;
}

/** Human-only memory control plane. Agent access stays behind the turn capability broker. */
export async function handleMemories(ctx: SpaceCtx): Promise<boolean> {
  if (!ctx.p.startsWith("/api/memories")) return false;
  const workspace = new EpisodicMemoryService(ctx.spaceId);
  const global = new UserGlobalMemoryService();
  const actor = { type: "human" as const, id: ctx.humanId };
  try {
    if (ctx.p === "/api/memories" && ctx.method === "GET") {
      const scope = ctx.url.searchParams.get("scope");
      const status = ctx.url.searchParams.get("status") || undefined;
      const ownerAgentId = ctx.url.searchParams.get("ownerAgentId") || undefined;
      if (scope === "user_global") {
        const items = global.listHuman(status).map((record) => ({ scope: "user_global" as const, ...record }));
        sendJson(ctx.res, 200, { items, page: 1, pageSize: items.length, total: items.length });
        return true;
      }
      const result = new MemoryManagementService(ctx.spaceId).list({
        ownerAgentId,
        query: ctx.url.searchParams.get("q") || undefined,
        status,
        kind: ctx.url.searchParams.get("kind") || undefined,
        scope: scope || undefined,
        tag: ctx.url.searchParams.get("tag") || undefined,
        sourceSurfaceId: ctx.url.searchParams.get("sourceSurfaceId") || undefined,
        sourceAccessRevoked: ctx.url.searchParams.get("sourceAccessRevoked") === "true",
        updatedAfter: ctx.url.searchParams.has("updatedAfter") ? Number(ctx.url.searchParams.get("updatedAfter")) : undefined,
        updatedBefore: ctx.url.searchParams.has("updatedBefore") ? Number(ctx.url.searchParams.get("updatedBefore")) : undefined,
        page: Number(ctx.url.searchParams.get("page") ?? 1),
        pageSize: Number(ctx.url.searchParams.get("pageSize") ?? 25),
      });
      sendJson(ctx.res, 200, result);
      return true;
    }
    if (ctx.p === "/api/memories" && ctx.method === "POST") {
      const body = await readJson<Record<string, unknown>>(ctx.req);
      const command = { ...body, actor } as never;
      const record = body.scope === "user_global" ? global.create(command) : workspace.create(command);
      sendJson(ctx.res, 201, record);
      return true;
    }
    if (ctx.p === "/api/memories/suppressions" && ctx.method === "GET") {
      const scope = ctx.url.searchParams.get("scope");
      const items = scope === "user_global"
        ? global.listSuppressions().map((item) => ({ scope: "user_global" as const, item }))
        : workspace.listSuppressions({
            scope: scope === "agent_private" || scope === "space_shared" ? scope : undefined,
            ownerAgentId: ctx.url.searchParams.get("ownerAgentId") || undefined,
          }).map((item) => ({ scope: "workspace" as const, item }));
      sendJson(ctx.res, 200, { items });
      return true;
    }
    const suppression = /^\/api\/memories\/suppressions\/([^/]+)\/revoke$/.exec(ctx.p);
    if (suppression && ctx.method === "POST") {
      const record = ctx.url.searchParams.get("scope") === "user_global"
        ? global.revokeSuppression(suppression[1]!, actor)
        : workspace.revokeSuppression(suppression[1]!, actor);
      sendJson(ctx.res, 200, record);
      return true;
    }
    const match = /^\/api\/memories\/([^/]+)$/.exec(ctx.p);
    if (match && ctx.method === "GET") {
      const record = ctx.url.searchParams.get("scope") === "user_global"
        ? global.getHumanDetail(match[1]!)
        : new MemoryManagementService(ctx.spaceId).detail(match[1]!, ctx.url.searchParams.get("ownerAgentId") || undefined);
      sendJson(ctx.res, 200, record);
      return true;
    }
    const mutation = /^\/api\/memories\/([^/]+)\/mutate$/.exec(ctx.p);
    if (mutation && ctx.method === "POST") {
      const body = await readJson<Record<string, unknown>>(ctx.req);
      const command = { ...body, memoryId: mutation[1] } as never;
      const record = ctx.url.searchParams.get("scope") === "user_global"
        ? global.mutate(command, actor)
        : workspace.mutate(command, actor);
      sendJson(ctx.res, 200, record);
      return true;
    }
    return false;
  } catch (error) {
    return memoryError(ctx, error);
  }
}
