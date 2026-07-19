import { ZodError } from "zod";
import { EpisodicMemoryService, MemoryError } from "../../memory/episodicMemoryService.js";
import { UserGlobalMemoryService } from "../../memory/userGlobalMemoryService.js";
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
      const items = scope === "user_global"
        ? global.listHuman(status).map((record) => ({ scope: "user_global" as const, ...record }))
        : scope === "agent_private" || scope === "space_shared"
          ? workspace.listHuman({ scope, ownerAgentId, status }).map((record) => ({ scope: "workspace" as const, ...record }))
          : [
              ...workspace.listHuman({ ownerAgentId, status }).map((record) => ({ scope: "workspace" as const, ...record })),
              ...global.listHuman(status).map((record) => ({ scope: "user_global" as const, ...record })),
            ];
      sendJson(ctx.res, 200, { items });
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
        : workspace.getHumanDetail(match[1]!);
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
