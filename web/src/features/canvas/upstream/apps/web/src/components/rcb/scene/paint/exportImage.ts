/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/scene/paint/exportImage.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { imageSrcToFile } from '@recombyn-native/utils/uploadImage';
import { getSvgBoard, type SvgBoardHandle } from '@recombyn-native/components/rcb/canvas/svgBoardRegistry';
import { createSvgBoard, loadSceneOntoSvg, nodeLeftTop, type SceneSvgHost } from './sceneToSvg';
import {
  isExportableSceneNode
} from '../document/nodeCapabilities';
import { strokeVisualOutset } from '../document/sceneEffects';
import { resolveApiUrl } from '@recombyn-native/utils/apiBase';
import { getToken } from '@recombyn-native/utils/token';
import type { SceneDocument, SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';

export type ExportImageFormat = 'png' | 'jpeg' | 'svg';

/**
 * Browser canvas hard limits (Chrome ~16384/edge; area also capped).
 * Stay under both so 4× of large selections fails in the UI instead of at download.
 */
export const MAX_EXPORT_CANVAS_EDGE = 16384;
export const MAX_EXPORT_CANVAS_AREA = 268_435_456; // 16384²

export type ExportImageOptions = {
  /** Output scale relative to scene pixels (1 = document / selection size). */
  multiplier?: number;
  format?: ExportImageFormat;
  /** When true, JPEG uses lower quality; PNG unchanged. */
  compress?: boolean;
  /** Optional filename stem (without extension). */
  filename?: string;
  /** Export only the given nodes (or current selection bbox). */
  selectionOnly?: boolean;
  /** Node ids to include when selectionOnly is true. */
  nodeIds?: string[];
  /** Crop region in scene coords (artboard / frame). Overrides selection bbox. */
  crop?: { x: number; y: number; width: number; height: number } | null;
  /** Fill behind crop (HTML frame bg is not in the SVG board). */
  backgroundColor?: string;
  /** Scene document — preferred for selection crop boxes. */
  document?: SceneDocument | null;
};

export type ExportAffixMode = 'prefix' | 'suffix';

export type ExportSlotConfig = {
  id: string;
  scale: number;
  affixMode: ExportAffixMode;
  affix: string;
  format: ExportImageFormat;
};

type SceneBox = { x: number; y: number; width: number; height: number };

/** True when width×scale / height×scale fit in a browser canvas. */
export function isExportScaleSafe(
  width: number,
  height: number,
  scale: number
): boolean {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  const s = Math.max(0.01, Number(scale) || 1);
  const outW = w * s;
  const outH = h * s;
  if (outW > MAX_EXPORT_CANVAS_EDGE || outH > MAX_EXPORT_CANVAS_EDGE) return false;
  if (outW * outH > MAX_EXPORT_CANVAS_AREA) return false;
  return true;
}

/** Largest scale ≤ preferred that still fits the canvas budget. */
export function clampExportScale(
  width: number,
  height: number,
  preferred: number
): number {
  const want = Math.max(0.01, Number(preferred) || 1);
  if (isExportScaleSafe(width, height, want)) return want;
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  const byEdge = Math.min(MAX_EXPORT_CANVAS_EDGE / w, MAX_EXPORT_CANVAS_EDGE / h);
  const byArea = Math.sqrt(MAX_EXPORT_CANVAS_AREA / (w * h));
  return Math.max(0.01, Math.min(want, byEdge, byArea));
}

function isTauriShell(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__ || import.meta.env.TAURI_ENV_PLATFORM);
}

function clickDownloadLink(href: string, filename: string) {
  const a = window.document.createElement('a');
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  window.document.body.appendChild(a);
  a.click();
  a.remove();
}

function saveDialogFilters(filename: string): { name: string; extensions: string[] }[] | undefined {
  const m = /\.([a-z0-9]+)$/i.exec(filename);
  if (!m) return undefined;
  const ext = m[1].toLowerCase();
  return [{ name: ext.toUpperCase(), extensions: [ext] }];
}

/** Decode a data: URL without `fetch` — Tauri/WebView often blocks or empties data: fetches. */
function blobFromDataUrl(dataUrl: string): Blob | null {
  try {
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    const header = dataUrl.slice(0, comma);
    const data = dataUrl.slice(comma + 1);
    const mime = /data:([^;,]+)/i.exec(header)?.[1] || 'application/octet-stream';
    if (/;base64/i.test(header)) {
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(data)], { type: mime });
  } catch {
    return null;
  }
}

export type DownloadFileResult = 'saved' | 'cancelled' | 'failed';

/**
 * Trigger a file download. Web: `<a download>`. Tauri WebView ignores that, so use
 * a native Save dialog + fs write instead.
 *
 * - `saved`: wrote (or browser download started)
 * - `cancelled`: user closed the Save dialog
 * - `failed`: write/encode error
 */
