import { useEffect } from "react";
import { canvasAssetUrl, type CanvasCoreClient } from "@/features/canvas/adapters/canvasCoreApi";
import { configureRecombynDurableMediaBridge } from "@/features/canvas/adapters/recombynDurableMedia";
import { configureRecombynGenerationBridge } from "@/features/canvas/adapters/recombynGeneration";
import { configureRecombynCanvasAssetBridge, queryClient } from "@/features/canvas/adapters/recombynStageOneServices";

export function useCanvasAssetBridges(client: CanvasCoreClient, canvasId: string, spaceId: string, resourceKey: string) {
  useEffect(() => configureRecombynDurableMediaBridge({
    upload: async (file) => {
      const uploaded = await client.uploadAsset(canvasId, file);
      await queryClient.invalidateQueries({ queryKey: ["canvas-local-assets", resourceKey] });
      return { ...uploaded, url: canvasAssetUrl(spaceId, canvasId, uploaded.id) };
    },
    delete: async (assetId) => { await client.deleteAsset(canvasId, assetId); },
  }), [canvasId, client, resourceKey, spaceId]);
  useEffect(() => configureRecombynGenerationBridge({
    createJob: (body) => client.createGenerationJob(canvasId, body),
    getJob: (jobId) => client.getGenerationJob(canvasId, jobId),
  }), [canvasId, client]);
  useEffect(() => configureRecombynCanvasAssetBridge({
    queryKey: ["canvas-local-assets", resourceKey],
    list: async () => (await client.listAssets(canvasId)).assets.map((asset) => ({
      id: asset.id,
      kind: asset.mimeType.startsWith("video/") ? "video" : asset.mimeType.startsWith("audio/") ? "audio" : "image",
      url: canvasAssetUrl(spaceId, canvasId, asset.id),
      objectKey: asset.id,
      mime: asset.mimeType,
      prompt: asset.filename,
      createdAt: new Date(asset.createdAt).getTime(),
    })),
    delete: async (assetId) => { await client.deleteAsset(canvasId, assetId); },
  }), [canvasId, client, resourceKey, spaceId]);
}
