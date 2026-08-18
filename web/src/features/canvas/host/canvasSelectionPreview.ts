export function previewDocumentFromCanvasSelection(input: {
  previewDocument?: unknown;
  projection?: unknown;
}): unknown {
  if (input.previewDocument) return input.previewDocument;
  const projection = input.projection;
  if (!projection || typeof projection !== "object") return null;
  const record = projection as { elements?: Array<Record<string, unknown>>; frames?: Array<Record<string, unknown>> };
  if (!Array.isArray(record.elements) && !Array.isArray(record.frames)) return projection;
  const elements = record.elements ?? [];
  const deltaSetLike: Record<string, unknown> = {
    ROOT: { children: elements.map((element) => element.id).filter((id): id is string => typeof id === "string") },
  };
  for (const element of elements) {
    if (typeof element.id === "string") deltaSetLike[element.id] = element;
  }
  return { deltaSetLike, frames: record.frames ?? [] };
}