export async function downloadFileBlob(
  blob: Blob,
  filename: string
): Promise<DownloadFileResult> {
  const safeName = sanitizeFilename(filename) || 'export';
  if (isTauriShell()) {
    try {
      const { save } = await import('@/features/canvas/adapters/recombynUnavailablePlatform');
      const { writeFile } = await import('@/features/canvas/adapters/recombynUnavailablePlatform');
      const picked = await save({
        defaultPath: safeName,
        filters: saveDialogFilters(safeName),
      });
      if (picked == null || picked === '') return 'cancelled';
      const path = String(picked).replace(/^file:\/\//i, '');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await writeFile(path, bytes);
      return 'saved';
    } catch (err) {
      console.warn('[download] tauri save failed', err);
      return 'failed';
    }
  }
  const url = URL.createObjectURL(blob);
  clickDownloadLink(url, safeName);
  // Defer revoke — some browsers cancel the download if the blob URL dies immediately.
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
  return 'saved';
}

async function downloadDataUrl(
  dataUrl: string,
  filename: string
): Promise<DownloadFileResult> {
  const blob = blobFromDataUrl(dataUrl);
  if (!blob || !(blob.size > 0)) return 'failed';
  return downloadFileBlob(blob, filename);
}

export function sanitizeFilename(name: string) {
  return (
    String(name || 'export')
      // Windows-forbidden chars + C0 controls (keep * and - as literals, not a range).
      // eslint-disable-next-line no-control-regex -- intentional strip of C0 controls
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
      .trim() || 'export'
  );
}

export function buildExportFilename(
  base: string,
  affixMode: ExportAffixMode,
  affix: string
) {
  const stem = sanitizeFilename(base);
  const part = sanitizeFilename(affix).replace(/^\.+/, '');
  if (!part) return stem;
  return affixMode === 'prefix' ? `${part}${stem}` : `${stem}${part}`;
}

function resolveExportMultiplier(requested: number) {
  return Math.min(6, Math.max(0.25, Number(requested) || 1));
}

function rotatedAabb(x: number, y: number, w: number, h: number, angleDeg: number): SceneBox {
  if (!angleDeg) return { x, y, width: w, height: h };
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ] as const) {
    const dx = px - cx;
    const dy = py - cy;
    const rx = cx + dx * cos - dy * sin;
    const ry = cy + dx * sin + dy * cos;
    minX = Math.min(minX, rx);
    minY = Math.min(minY, ry);
    maxX = Math.max(maxX, rx);
    maxY = Math.max(maxY, ry);
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function boxFromSceneNode(document: SceneDocument, node: SceneNodeInput): SceneBox | null {
  if (!node) return null;
  const { left, top } = nodeLeftTop(document, node);
  const w = Number(node.width);
  const h = Number(node.height);
  if (![left, top, w, h].every(Number.isFinite) || !(w > 0) || !(h > 0)) return null;
  const angle = Number(node.attrs?.angle) || 0;
  const geom = rotatedAabb(left, top, w, h, angle);
  const outset = Math.max(0, strokeVisualOutset(node));
  if (!(outset > 0)) return geom;
  return {
    x: geom.x - outset,
    y: geom.y - outset,
    width: geom.width + outset * 2,
    height: geom.height + outset * 2,
  };
}

/** Integer scene crop — fractional viewBox origins make 1px strokes look uneven after rasterize. */
function snapExportCrop(crop: SceneBox): SceneBox {
  const x0 = Math.floor(crop.x);
  const y0 = Math.floor(crop.y);
  const x1 = Math.ceil(crop.x + crop.width);
  const y1 = Math.ceil(crop.y + crop.height);
  return {
    x: x0,
    y: y0,
    width: Math.max(1, x1 - x0),
    height: Math.max(1, y1 - y0),
  };
}

/**
 * Scene nodes use `translate(left,top)` with local geometry at 0,0.
 * Crop must use scene coords or CTM-mapped getBBox — not raw local bbox alone.
 */
function unionNodeBBoxes(
  board: SvgBoardHandle,
  nodeIds: string[],
  document?: SceneDocument | null
): SceneBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hit = false;

  const rootSvg = board.getSvgElement();

  for (const id of nodeIds) {
    const node = document?.deltaSetLike?.[id];
    let b: SceneBox | null =
      document && node ? boxFromSceneNode(document, node) : null;

    if (!b) {
      const el = board.nodeEls.get(id) as (SceneSvgHost & SVGGraphicsElement) | undefined;
      if (!el) continue;

      const left = Number(el.__sceneLeft);
      const top = Number(el.__sceneTop);
      const width = Number(el.sceneWidth);
      const height = Number(el.sceneHeight);
      if ([left, top, width, height].every(Number.isFinite) && width > 0 && height > 0) {
        b = rotatedAabb(left, top, width, height, Number(el.__sceneAngle) || 0);
      }

      if (!b) {
        try {
          if (rootSvg && typeof el.getBBox === 'function') {
            const bb = el.getBBox();
            const ctm = el.getCTM();
            const svgCtm = rootSvg.getScreenCTM();
            if (ctm && svgCtm) {
              const m = svgCtm.inverse().multiply(ctm);
              const pts = [
                [bb.x, bb.y],
                [bb.x + bb.width, bb.y],
                [bb.x + bb.width, bb.y + bb.height],
                [bb.x, bb.y + bb.height],
              ].map(([px, py]) => {
                const x = m.a * px + m.c * py + m.e;
                const y = m.b * px + m.d * py + m.f;
                return [x, y] as const;
              });
              let x0 = Infinity;
              let y0 = Infinity;
              let x1 = -Infinity;
              let y1 = -Infinity;
              for (const [x, y] of pts) {
                x0 = Math.min(x0, x);
                y0 = Math.min(y0, y);
                x1 = Math.max(x1, x);
                y1 = Math.max(y1, y);
              }
              b = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
            }
          }
        } catch {
          b = null;
        }
      }
    }

    if (!b || !(b.width > 0) || !(b.height > 0)) continue;
    hit = true;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }

  if (!hit) return null;
  // Pad covers AA fringe; stroke outset is already in boxFromSceneNode.
  const pad = 1;
  return snapExportCrop({
    x: minX - pad,
    y: minY - pad,
    width: Math.max(1, maxX - minX + pad * 2),
    height: Math.max(1, maxY - minY + pad * 2),
  });
}


