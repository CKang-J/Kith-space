import type { CanvasCoreSnapshot } from "./recombynCoreProjection";
import type { CanvasRecoveryResult } from "./canvasRecovery";

export type KithApi = (method: string, path: string, body?: unknown) => Promise<any>;

export class CanvasApiError extends Error {
  constructor(message: string, public readonly currentRevision?: number) { super(message); }
}

export const canvasAssetUrl = (spaceId: string, canvasId: string, assetId: string) => (
  `/api/canvas-assets/${encodeURIComponent(spaceId)}/${encodeURIComponent(canvasId)}/${encodeURIComponent(assetId)}`
);

export interface CanvasLibraryItem extends CanvasCoreSnapshot {
  spaceId: string;
  createdAt: string;
  updatedAt: string;
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
  list: async (): Promise<CanvasLibraryItem[]> => (await call<{ canvases?: CanvasLibraryItem[] }>("GET", "/api/canvases"))?.canvases ?? [],
  create: (title: string, document: unknown): Promise<CanvasLibraryItem> => call("POST", "/api/canvases", { title, document, canvasId: crypto.randomUUID(), operationId: crypto.randomUUID() }),
  read: (canvasId: string): Promise<CanvasLibraryItem> => call("GET", `/api/canvases/${encodeURIComponent(canvasId)}`),
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
  };
};
export type CanvasCoreClient = ReturnType<typeof canvasCoreApi>;
