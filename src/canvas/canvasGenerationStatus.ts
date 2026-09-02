import { eq } from "drizzle-orm";
import type { SpaceTransaction } from "../counters.js";
import { schema } from "../db/index.js";
import type { TurnCapabilityClaims } from "../capabilities/contracts.js";
import { CanvasToolError } from "./canvasToolOps.js";

export type CanvasGenerationStatusResult = {
  jobId: string;
  canvasId: string;
  kind: "image" | "video" | "audio";
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  provider: string;
  resultNodeId: string | null;
  error: string | null;
  elapsedMs: number;
  nextSuggestedAction: string;
};

function nextActionFor(job: {
  status: CanvasGenerationStatusResult["status"];
  kind: CanvasGenerationStatusResult["kind"];
  resultNodeId: string | null;
  estimatedMs: number;
}): string {
  if (job.status === "completed") {
    return job.resultNodeId
      ? `The ${job.kind} node ${job.resultNodeId} is on the canvas. Re-read canvas.scene_summary to verify placement, then continue.`
      : `The ${job.kind} finished. Re-read canvas.scene_summary to confirm the node landed, then continue.`;
  }
  if (job.status === "failed") {
    return `The ${job.kind} generation failed. Read error, adjust genPrompt, and re-queue with canvas.create_image(genPrompt) or canvas.video_generate.`;
  }
  if (job.status === "cancelled") {
    return `The ${job.kind} generation was cancelled. Re-queue with canvas.create_image(genPrompt) or canvas.video_generate if still needed.`;
  }
  return `Still ${job.status}. Poll canvas.generation_status again in ~${Math.max(1, Math.round(job.estimatedMs / 1000))}s; do not claim the ${job.kind} exists yet. After completed, confirm with canvas.scene_summary.`;
}

/**
 * Typed read path for one generation job. The jobs table has no agent column —
 * ownership resolves through job.turn_id → agent_turns.agent_id (the same
 * channel the agent path writes), so jobs created outside agent turns stay
 * invisible (fail-closed).
 */
export function executeCanvasGenerationStatus(
  tx: SpaceTransaction,
  claims: TurnCapabilityClaims,
  command: { jobId: string },
  now: number,
): CanvasGenerationStatusResult {
  const job = tx.select().from(schema.canvasGenerationJobs).where(eq(schema.canvasGenerationJobs.id, command.jobId)).get();
  if (!job) {
    throw new CanvasToolError(
      "generation_job_not_found",
      "pass jobId from the canvas.create_image(genPrompt) / canvas.video_generate feedback",
      `no generation job ${command.jobId}`,
    );
  }
  if (!job.turnId) {
    throw new CanvasToolError(
      "generation_job_not_authorized",
      "this job was not created by an agent turn and cannot be polled",
      `job ${job.id} has no owning turn`,
    );
  }
  const turn = tx.select({ agentId: schema.agentTurns.agentId }).from(schema.agentTurns).where(eq(schema.agentTurns.id, job.turnId)).get();
  if (!turn || turn.agentId !== claims.agentId) {
    throw new CanvasToolError(
      "generation_job_not_authorized",
      "generation jobs are only visible to the agent that created them",
      `job ${job.id} belongs to another agent`,
    );
  }
  const createdAtMs = job.createdAt instanceof Date ? job.createdAt.getTime() : Number(job.createdAt);
  const completedAtMs = job.completedAt == null ? null : job.completedAt instanceof Date ? job.completedAt.getTime() : Number(job.completedAt);
  const elapsedMs = Math.max(0, (completedAtMs ?? now) - createdAtMs);
  const status = job.status;
  const result: CanvasGenerationStatusResult = {
    jobId: job.id,
    canvasId: job.canvasId,
    kind: job.jobType,
    status,
    provider: job.provider,
    resultNodeId: job.resultNodeId,
    error: job.errorMessage,
    elapsedMs,
    nextSuggestedAction: "",
  };
  result.nextSuggestedAction = nextActionFor({
    status,
    kind: job.jobType,
    resultNodeId: job.resultNodeId,
    estimatedMs: job.jobType === "video" ? 120_000 : job.jobType === "audio" ? 20_000 : 30_000,
  });
  return result;
}