async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('blob-read-failed'));
    reader.readAsDataURL(blob);
  });
}

/** Kith host API (canvas assets, attachments) authenticates via browser session cookies or Desktop trust — not Recombyn Bearer. */
function usesKithHostSessionAuth(src: string, absolute: string): boolean {
  if (src.startsWith('/api/')) return true;
  try {
    const path = new URL(absolute, window.location.origin).pathname;
    return path.startsWith('/api/canvas-assets/') || path.startsWith('/api/attachments/');
  } catch {
    return absolute.includes('/api/canvas-assets/') || absolute.includes('/api/attachments/');
  }
}

/** Last-resort: draw via HTMLImageElement (works when img already paints on canvas). */
function rasterizeViaHtmlImage(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const absolute = src.startsWith('/') ? resolveApiUrl(src) : src;
    const el = new Image();
    let settled = false;
    const finish = (data: string | null) => {
      if (settled) return;
      settled = true;
      resolve(data);
    };
    el.onload = () => {
      try {
        const w = Math.max(1, el.naturalWidth || el.width || 1);
        const h = Math.max(1, el.naturalHeight || el.height || 1);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          finish(null);
          return;
        }
        ctx.drawImage(el, 0, 0);
        finish(canvas.toDataURL('image/png'));
      } catch {
        finish(null);
      }
    };
    el.onerror = () => finish(null);
    // Anonymous first — needed for canvas taint-free export when CDN sends ACAO.
    try {
      el.crossOrigin = 'anonymous';
    } catch {
      /* ignore */
    }
    el.src = absolute;
  });
}

/** Fetch any image href (data / our uploads / remote) as a data URL for export. */
async function fetchHrefAsDataUrl(
  href: string,
  opts?: { uploadKey?: string | null }
): Promise<string | null> {
  const src = (href || '').trim();
  if (!src) return null;
  if (src.startsWith('data:')) return src;
  // Prefer authenticated upload pipeline — direct COS fetch often fails CORS in export.
  try {
    const file = await imageSrcToFile(src, 'export-img.png', {
      uploadKey: opts?.uploadKey,
    });
    if (file && file.size >= 8) return await blobToDataUrl(file);
  } catch (err) {
    console.warn('[export] imageSrcToFile failed', err);
  }
  try {
    const absolute = src.startsWith('/') ? resolveApiUrl(src) : src;
    const headers: HeadersInit = {};
    const token = getToken();
    const usesBearer =
      Boolean(token) &&
      (src.startsWith('/api/v1/uploads/') || absolute.includes('/api/v1/uploads/'));
    if (usesBearer) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(absolute, {
      headers,
      mode: 'cors',
      // Kith browser web: Human session cookie. Electron: Desktop trust header is injected separately.
      credentials: usesKithHostSessionAuth(src, absolute) && !usesBearer ? 'same-origin' : 'omit',
    });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const blob = await res.blob();
    if (!blob || blob.size < 8) throw new Error('empty body');
    return await blobToDataUrl(blob);
  } catch {
    /* fall through to HTMLImageElement */
  }
  // Blob-URL SVG→canvas cannot paint external <image> hrefs. If fetch/CORS
  // failed, still try the same path the editor uses to display the bitmap.
  try {
    return await rasterizeViaHtmlImage(src);
  } catch {
    return null;
  }
}

/**
 * Blob-URL SVG→canvas cannot load external <image> hrefs (CORS / blob policy).
 * Inline every raster as a data URL before rasterizing.
 * @param opts.failClosed default true — throw if any non-data image cannot be embedded
 *   (export). Pass false for list thumbnails (best-effort; keep what inlined).
 */
