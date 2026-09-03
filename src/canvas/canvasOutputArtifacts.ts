import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { SpaceTransaction } from "../counters.js";
import type { SpaceDb } from "../db/index.js";
import { schema } from "../db/index.js";
import { HarnessError } from "../harness/errors.js";
import { isCanvasMutationToolName } from "./canvasAgentTools.js";
import { resolveCanvasAccessGrantInTransaction } from "./canvasAccessGrant.js";

export type CanvasOutputRef = {
  kind: "canvas_mutation" | "canvas_generation_job";
  artifactId: string;
};

type ArtifactQueryable = SpaceDb | SpaceTransaction;

function denied(message: string): HarnessError {
  return new HarnessError("capability_scope_denied", message);
}

/** Bind committed Canvas mutations / queued generation jobs to a turn.reply output. sourceRefs cannot substitute. */
export function bindCanvasOutputArtifactsInTransaction(
  tx: SpaceTransaction,
  input: {
    spaceId: string;
    turnId: string;
    outputId: string;
    outputRefs: CanvasOutputRef[];
  },
): void {
  const seen = new Set<string>();
  for (const ref of input.outputRefs) {
    const dedupeKey = `${ref.kind}:${ref.artifactId}`;
    if (seen.has(dedupeKey)) {
      throw denied(`duplicate ${ref.kind} outputRef`);
    }
    seen.add(dedupeKey);
    if (ref.kind === "canvas_mutation") {
      bindMutationArtifact(tx, input, ref.artifactId);
    } else {
      bindGenerationJobArtifact(tx, input, ref.artifactId);
    }
  }
}

function bindMutationArtifact(
  tx: SpaceTransaction,
  input: {
    spaceId: string;
    turnId: string;
    outputId: string;
  },
  mutationId: string,
): void {
  const mutation = tx.select().from(schema.canvasMutations).where(eq(schema.canvasMutations.id, mutationId)).get();
  if (!mutation) {
    throw denied("canvas_mutation outputRef does not reference a committed mutation");
  }
  const canvas = tx.select({
    id: schema.canvasDocuments.id,
    spaceId: schema.canvasDocuments.spaceId,
  }).from(schema.canvasDocuments).where(eq(schema.canvasDocuments.id, mutation.canvasId)).get();
  if (!canvas || canvas.spaceId !== input.spaceId) {
    throw denied("canvas_mutation outputRef is outside this Space");
  }
  const operation = tx.select().from(schema.turnOperations).where(and(
    eq(schema.turnOperations.id, mutation.operationId),
    eq(schema.turnOperations.turnId, input.turnId),
    eq(schema.turnOperations.status, "committed"),
  )).get();
  if (!operation || !isCanvasMutationToolName(operation.toolName)) {
    throw denied("canvas_mutation outputRef must reference a mutation committed by this turn via a Canvas write tool");
  }
  const existing = tx.select().from(schema.turnOutputArtifacts).where(and(
    eq(schema.turnOutputArtifacts.kind, "canvas_mutation"),
    eq(schema.turnOutputArtifacts.artifactId, mutationId),
  )).get();
  if (existing) {
    if (existing.outputId !== input.outputId || existing.turnId !== input.turnId) {
      throw denied("canvas_mutation artifact is already bound to another output");
    }
    return;
  }
  tx.insert(schema.turnOutputArtifacts).values({
    id: randomUUID(),
    outputId: input.outputId,
    turnId: input.turnId,
    kind: "canvas_mutation",
    artifactId: mutationId,
  }).run();
}

function bindGenerationJobArtifact(
  tx: SpaceTransaction,
  input: {
    spaceId: string;
    turnId: string;
    outputId: string;
  },
  jobId: string,
): void {
  const job = tx.select().from(schema.canvasGenerationJobs).where(eq(schema.canvasGenerationJobs.id, jobId)).get();
  if (!job) {
    throw denied("canvas_generation_job outputRef does not reference a queued generation job");
  }
  if (job.turnId !== input.turnId) {
    throw denied("canvas_generation_job outputRef must reference a job created by this turn");
  }
  const canvas = tx.select({
    id: schema.canvasDocuments.id,
    spaceId: schema.canvasDocuments.spaceId,
  }).from(schema.canvasDocuments).where(eq(schema.canvasDocuments.id, job.canvasId)).get();
  if (!canvas || canvas.spaceId !== input.spaceId) {
    throw denied("canvas_generation_job outputRef is outside this Space");
  }
  const turn = tx.select({ agentId: schema.agentTurns.agentId }).from(schema.agentTurns).where(eq(schema.agentTurns.id, input.turnId)).get();
  if (!turn) {
    throw denied("canvas_generation_job outputRef turn is unavailable");
  }
  // canvas 必须仍在该 turn 的 Canvas 授权范围内（单一 grant 命中即通过）。
  resolveCanvasAccessGrantInTransaction(tx, {
    turnId: input.turnId,
    executorAgentId: turn.agentId,
    requestedCanvasId: job.canvasId,
  });
  const existing = tx.select().from(schema.turnOutputArtifacts).where(and(
    eq(schema.turnOutputArtifacts.kind, "canvas_generation_job"),
    eq(schema.turnOutputArtifacts.artifactId, jobId),
  )).get();
  if (existing) {
    if (existing.outputId !== input.outputId || existing.turnId !== input.turnId) {
      throw denied("canvas_generation_job artifact is already bound to another output");
    }
    return;
  }
  tx.insert(schema.turnOutputArtifacts).values({
    id: randomUUID(),
    outputId: input.outputId,
    turnId: input.turnId,
    kind: "canvas_generation_job",
    artifactId: jobId,
  }).run();
}

export function listTurnOutputArtifactsInTransaction(db: ArtifactQueryable, turnId: string) {
  return db.select().from(schema.turnOutputArtifacts).where(eq(schema.turnOutputArtifacts.turnId, turnId)).all();
}

export function findTurnOutputsForCanvasMutationInTransaction(db: ArtifactQueryable, mutationId: string) {
  return db.select().from(schema.turnOutputArtifacts).where(and(
    eq(schema.turnOutputArtifacts.kind, "canvas_mutation"),
    eq(schema.turnOutputArtifacts.artifactId, mutationId),
  )).all();
}
