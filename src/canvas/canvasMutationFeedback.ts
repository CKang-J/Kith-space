import type { CanvasMutationImpact } from "./canvasTypes.js";

export type CanvasMutationFeedbackStatus = "committed" | "noop";

export type CanvasMutationFeedback = {
  status: CanvasMutationFeedbackStatus;
  mutationId: string | null;
  operationId: string;
  canvasId: string;
  snapshotId: string;
  previousRevision: number;
  revision: number;
  sequence?: number;
  createdIds: string[];
  updatedIds: string[];
  deletedIds: string[];
  impact: CanvasMutationImpact | unknown;
  viewport?: { x: number; y: number; zoom: number } | null;
  nextSuggestedAction: string;
};

export function nextCanvasMutationAction(input: {
  status: CanvasMutationFeedbackStatus;
  createdIds: string[];
  updatedIds: string[];
  deletedIds: string[];
}): string {
  if (input.status !== "committed") {
    return "No Canvas mutation was committed. Call a typed canvas.create_* / canvas.update_node tool, or canvas.scene_summary if you only needed to inspect. Do not claim the canvas was edited.";
  }
  const changed = [...input.createdIds, ...input.updatedIds, ...input.deletedIds];
  const focus = changed.length ? ` Verify ids ${changed.join(", ")} with canvas.scene_summary or canvas.elements_get.` : "";
  return `Mutation committed. Re-read with canvas.scene_summary if needed.${focus} Then turn.reply with outputRefs of kind canvas_mutation using this mutationId. Do not treat sourceRefs as canvas output.`;
}

export function canvasMutationFeedback(input: {
  operationId: string;
  canvasId: string;
  snapshotId: string;
  previousRevision: number;
  revision: number;
  mutationId?: string | null;
  sequence?: number;
  createdIds?: string[];
  updatedIds?: string[];
  deletedIds?: string[];
  impact?: CanvasMutationImpact | unknown;
  viewport?: { x: number; y: number; zoom: number } | null;
}): CanvasMutationFeedback {
  const createdIds = [...new Set(input.createdIds ?? [])];
  const deletedIds = [...new Set(input.deletedIds ?? [])];
  const skip = new Set([...createdIds, ...deletedIds]);
  const updatedIds = [...new Set((input.updatedIds ?? []).filter((id) => !skip.has(id)))];
  const status: CanvasMutationFeedbackStatus = input.mutationId ? "committed" : "noop";
  return {
    status,
    mutationId: input.mutationId ?? null,
    operationId: input.operationId,
    canvasId: input.canvasId,
    snapshotId: input.snapshotId,
    previousRevision: input.previousRevision,
    revision: input.revision,
    sequence: input.sequence,
    createdIds,
    updatedIds,
    deletedIds,
    impact: input.impact,
    viewport: input.viewport ?? null,
    nextSuggestedAction: nextCanvasMutationAction({ status, createdIds, updatedIds, deletedIds }),
  };
}
