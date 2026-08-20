type SceneDocumentLike = {
  deltaSetLike?: Record<string, unknown>;
};

/** Selection is renderer-only state; retain it across canonical Core document projections. */
export function survivingNodeSelection(selectedNodeIds: readonly string[], document: unknown): string[] {
  if (!document || typeof document !== "object" || Array.isArray(document)) return [];
  const nodes = (document as SceneDocumentLike).deltaSetLike;
  if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) return [];
  return selectedNodeIds.filter((id) => Object.prototype.hasOwnProperty.call(nodes, id));
}