export async function inlineSvgImages(
  svgString: string,
  sceneDocument?: SceneDocument | null,
  opts?: { failClosed?: boolean }
): Promise<string> {
  const failClosed = opts?.failClosed !== false;
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return svgString;
  const images = Array.from(doc.querySelectorAll('image'));
  if (!images.length) return svgString;

  const uploadKeyBySrc = new Map<string, string>();
  const nodes = sceneDocument?.deltaSetLike;
  if (nodes && typeof nodes === 'object') {
    for (const node of Object.values(nodes) as SceneNode[]) {
      const key = String(node?.attrs?.uploadKey || '').trim();
      if (!key) continue;
      const src = String(node?.attrs?.src || '').trim();
      if (src) uploadKeyBySrc.set(src, key);
      const fillSrc = String(node?.attrs?.['fill-image-src'] || '').trim();
      if (fillSrc) uploadKeyBySrc.set(fillSrc, key);
    }
  }

  const failures: string[] = [];

  await Promise.all(
    images.map(async (el) => {
      let href =
        el.getAttribute('href') ||
        el.getAttribute('xlink:href') ||
        el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
        '';
      if (href.startsWith('data:')) return;

      const host = el.closest('[data-scene-node-id]');
      const nodeId = host?.getAttribute('data-scene-node-id') || '';
      const sceneNode = nodeId ? sceneDocument?.deltaSetLike?.[nodeId] : null;
      const sceneSrc = String(sceneNode?.attrs?.src || '').trim();
      if (!href && sceneSrc) href = sceneSrc;
      const fetchSrc = sceneSrc || href;
      if (!fetchSrc) return;

      const uploadKey =
        String(sceneNode?.attrs?.uploadKey || '').trim() ||
        uploadKeyBySrc.get(fetchSrc) ||
        uploadKeyBySrc.get(href) ||
        null;

      const data = await fetchHrefAsDataUrl(fetchSrc, { uploadKey });
      if (!data) {
        failures.push(fetchSrc.slice(0, 96));
        return;
      }
      el.setAttribute('href', data);
      el.setAttributeNS('http://www.w3.org/1999/xlink', 'href', data);
      el.removeAttribute('xlink:href');
    })
  );

  if (failures.length && failClosed) {
    throw new Error(`export-inline-failed:${failures.length}:${failures[0]}`);
  }

  const root = doc.documentElement;
  if (!root.getAttribute('xmlns')) {
    root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  if (!root.getAttribute('xmlns:xlink')) {
    root.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  }
  return new XMLSerializer().serializeToString(root);
}

/** Encode / tip-bake prefer OffscreenCanvas worker (SVG decode stays on main). */
function canUseRasterWorker(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap === 'function'
  );
}

let rasterWorker: Worker | null = null;
let rasterWorkerId = 1;
const rasterWorkerWaiters = new Map<
  number,
  { resolve: (url: string) => void; reject: (err: Error) => void }
>();

function getRasterWorker(): Worker | null {
  if (!canUseRasterWorker()) return null;
  if (rasterWorker) return rasterWorker;
  try {
    const w = new Worker(new URL('./exportRaster.worker.ts', import.meta.url), {
      type: 'module',
    });
    w.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; dataUrl?: string; error?: string }>) => {
      const { id, ok, dataUrl, error } = ev.data || {};
      const waiter = rasterWorkerWaiters.get(id);
      if (!waiter) return;
      rasterWorkerWaiters.delete(id);
      if (ok && dataUrl) waiter.resolve(dataUrl);
      else waiter.reject(new Error(error || 'raster-worker-failed'));
    };
    w.onerror = () => {
      for (const [, waiter] of rasterWorkerWaiters) {
        waiter.reject(new Error('raster-worker-crashed'));
      }
      rasterWorkerWaiters.clear();
      rasterWorker = null;
    };
    rasterWorker = w;
    return w;
  } catch {
    return null;
  }
}

