export type CanvasJson = null | boolean | number | string | CanvasJson[] | { [key: string]: CanvasJson };

export interface CanvasPatch {
  op: "set" | "remove";
  path: string[];
  value?: CanvasJson;
}

export type CanvasOperation =
  | { type: "document.patch"; patches: CanvasPatch[] }
  | { type: "metadata.rename"; title: string };

export interface CanvasRevisions {
  revision: number;
  metadata: number;
  document: number;
  element: number;
  frame: number;
  structure: number;
}

export interface CanvasSnapshot {
  id: string;
  spaceId: string;
  title: string;
  document: CanvasJson;
  revisions: CanvasRevisions;
  sequence: number;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasMutationImpact {
  metadata: boolean;
  document: boolean;
  element: boolean;
  frame: boolean;
  structure: boolean;
  elementIds: string[];
  frameIds: string[];
  readResources: string[];
  writeResources: string[];
}

export interface ApplyCanvasOperationInput {
  canvasId: string;
  operationId: string;
  expectedRevision: number;
  operation: CanvasOperation;
}
