/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/scene/paint/exportRaster.worker.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * OffscreenCanvas work off the main thread:
 * - encode: ImageBitmap → data URL (export / thumbnails)
 * - stampBake: tip dabs → PNG data URL (pencil stamp strokes)
 *
 * SVG decode stays on the main thread — browsers don't reliably decode SVG here.
 */

export type StampBakeDab = {
  x: number;
  y: number;
  size: number;
  opacity: number;
};

export type RasterEncodeRequest = {
  kind?: 'encode';
  id: number;
  bitmap: ImageBitmap;
  width: number;
  height: number;
  mime: string;
  quality?: number;
  transparent?: boolean;
  backgroundColor?: string;
};

export type StampBakeRequest = {
  kind: 'stampBake';
  id: number;
  tip: ImageBitmap;
  dabs: StampBakeDab[];
  strokeOpacity: number;
  /** Scene-space bake box size (before scale). */
  sceneWidth: number;
  sceneHeight: number;
  scale: number;
  /** Scene-space origin applied before scale (typically -min + pad). */
  originX: number;
  originY: number;
};

export type RasterWorkerRequest = RasterEncodeRequest | StampBakeRequest;

export type RasterEncodeResponse =
  | { id: number; ok: true; dataUrl: string }
  | { id: number; ok: false; error: string };

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
}

function paintStampDabs(
  ctx: OffscreenCanvasRenderingContext2D,
  dabs: StampBakeDab[],
  tip: ImageBitmap,
  strokeOpacity: number
) {
  ctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) {
    ctx.imageSmoothingQuality = 'high';
  }
  for (let i = 0; i < dabs.length; i += 1) {
    const dab = dabs[i];
    const size = Math.max(1, dab.size);
    const alpha = strokeOpacity * Math.max(0.08, Math.min(1, dab.opacity));
    if (alpha <= 0.01) continue;
    ctx.globalAlpha = alpha;
    ctx.drawImage(tip, dab.x - size / 2, dab.y - size / 2, size, size);
  }
  ctx.globalAlpha = 1;
}

async function handleEncode(msg: RasterEncodeRequest): Promise<RasterEncodeResponse> {
  const id = msg.id ?? -1;
  const pw = Math.max(1, Math.round(Number(msg.width) || 1));
  const ph = Math.max(1, Math.round(Number(msg.height) || 1));
  const canvas = new OffscreenCanvas(pw, ph);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no-2d');
  if (!msg.transparent) {
    const bg = String(msg.backgroundColor || '').trim();
    ctx.fillStyle = bg && bg !== 'transparent' ? bg : '#ffffff';
    ctx.fillRect(0, 0, pw, ph);
  }
  const srcW = msg.bitmap.width;
  const srcH = msg.bitmap.height;
  const needsScale = srcW !== pw || srcH !== ph;
  ctx.imageSmoothingEnabled = needsScale;
  if (needsScale && 'imageSmoothingQuality' in ctx) {
    ctx.imageSmoothingQuality = 'high';
  }
  ctx.drawImage(msg.bitmap, 0, 0, pw, ph);
  msg.bitmap.close();
  const mime = String(msg.mime || 'image/png');
  const blob = await canvas.convertToBlob({
    type: mime,
    quality: typeof msg.quality === 'number' ? msg.quality : undefined,
  });
  const dataUrl = await blobToDataUrl(blob);
  return { id, ok: true, dataUrl };
}

async function handleStampBake(msg: StampBakeRequest): Promise<RasterEncodeResponse> {
  const id = msg.id ?? -1;
  const scale = Math.max(0.01, Number(msg.scale) || 1);
  const sceneW = Math.max(1, Number(msg.sceneWidth) || 1);
  const sceneH = Math.max(1, Number(msg.sceneHeight) || 1);
  const pw = Math.max(1, Math.ceil(sceneW * scale));
  const ph = Math.max(1, Math.ceil(sceneH * scale));
  const canvas = new OffscreenCanvas(pw, ph);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no-2d');
  ctx.setTransform(
    scale,
    0,
    0,
    scale,
    Number(msg.originX) * scale,
    Number(msg.originY) * scale
  );
  paintStampDabs(
    ctx,
    Array.isArray(msg.dabs) ? msg.dabs : [],
    msg.tip,
    typeof msg.strokeOpacity === 'number' ? msg.strokeOpacity : 1
  );
  msg.tip.close();
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const dataUrl = await blobToDataUrl(blob);
  return { id, ok: true, dataUrl };
}

self.onmessage = async (ev: MessageEvent<RasterWorkerRequest>) => {
  const msg = ev.data;
  const id = msg?.id ?? -1;
  try {
    if (msg && (msg as StampBakeRequest).kind === 'stampBake') {
      const res = await handleStampBake(msg as StampBakeRequest);
      self.postMessage(res);
      return;
    }
    const res = await handleEncode(msg as RasterEncodeRequest);
    self.postMessage(res);
  } catch (err) {
    try {
      const tip = (msg as StampBakeRequest)?.tip;
      const bitmap = (msg as RasterEncodeRequest)?.bitmap;
      tip?.close?.();
      bitmap?.close?.();
    } catch {
      /* ignore */
    }
    const res: RasterEncodeResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(res);
  }
};

export {};