function encodeBitmapInWorker(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  mime: string,
  quality?: number,
  transparent = false,
  backgroundColor?: string
): Promise<string> {
  const w = getRasterWorker();
  if (!w) {
    bitmap.close();
    return Promise.reject(new Error('no-raster-worker'));
  }
  const id = rasterWorkerId++;
  return new Promise<string>((resolve, reject) => {
    rasterWorkerWaiters.set(id, { resolve, reject });
    try {
      w.postMessage(
        {
          kind: 'encode',
          id,
          bitmap,
          width,
          height,
          mime,
          quality,
          transparent,
          backgroundColor,
        },
        [bitmap]
      );
    } catch (err) {
      rasterWorkerWaiters.delete(id);
      try {
        bitmap.close();
      } catch {
        /* ignore */
      }
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export type StampBakeDabInput = {
  x: number;
  y: number;
  size: number;
  opacity: number;
};

/**
 * Bake tip stamps → PNG data URL on the raster worker.
 * Caller supplies tip ImageBitmap (transferred); falls back to rejection when worker missing.
 */
export function bakeStampStrokeInWorker(opts: {
  tip: ImageBitmap;
  dabs: StampBakeDabInput[];
  strokeOpacity: number;
  sceneWidth: number;
  sceneHeight: number;
  scale: number;
  originX: number;
  originY: number;
}): Promise<string> {
  const w = getRasterWorker();
  if (!w) {
    opts.tip.close();
    return Promise.reject(new Error('no-raster-worker'));
  }
  const id = rasterWorkerId++;
  return new Promise<string>((resolve, reject) => {
    rasterWorkerWaiters.set(id, { resolve, reject });
    try {
      w.postMessage(
        {
          kind: 'stampBake',
          id,
          tip: opts.tip,
          dabs: opts.dabs,
          strokeOpacity: opts.strokeOpacity,
          sceneWidth: opts.sceneWidth,
          sceneHeight: opts.sceneHeight,
          scale: opts.scale,
          originX: opts.originX,
          originY: opts.originY,
        },
        [opts.tip]
      );
    } catch (err) {
      rasterWorkerWaiters.delete(id);
      try {
        opts.tip.close();
      } catch {
        /* ignore */
      }
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function paintBitmapToCanvas(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  bitmap: CanvasImageSource,
  pw: number,
  ph: number,
  opts?: { transparent?: boolean; backgroundColor?: string; sourceW?: number; sourceH?: number }
) {
  if (!opts?.transparent) {
    const bg = String(opts?.backgroundColor || '').trim();
    ctx.fillStyle = bg && bg !== 'transparent' ? bg : '#ffffff';
    ctx.fillRect(0, 0, pw, ph);
  }
  const sw = Math.max(1, Math.round(Number(opts?.sourceW) || 0));
  const sh = Math.max(1, Math.round(Number(opts?.sourceH) || 0));
  // 1:1 copy stays crisp; only enable smoothing when we must resample.
  const needsScale = sw > 0 && sh > 0 ? sw !== pw || sh !== ph : true;
  ctx.imageSmoothingEnabled = needsScale;
  if (needsScale && 'imageSmoothingQuality' in ctx) {
    (ctx as CanvasRenderingContext2D).imageSmoothingQuality = 'high';
  }
  ctx.drawImage(bitmap, 0, 0, pw, ph);
}

function rasterizeSvgStringMainThread(
  svgString: string,
  width: number,
  height: number,
  mime: string,
  quality?: number,
  transparent = false,
  backgroundColor?: string
) {
  return new Promise<string>((resolve, reject) => {
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const pw = Math.max(1, Math.round(width));
        const ph = Math.max(1, Math.round(height));
        const canvas = window.document.createElement('canvas');
        canvas.width = pw;
        canvas.height = ph;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('no-2d'));
          return;
        }
        paintBitmapToCanvas(ctx, img, pw, ph, {
          transparent,
          backgroundColor,
          sourceW: img.naturalWidth || img.width,
          sourceH: img.naturalHeight || img.height,
        });
        resolve(canvas.toDataURL(mime, quality));
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('svg-image-load-failed'));
    };
    img.src = url;
  });
}

/** Decode SVG at the export pixel size (avoid 1× decode → 4× upscale blur). */
async function rasterizeSvgToBitmap(
  svgString: string,
  width: number,
  height: number
): Promise<ImageBitmap> {
  const pw = Math.max(1, Math.round(width));
  const ph = Math.max(1, Math.round(height));
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });

  // Chromium / WebView2: resize* controls SVG rasterization resolution.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, {
        resizeWidth: pw,
        resizeHeight: ph,
        resizeQuality: 'high',
      });
    } catch {
      /* fall through — some hosts reject SVG+resize */
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('svg-image-load-failed'));
      el.src = url;
    });
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(img, {
          resizeWidth: pw,
          resizeHeight: ph,
          resizeQuality: 'high',
        });
      } catch {
        return await createImageBitmap(img);
      }
    }
    throw new Error('no-createImageBitmap');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encodeBitmapOnMainThread(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  mime: string,
  quality?: number,
  transparent = false,
  backgroundColor?: string
): string {
  const pw = Math.max(1, Math.round(width));
  const ph = Math.max(1, Math.round(height));
  const canvas = window.document.createElement('canvas');
  canvas.width = pw;
  canvas.height = ph;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('no-2d');
  }
  paintBitmapToCanvas(ctx, bitmap, pw, ph, {
    transparent,
    backgroundColor,
    sourceW: bitmap.width,
    sourceH: bitmap.height,
  });
  bitmap.close();
  return canvas.toDataURL(mime, quality);
}

/** SVG string → data URL. Decode at target size; PNG/JPEG encode prefers worker. */
export async function rasterizeSvgString(
  svgString: string,
  width: number,
  height: number,
  mime: string,
  quality?: number,
  transparent = false,
  backgroundColor?: string
): Promise<string> {
  const pw = Math.max(1, Math.round(width));
  const ph = Math.max(1, Math.round(height));

  try {
    const bitmap = await rasterizeSvgToBitmap(svgString, pw, ph);
    if (canUseRasterWorker()) {
      try {
        return await encodeBitmapInWorker(
          bitmap,
          pw,
          ph,
          mime,
          quality,
          transparent,
          backgroundColor
        );
      } catch {
        // Worker path transfers/closes the bitmap — rebuild via Image fallback.
      }
    } else {
      return encodeBitmapOnMainThread(
        bitmap,
        pw,
        ph,
        mime,
        quality,
        transparent,
        backgroundColor
      );
    }
  } catch {
    /* Image() fallback below */
  }

  return rasterizeSvgStringMainThread(
    svgString,
    pw,
    ph,
    mime,
    quality,
    transparent,
    backgroundColor
  );
}

