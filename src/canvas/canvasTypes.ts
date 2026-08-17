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

export interface CanvasSelectedRef {
  id: string;
  revision: number;
}

export interface CanvasSelectionInput {
  canvasId: string;
  selectedIds?: string[];
}

export interface CanvasElementProjection {
  id: string;
  key: string | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  text: string | null;
  fill: CanvasJson | null;
  stroke: CanvasJson | null;
  assetId: string | null;
}

export interface CanvasFrameProjection {
  id: string;
  name: string | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
}

export interface CanvasSelectionProjection {
  canvasId: string;
  canvasTitle: string;
  documentRevision: number;
  structureRevision: number | null;
  elements: CanvasElementProjection[];
  frames: CanvasFrameProjection[];
  membershipIncluded: boolean;
  truncated: boolean;
  wholeCanvas: boolean;
}

export interface FrozenCanvasSelectionSnapshot {
  snapshotId: string;
  canvasId: string;
  canvasTitle: string;
  documentRevision: number;
  structureRevision: number | null;
  selectedElements: CanvasSelectedRef[];
  selectedFrames: CanvasSelectedRef[];
  projection: CanvasSelectionProjection;
  previewAssetId: string | null;
  selectionHash: string;
  summary: string;
  deepLink: { moduleId: "canvas"; canvas: string };
  canvasDeleted: boolean;
}
