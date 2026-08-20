import type { SpaceDb } from "../../db/index.js";
import { CanvasAssetStore } from "../canvasAssetStore.js";

export async function importGeneratedAsset(
  db: SpaceDb,
  spaceId: string,
  spaceRoot: string,
  params: {
    canvasId: string;
    bytes: Buffer;
    jobId: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp" | "video/mp4" | "audio/mpeg" | "audio/wav";
    filename?: string;
  },
): Promise<string> {
  const store = new CanvasAssetStore(db, spaceId, spaceRoot);
  const asset = store.write({
    canvasId: params.canvasId,
    filename: params.filename ?? generatedFilename(params.jobId, params.mimeType),
    mimeType: params.mimeType,
    bytes: params.bytes,
  });
  return asset.id;
}

export function sniffGeneratedMime(
  bytes: Buffer,
  jobType: "image" | "video" | "audio",
): "image/png" | "image/jpeg" | "image/webp" | "video/mp4" | "audio/mpeg" | "audio/wav" {
  if (jobType === "video") return "video/mp4";
  if (jobType === "audio") {
    const prefix = bytes.subarray(0, 12);
    if (prefix.subarray(0, 4).toString("ascii") === "RIFF" && prefix.subarray(8, 12).toString("ascii") === "WAVE") {
      return "audio/wav";
    }
    return "audio/mpeg";
  }
  const prefix = bytes.subarray(0, 12);
  if (prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) return "image/jpeg";
  if (prefix.subarray(0, 4).toString("ascii") === "RIFF" && prefix.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return "image/png";
}

function generatedFilename(jobId: string, mimeType: string): string {
  const extension = mimeType === "video/mp4" ? ".mp4"
    : mimeType === "audio/mpeg" ? ".mp3"
      : mimeType === "audio/wav" ? ".wav"
        : mimeType === "image/jpeg" ? ".jpg"
          : mimeType === "image/webp" ? ".webp"
            : ".png";
  return `generated-${jobId.slice(0, 8)}${extension}`;
}