/**
 * Infinite-canvas roots carry absolute CSS (left/top/width) for camera hosts.
 * That breaks SVG→Image→canvas rasterization — strip host chrome for export.
 *
 * `pixelWidth` / `pixelHeight` = output bitmap size so the browser rasterizes
 * at export scale (not 1× then upscale — that makes thin strokes look uneven).
 */
function prepareExportSvgRoot(
  clone: SVGSVGElement,
  crop?: SceneBox | null,
  pixelWidth?: number,
  pixelHeight?: number
) {
  clone.removeAttribute('style');
  clone.removeAttribute('data-rcb-infinite');
  clone.style.cssText = 'display:block;overflow:hidden;';
  if (crop && crop.width > 0 && crop.height > 0) {
    const pw = Math.max(1, Math.round(pixelWidth ?? crop.width));
    const ph = Math.max(1, Math.round(pixelHeight ?? crop.height));
    clone.setAttribute('viewBox', `${crop.x} ${crop.y} ${crop.width} ${crop.height}`);
    clone.setAttribute('width', String(pw));
    clone.setAttribute('height', String(ph));
  }
  // Aspect locked by outW/outH derivation; meet avoids stretch if sizes ever diverge.
  clone.setAttribute('preserveAspectRatio', 'xMinYMin meet');
  clone.setAttribute('overflow', 'hidden');
}

function buildExportSvgString(
  board: SvgBoardHandle,
  opts: {
    nodeIds?: string[];
    crop?: SceneBox | null;
    backgroundColor?: string;
    /** Device pixels for SVG width/height (scene×multiplier). */
    pixelWidth?: number;
    pixelHeight?: number;
  }
) {
  const svgEl = board.getSvgElement();
  if (!svgEl) return null;
  const clone = svgEl.cloneNode(true) as SVGSVGElement;

  // Drop UI-only chrome if present; keep scene-layer content.
  clone.querySelectorAll('[data-export-ignore]').forEach((n) => n.remove());

  if (opts.nodeIds?.length) {
    const keep = new Set(opts.nodeIds);
    clone.querySelectorAll('[data-scene-node-id]').forEach((n) => {
      const id = n.getAttribute('data-scene-node-id');
      if (id && !keep.has(id)) n.remove();
    });
  }

  const crop = opts.crop || null;
  prepareExportSvgRoot(clone, crop, opts.pixelWidth, opts.pixelHeight);

  if (crop) {
    const { x, y, width, height } = crop;
    const bg = String(opts.backgroundColor || '').trim();
    if (bg && bg !== 'transparent') {
      const rect = window.document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(width));
      rect.setAttribute('height', String(height));
      rect.setAttribute('fill', bg);
      rect.setAttribute('data-export-frame-bg', 'true');
      const first = clone.firstChild;
      if (first) clone.insertBefore(rect, first);
      else clone.appendChild(rect);
    }
  }

  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  if (!clone.getAttribute('xmlns:xlink')) {
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  }

  return new XMLSerializer().serializeToString(clone);
}

export type ExportRenderResult =
  | { kind: 'svg'; svgString: string; width: number; height: number }
  | { kind: 'raster'; dataUrl: string; width: number; height: number; format: 'png' | 'jpeg' };

