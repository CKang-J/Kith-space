import type { CanvasCoreSnapshot } from "./recombynCoreProjection";
import type { CanvasRecoveryResult } from "./canvasRecovery";

export type KithApi = (method: string, path: string, body?: unknown) => Promise<any>;

export class CanvasApiError extends Error {
  constructor(message: string, public readonly currentRevision?: number) { super(message); }
}

export const canvasAssetUrl = (spaceId: string, canvasId: string, assetId: string) => (
  `/api/canvas-assets/${encodeURIComponent(spaceId)}/${encodeURIComponent(canvasId)}/${encodeURIComponent(assetId)}`
);

const MEDIA_NODE_KEYS = new Set(["image", "video", "lottie", "icon"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mediaAssetId(node: Record<string, unknown>): string {
  if (typeof node.assetId === "string" && node.assetId.trim()) return node.assetId.trim();
  const attrs = isRecord(node.attrs) ? node.attrs : {};
  return typeof attrs.assetId === "string" ? attrs.assetId.trim() : "";
}

/** Fill empty attrs.src from a durable assetId so Agent-created nodes paint like toolbar uploads. */
export function hydrateCanvasDocumentMediaSrc(
  document: unknown,
  spaceId: string,
  canvasId: string,
): unknown {
  if (!isRecord(document) || !isRecord(document.deltaSetLike)) return document;
  let changed = false;
  const nextDelta: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(document.deltaSetLike)) {
    if (!isRecord(value) || !MEDIA_NODE_KEYS.has(String(value.key || ""))) {
      nextDelta[id] = value;
      continue;
    }
    const assetId = mediaAssetId(value);
    const attrs = isRecord(value.attrs) ? { ...value.attrs } : {};
    const src = typeof attrs.src === "string" ? attrs.src.trim() : "";
    if (!assetId || src) {
      nextDelta[id] = value;
      continue;
    }
    attrs.src = canvasAssetUrl(spaceId, canvasId, assetId);
    if (typeof attrs.uploadKey !== "string" || !attrs.uploadKey.trim()) attrs.uploadKey = assetId;
    nextDelta[id] = { ...value, attrs };
    changed = true;
  }
  return changed ? { ...document, deltaSetLike: nextDelta } : document;
}

export function hydrateCanvasSnapshotMediaSrc<T extends { id: string; document: unknown }>(
  snapshot: T,
  spaceId: string,
): T {
  return {
    ...snapshot,
    document: hydrateCanvasDocumentMediaSrc(snapshot.document, spaceId, snapshot.id),
  };
}

export interface CanvasLibraryItem extends CanvasCoreSnapshot {
  spaceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasGenerationJob {
  id: string;
  canvasId: string;
  jobType: "image" | "video";
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  genPrompt: string;
  resultAssetId: string | null;
  resultNodeId: string | null;
  resultSrc?: string | null;
  errorMessage: string | null;
  createdAt: number;
  completedAt: number | null;
}

export const canvasCoreApi = (api: KithApi) => {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const result = await api(method, path, body);
    if (result && typeof result === "object" && typeof result.error === "string") {
      throw new CanvasApiError(result.error, Number.isSafeInteger(result.currentRevision) ? result.currentRevision : undefined);
    }
    return result as T;
  };
  return {
  list: async (): Promise<CanvasLibraryItem[]> => ((await call<{ canvases?: CanvasLibraryItem[] }>("GET", "/api/canvases"))?.canvases ?? []).map((item) => (
    item.spaceId ? hydrateCanvasSnapshotMediaSrc(item, item.spaceId) : item
  )),
  create: (title: string, document: unknown): Promise<CanvasLibraryItem> => call("POST", "/api/canvases", { title, document, canvasId: crypto.randomUUID(), operationId: crypto.randomUUID() }),
  read: async (canvasId: string): Promise<CanvasLibraryItem> => {
    const item = await call<CanvasLibraryItem>("GET", `/api/canvases/${encodeURIComponent(canvasId)}`);
    return item.spaceId ? hydrateCanvasSnapshotMediaSrc(item, item.spaceId) : item;
  },
  apply: (canvasId: string, input: unknown): Promise<CanvasLibraryItem> => call("POST", `/api/canvases/${encodeURIComponent(canvasId)}/operations`, input),
  undo: (canvasId: string, operationId: string, expectedRevision: number): Promise<CanvasLibraryItem> => call("POST", `/api/canvases/${encodeURIComponent(canvasId)}/undo`, { operationId, expectedRevision }),
  redo: (canvasId: string, operationId: string, expectedRevision: number): Promise<CanvasLibraryItem> => call("POST", `/api/canvases/${encodeURIComponent(canvasId)}/redo`, { operationId, expectedRevision }),
  changes: (canvasId: string, after: number): Promise<CanvasRecoveryResult> => call("GET", `/api/canvases/${encodeURIComponent(canvasId)}/changes?after=${after}`),
  uploadAsset: (canvasId: string, file: File): Promise<{ id: string; storageKey: string; url: string; filename: string; mimeType: string }> => file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return call("POST", `/api/canvases/${encodeURIComponent(canvasId)}/assets`, {
      filename: file.name,
      mimeType: file.type,
      base64: btoa(binary),
    });
  }),
  deleteAsset: (canvasId: string, assetId: string): Promise<{ ok: true }> => call("DELETE", `/api/canvases/${encodeURIComponent(canvasId)}/assets/${encodeURIComponent(assetId)}`),
  listAssets: (canvasId: string): Promise<{ assets: Array<{ id: string; filename: string; mimeType: string; createdAt: string }> }> => call("GET", `/api/canvases/${encodeURIComponent(canvasId)}/assets`),
  importScene: (title: string, scene: unknown): Promise<CanvasLibraryItem> => call("POST", "/api/canvases/import", { title, scene, canvasId: crypto.randomUUID(), operationId: crypto.randomUUID() }),
  exportScene: (canvasId: string): Promise<{ format: "kith-canvas-scene"; version: 1; title: string; scene: unknown }> => call("GET", `/api/canvases/${encodeURIComponent(canvasId)}/export`),
  deleteCanvas: (canvasId: string, expectedRevision: number): Promise<{ ok: true; deleted: boolean }> => call("DELETE", `/api/canvases/${encodeURIComponent(canvasId)}`, { operationId: crypto.randomUUID(), expectedRevision }),
  createGenerationJob: (canvasId: string, body: {
    jobType: "image" | "video";
    genPrompt: string;
    placement: {
      x: number;
      y: number;
      width: number;
      height: number;
      frameId?: string;
      parentId?: string;
      name?: string;
      targetNodeId?: string;
      skipNodeCreate?: boolean;
    };
    config?: {
      aspectRatio?: "smart" | "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "21:9";
      duration?: number;
      referenceAssetId?: string;
      model?: string;
      resolution?: string;
      removeBg?: boolean;
      cutoutMode?: "product" | "hair";
    };
    idempotencyKey: string;
  }): Promise<CanvasGenerationJob> => call("POST", `/api/canvases/${encodeURIComponent(canvasId)}/generation-jobs`, body),
  getGenerationJob: (canvasId: string, jobId: string): Promise<CanvasGenerationJob> => (
    call("GET", `/api/canvases/${encodeURIComponent(canvasId)}/generation-jobs/${encodeURIComponent(jobId)}`)
  ),
  };
};
export type CanvasCoreClient = ReturnType<typeof canvasCoreApi>;
