import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { SpaceTransaction } from "../counters.js";
import type { SpaceDb } from "../db/index.js";
import { schema } from "../db/index.js";
import { HarnessError } from "../harness/errors.js";
import { isCanvasMutationToolName } from "./canvasAgentTools.js";

export type CanvasMutationOutputRef = {
  kind: "canvas_mutation";
  artifactId: string;
};

type ArtifactQueryable = SpaceDb | SpaceTransaction;

/** Bind committed Canvas mutations to a turn.reply output. sourceRefs cannot substitute. */
export function bindCanvasMutationOutputArtifactsInTransaction(
  tx: SpaceTransaction,
  input: {
    spaceId: string;
    turnId: string;
    outputId: string;
    outputRefs: CanvasMutationOutputRef[];
  },
): void {
  const seen = new Set<string>();
  for (const ref of input.outputRefs) {
    if (ref.kind !== "canvas_mutation") {
      throw new HarnessError("capability_scope_denied", "only canvas_mutation outputRefs are supported");
    }
    if (seen.has(ref.artifactId)) {
      throw new HarnessError("capability_scope_denied", "duplicate canvas_mutation outputRef");
    }
    seen.add(ref.artifactId);
    const mutation = tx.select().from(schema.canvasMutations).where(eq(schema.canvasMutations.id, ref.artifactId)).get();
    if (!mutation) {
      throw new HarnessError("capability_scope_denied", "canvas_mutation outputRef does not reference a committed mutation");
    }
    const canvas = tx.select({
      id: schema.canvasDocuments.id,
      spaceId: schema.canvasDocuments.spaceId,
    }).from(schema.canvasDocuments).where(eq(schema.canvasDocuments.id, mutation.canvasId)).get();
    if (!canvas || canvas.spaceId !== input.spaceId) {
      throw new HarnessError("capability_scope_denied", "canvas_mutation outputRef is outside this Space");
    }
    const operation = tx.select().from(schema.turnOperations).where(and(
      eq(schema.turnOperations.id, mutation.operationId),
      eq(schema.turnOperations.turnId, input.turnId),
      eq(schema.turnOperations.status, "committed"),
    )).get();
    if (!operation || !isCanvasMutationToolName(operation.toolName)) {
      throw new HarnessError(
        "capability_scope_denied",
        "canvas_mutation outputRef must reference a mutation committed by this turn via a Canvas write tool",
      );
    }
    const existing = tx.select().from(schema.turnOutputArtifacts).where(and(
      eq(schema.turnOutputArtifacts.kind, "canvas_mutation"),
      eq(schema.turnOutputArtifacts.artifactId, ref.artifactId),
    )).get();
    if (existing) {
      if (existing.outputId !== input.outputId || existing.turnId !== input.turnId) {
        throw new HarnessError("capability_scope_denied", "canvas_mutation artifact is already bound to another output");
      }
      continue;
    }
    tx.insert(schema.turnOutputArtifacts).values({
      id: randomUUID(),
      outputId: input.outputId,
      turnId: input.turnId,
      kind: "canvas_mutation",
      artifactId: ref.artifactId,
    }).run();
  }
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
