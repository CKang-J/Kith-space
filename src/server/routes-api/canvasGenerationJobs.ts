import { dbForSpace } from "../../db/index.js";
import { getGenerationJob, listGenerationJobsByTurn } from "../../canvas/generation/generationJobQueue.js";
import { kickGenerationWorker } from "../../canvas/generation/generationSupervisor.js";
import {
  CanvasNotFoundError,
  CanvasValidationError,
  enqueueHumanCanvasGenerationJob,
  publicGenerationJob,
} from "../../canvas/generation/humanGeneration.js";
import { readJson, sendErr, sendJson } from "../util.js";
import type { SpaceCtx } from "./ctx.js";

/**
 * Human generation jobs:
 *   POST /api/canvases/:canvasId/generation-jobs
 *   GET  /api/canvases/:canvasId/generation-jobs/:jobId
 *   GET  /api/spaces/:spaceId/canvas-generation-jobs/:jobId
 *   GET  /api/canvas-generation-jobs/by-turn/:turnId
 *
 * Agent enqueue stays on the Gateway; this route does not require a Canvas Access Grant.
 */
export async function handleCanvasGenerationJobs(ctx: SpaceCtx): Promise<boolean> {
  const canvasPost = /^\/api\/canvases\/([^/]+)\/generation-jobs$/.exec(ctx.p);
  if (canvasPost && ctx.method === "POST") {
    const canvasId = decodeURIComponent(canvasPost[1]!);
    try {
      const body = await readJson<Record<string, unknown>>(ctx.req);
      const job = enqueueHumanCanvasGenerationJob(dbForSpace(ctx.spaceId), ctx.spaceId, canvasId, {
        jobType: body.jobType,
        genPrompt: body.genPrompt,
        placement: body.placement,
        config: body.config,
        idempotencyKey: body.idempotencyKey,
      });
      kickGenerationWorker(ctx.spaceId);
      return (sendJson(ctx.res, 201, publicGenerationJob(job, ctx.spaceId)), true);
    } catch (error) {
      return sendGenerationError(ctx, error);
    }
  }

  const canvasGet = /^\/api\/canvases\/([^/]+)\/generation-jobs\/([^/]+)$/.exec(ctx.p);
  if (canvasGet && ctx.method === "GET") {
    const canvasId = decodeURIComponent(canvasGet[1]!);
    const jobId = decodeURIComponent(canvasGet[2]!);
    const job = getGenerationJob(dbForSpace(ctx.spaceId), jobId);
    if (!job || job.canvasId !== canvasId) {
      return (sendErr(ctx.res, 404, "Generation job not found"), true);
    }
    return (sendJson(ctx.res, 200, publicGenerationJob(job, ctx.spaceId)), true);
  }

  const spaceGet = /^\/api\/spaces\/[^/]+\/canvas-generation-jobs\/([^/]+)$/.exec(ctx.p);
  if (spaceGet && ctx.method === "GET") {
    const jobId = decodeURIComponent(spaceGet[1]!);
    const job = getGenerationJob(dbForSpace(ctx.spaceId), jobId);
    if (!job) return (sendErr(ctx.res, 404, "Generation job not found"), true);
    return (sendJson(ctx.res, 200, publicGenerationJob(job, ctx.spaceId)), true);
  }

  const turnGet = /^\/api\/canvas-generation-jobs\/by-turn\/([^/]+)$/.exec(ctx.p);
  if (turnGet && ctx.method === "GET") {
    const turnId = decodeURIComponent(turnGet[1]!);
    const jobs = listGenerationJobsByTurn(dbForSpace(ctx.spaceId), turnId);
    return (sendJson(ctx.res, 200, { jobs: jobs.map((job) => publicGenerationJob(job, ctx.spaceId)) }), true);
  }

  return false;
}

function sendGenerationError(ctx: SpaceCtx, error: unknown): true {
  if (error instanceof CanvasNotFoundError) return (sendErr(ctx.res, 404, error.message), true);
  if (error instanceof CanvasValidationError) return (sendErr(ctx.res, 400, error.message), true);
  throw error;
}