/** Build SVG / raster bytes without triggering a download. */
export async function renderExport(options: ExportImageOptions): Promise<ExportRenderResult | null> {
  const {
    multiplier = 2,
    format = 'png',
    compress = false,
    selectionOnly = false,
    nodeIds,
    document,
    crop: cropOpt,
    backgroundColor,
  } = options;

  // Infinite canvas unregisters the mono board (paint lives in per-shape hosts).
  // Always rebuild from `document` when provided so export isn't an empty/stale board.
  let board: SvgBoardHandle | null = document ? null : getSvgBoard();
  let ephemeralHost: HTMLDivElement | null = null;
  try {
    if (!board) {
      if (!document) return null;
      ephemeralHost = window.document.createElement('div');
      ephemeralHost.setAttribute('data-rcb-export-host', '1');
      ephemeralHost.style.cssText =
        'position:fixed;left:-99999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
      window.document.body.appendChild(ephemeralHost);
      const { root, layer } = createSvgBoard(ephemeralHost, 794, 1123, { infinite: true });
      root.setAttribute('data-rcb-export-surface', '1');
      const map = await loadSceneOntoSvg(
        root,
        layer,
        document,
        1,
        { loadSeq: 1 },
        { infinite: true, omitNonExportable: true }
      );
      board = {
        root,
        layer,
        nodeEls: map || new Map(),
        getSvgElement: () => root,
        toSvgString: () => new XMLSerializer().serializeToString(root),
      };
    }

    const m = resolveExportMultiplier(multiplier);
    const fmt = format === 'svg' ? 'svg' : format === 'jpeg' ? 'jpeg' : 'png';
    // Compress only affects JPEG quality — PNG ignores it.
    const quality = fmt === 'jpeg' ? (compress ? 0.78 : 0.95) : 1;
    const mime = fmt === 'jpeg' ? 'image/jpeg' : 'image/png';
    const ids = (nodeIds || []).filter((id) => {
      if (!id) return false;
      if (!document?.deltaSetLike?.[id]) return true;
      return isExportableSceneNode(document.deltaSetLike[id]);
    });

    let crop: SceneBox | null = null;
    if (cropOpt && cropOpt.width > 0 && cropOpt.height > 0) {
      crop = snapExportCrop({
        x: Number(cropOpt.x) || 0,
        y: Number(cropOpt.y) || 0,
        width: Math.max(1, Number(cropOpt.width) || 1),
        height: Math.max(1, Number(cropOpt.height) || 1),
      });
    } else if (selectionOnly) {
      if (!ids.length) return null;
      crop = unionNodeBBoxes(board, ids, document);
      if (!crop) return null;
    } else {
      const svgEl = board.getSvgElement();
      if (!svgEl) return null;
      const vb = svgEl.viewBox?.baseVal;
      crop = snapExportCrop({
        x: Number(vb?.x) || 0,
        y: Number(vb?.y) || 0,
        width: Math.max(1, vb?.width || Number(svgEl.getAttribute('width')) || 794),
        height: Math.max(1, vb?.height || Number(svgEl.getAttribute('height')) || 1123),
      });
    }

    // Reject scales that exceed browser canvas limits (UI should disable these).
    if (fmt !== 'svg' && !isExportScaleSafe(crop.width, crop.height, m)) {
      console.warn(
        `[export] scale ${m}× exceeds canvas limit for ${crop.width}×${crop.height}`
      );
      return null;
    }
    // Derive height from width so round(w×m)/round(h×m) cannot anisotropically stretch strokes.
    const outW = Math.max(1, Math.round(crop.width * m));
    const outH = Math.max(
      1,
      Math.round((outW * crop.height) / Math.max(1e-6, crop.width))
    );
    const selectionIds = selectionOnly || (cropOpt && ids.length) ? ids : undefined;

    // Self-contained SVG (images → data URLs) → optional single rasterize.
    // Rasterize at export pixel size (not 1× then upscale) so thin strokes stay even.
    const svgString = buildExportSvgString(board, {
      crop,
      backgroundColor,
      pixelWidth: fmt === 'svg' ? crop.width : outW,
      pixelHeight: fmt === 'svg' ? crop.height : outH,
      ...(selectionIds?.length ? { nodeIds: selectionIds } : {}),
    });
    if (!svgString) return null;
    const inlined = await inlineSvgImages(svgString, document);

    if (fmt === 'svg') {
      return { kind: 'svg', svgString: inlined, width: outW, height: outH };
    }

    const dataUrl = await rasterizeSvgString(
      inlined,
      outW,
      outH,
      mime,
      quality,
      fmt === 'png',
      backgroundColor
    );
    if (!dataUrl || dataUrl === 'data:,') return null;
    return { kind: 'raster', dataUrl, width: outW, height: outH, format: fmt };
  } catch (err) {
    console.warn('[export] renderExport failed', err);
    return null;
  } finally {
    ephemeralHost?.remove();
  }
}

export type ExportOnceResult = DownloadFileResult | 'render-failed';

async function exportOnce(options: ExportImageOptions): Promise<ExportOnceResult> {
  const filename = options.filename || 'export';
  try {
    const rendered = await renderExport(options);
    if (!rendered) return 'render-failed';
    if (rendered.kind === 'svg') {
      const blob = new Blob([rendered.svgString], { type: 'image/svg+xml;charset=utf-8' });
      return downloadFileBlob(blob, `${sanitizeFilename(filename)}.svg`);
    }
    const ext = rendered.format === 'jpeg' ? 'jpg' : 'png';
    // Prefer real Blob bytes — do not rely on fetch(data:) (broken in Tauri WebView).
    const blob = blobFromDataUrl(rendered.dataUrl);
    if (blob && blob.size > 0) {
      return downloadFileBlob(blob, `${sanitizeFilename(filename)}.${ext}`);
    }
    return downloadDataUrl(rendered.dataUrl, `${sanitizeFilename(filename)}.${ext}`);
  } catch (err) {
    console.warn('[export] exportOnce failed', err);
    return 'failed';
  }
}

