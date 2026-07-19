import { ZodError } from "zod";
import { DisclosureGrantService, IssueDisclosureGrantCommandSchema } from "../../memory/disclosureGrantService.js";
import { HarnessError } from "../../harness/errors.js";
import { turnCapabilityService } from "../harnessComposition.js";
import { readJson, sendErr, sendJson } from "../util.js";
import type { SpaceCtx } from "./ctx.js";

export async function handleDisclosureGrants(ctx: SpaceCtx): Promise<boolean> {
  const match = /^\/api\/turns\/([^/]+)\/disclosure-grants$/.exec(ctx.p);
  if (!match || ctx.method !== "POST") return false;
  try {
    const command = IssueDisclosureGrantCommandSchema.parse(await readJson(ctx.req));
    const service = new DisclosureGrantService(ctx.spaceId);
    const grant = service.issue(match[1]!, command, ctx.humanId);
    try {
      turnCapabilityService(ctx.spaceId).authorizeDisclosureGrant(match[1]!, grant.id);
    } catch (error) {
      service.revoke(grant.id);
      throw error;
    }
    sendJson(ctx.res, 201, {
      id: grant.id,
      turnId: grant.turnId,
      targetSurfaceId: grant.targetSurfaceId,
      allowedProjection: grant.allowedProjection,
      status: grant.status,
      expiresAt: grant.expiresAt,
    });
    return true;
  } catch (error) {
    if (error instanceof ZodError) return (sendErr(ctx.res, 400, "invalid disclosure grant", { code: "invalid_command", issues: error.issues }), true);
    if (error instanceof HarnessError) {
      const status = error.code === "capability_inactive" || error.code === "session_generation_stale" ? 409 : 403;
      return (sendErr(ctx.res, status, error.message, { code: error.code, ...error.details }), true);
    }
    throw error;
  }
}