/** Download the scene document as pretty-printed JSON (round-trips with import). */
export async function exportDocumentJson(
  document: SceneDocument,
  filename = 'document'
): Promise<DownloadFileResult> {
  if (!document || typeof document !== 'object') return 'failed';
  const blob = new Blob([JSON.stringify(document, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  return downloadFileBlob(blob, `${sanitizeFilename(filename)}.json`);
}

/**
 * Small PNG data-URL for composer / chat chips (single node, group, or artboard).
 * Best-effort — returns null when the board cannot be rasterized.
 */
export async function renderComposerChipThumb(opts: {
  document: SceneDocument;
  nodeIds?: string[];
  frameId?: string | null;
  /** Longest edge of the raster preview (device pixels). */
  maxSide?: number;
}): Promise<string | null> {
  const doc = opts.document;
  if (!doc) return null;
  const maxSide = Math.max(32, Math.min(160, Number(opts.maxSide) || 96));

  const frameId = String(opts.frameId || '').trim();
  if (frameId) {
    const frames = Array.isArray(doc.frames) ? doc.frames : [];
    const frame = frames.find((f) => f?.id === frameId);
    if (!frame) return null;
    const w = Math.max(1, Number(frame.width) || 1);
    const h = Math.max(1, Number(frame.height) || 1);
    const multiplier = Math.min(2, Math.max(0.25, maxSide / Math.max(w, h)));
    const rendered = await renderExport({
      document: doc,
      format: 'png',
      multiplier,
      crop: {
        x: Number(frame.x) || 0,
        y: Number(frame.y) || 0,
        width: w,
        height: h,
      },
      backgroundColor: String(frame.backgroundColor || '#FFFFFF'),
    });
    return rendered?.kind === 'raster' ? rendered.dataUrl : null;
  }

  const nodeIds = (opts.nodeIds || []).filter(Boolean);
  if (!nodeIds.length) return null;

  let maxDim = 1;
  for (const id of nodeIds) {
    const node = doc?.deltaSetLike?.[id];
    if (!node) continue;
    maxDim = Math.max(maxDim, Number(node.width) || 0, Number(node.height) || 0);
  }
  // Groups span a larger AABB than any single member — keep a floor so detail survives.
  if (nodeIds.length > 1) maxDim = Math.max(maxDim, 240);
  const multiplier = Math.min(2, Math.max(0.25, maxSide / Math.max(maxDim, 1)));
  const rendered = await renderExport({
    document: doc,
    format: 'png',
    multiplier,
    selectionOnly: true,
    nodeIds,
  });
  return rendered?.kind === 'raster' ? rendered.dataUrl : null;
}

/** Rasterize the SVG board; with selectionOnly, only the given nodes are exported. */
export function exportFabricImage(options: ExportImageOptions = {}): boolean {
  // Sync API expected by callers — fire-and-forget download; return true if started.
  try {
    if (options.selectionOnly && !(options.nodeIds || []).length) {
      return false;
    }
    async function runExportOnce() {
      try {
        await exportOnce(options);
      } catch (err) {
        console.error(err);
      }
    }
    void runExportOnce();
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

/** Export several scale/format slots for the same selection. */
export async function exportSelectionSlots(opts: {
  nodeIds: string[];
  baseName: string;
  compress: boolean;
  slots: ExportSlotConfig[];
  document?: SceneDocument | null;
}): Promise<{ saved: number; cancelled: number; failed: number }> {
  const { nodeIds, baseName, compress, slots, document } = opts;
  const tally = { saved: 0, cancelled: 0, failed: 0 };
  if (!nodeIds.length || !slots.length) return tally;

  for (const slot of slots) {
    const filename = buildExportFilename(baseName, slot.affixMode, slot.affix);
    const result = await exportOnce({
      selectionOnly: true,
      nodeIds,
      document,
      multiplier: slot.scale,
      format: slot.format,
      compress,
      filename,
    });
    if (result === 'saved') tally.saved += 1;
    else if (result === 'cancelled') tally.cancelled += 1;
    else tally.failed += 1;
  }
  return tally;
}

/** Export an artboard / frame region (scene crop + optional background). */
export async function exportCropSlots(opts: {
  crop: { x: number; y: number; width: number; height: number };
  backgroundColor?: string;
  baseName: string;
  compress: boolean;
  slots: ExportSlotConfig[];
  /** Required on infinite canvas — live SvgBoard is not registered. */
  document?: SceneDocument | null;
}): Promise<{ saved: number; cancelled: number; failed: number }> {
  const { crop, backgroundColor, baseName, compress, slots, document } = opts;
  const tally = { saved: 0, cancelled: 0, failed: 0 };
  if (!crop || !(crop.width > 0) || !(crop.height > 0) || !slots.length) return tally;
  for (const slot of slots) {
    const filename = buildExportFilename(baseName, slot.affixMode, slot.affix);
    const result = await exportOnce({
      crop,
      backgroundColor,
      document,
      multiplier: slot.scale,
      format: slot.format,
      compress,
      filename,
    });
    if (result === 'saved') tally.saved += 1;
    else if (result === 'cancelled') tally.cancelled += 1;
    else tally.failed += 1;
  }
  return tally;
}
