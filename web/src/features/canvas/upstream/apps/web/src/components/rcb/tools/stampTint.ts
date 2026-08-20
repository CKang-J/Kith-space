/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/tools/stampTint.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/** Colorize stamp tips (use alpha as mask, fill with stroke color). Hardness remaps alpha. */

const imageCache = new Map<string, HTMLImageElement>();
const tintCache = new Map<string, string>();

function cacheKey(src: string, color: string, hardness: number) {
  // Full src — data-URL prefixes are identical across PNGs; slice would collide.
  // t256 = tip raster max edge (invalidate older 128px tint cache entries).
  return `t256\0${src}\0${color}\0${Math.round(hardness)}`;
}

export const STAMP_TINT_READY_EVENT = 'recombine-stamp-tint-ready';

function notifyTintReady() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(STAMP_TINT_READY_EVENT));
}

export function preloadStampSrc(src: string) {
  if (!src || imageCache.has(src)) return;
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  imageCache.set(src, img);
}

function parseColor(color: string): { r: number; g: number; b: number; a: number } {
  const c = String(color || '#333333').trim();
  if (c.startsWith('#') && (c.length === 7 || c.length === 4)) {
    const hex =
      c.length === 4
        ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`
        : c;
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
      a: 1,
    };
  }
  const m = c.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (m) {
    return {
      r: Number(m[1]),
      g: Number(m[2]),
      b: Number(m[3]),
      a: m[4] != null ? Number(m[4]) : 1,
    };
  }
  return { r: 51, g: 51, b: 51, a: 1 };
}

/** Clamp hardness to 0–100. */
export function clampBrushHardness(hardness?: number | null): number {
  const n = Number(hardness);
  if (!Number.isFinite(n)) return 80;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Hardness on tip alpha (works for any uploaded tip).
 * Soft (0): keep feathered edge. Hard (100): crush soft fringe toward a crisp core.
 */
export function applyHardnessToAlpha(alpha01: number, hardness0to100: number): number {
  const a = Math.min(1, Math.max(0, alpha01));
  if (a <= 0) return 0;
  const h = clampBrushHardness(hardness0to100) / 100;
  // gamma: soft≈1.85 (more transparent mid), hard≈0.32 (boost mid → opaque)
  const gamma = 1.85 - h * 1.53;
  return Math.min(1, Math.pow(a, Math.max(0.28, gamma)));
}

function tintLoadedImage(
  img: HTMLImageElement,
  color: string,
  hardness0to100: number
): string | null {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  const canvas = document.createElement('canvas');
  // Keep tip texture sharp when strokes are zoomed (was 128 — soft under 200%+).
  const max = 256;
  const scale = Math.min(1, max / Math.max(w, h));
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  const { r, g, b, a: ca } = parseColor(color);
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    const luma = (data[i] + data[i + 1] + data[i + 2]) / (255 * 3);
    const coverage = applyHardnessToAlpha(alpha * (1 - luma * 0.15), hardness0to100);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    const a = Math.round(Math.min(255, coverage * ca * 255));
    data[i + 3] = a;
    if (a > 8) {
      const px = (i / 4) % canvas.width;
      const py = Math.floor(i / 4 / canvas.width);
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  // Crop empty tip padding so dab.size maps to real ink (avoids sausage gaps).
  if (maxX >= minX && maxY >= minY) {
    const pad = 1;
    const sx = Math.max(0, minX - pad);
    const sy = Math.max(0, minY - pad);
    const sw = Math.min(canvas.width - sx, maxX - minX + 1 + pad * 2);
    const sh = Math.min(canvas.height - sy, maxY - minY + 1 + pad * 2);
    if (sw < canvas.width * 0.98 || sh < canvas.height * 0.98) {
      const cropped = document.createElement('canvas');
      cropped.width = Math.max(1, sw);
      cropped.height = Math.max(1, sh);
      const cctx = cropped.getContext('2d');
      if (cctx) {
        cctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
        return cropped.toDataURL('image/png');
      }
    }
  }
  return canvas.toDataURL('image/png');
}

/**
 * Sync tinted stamp data-URL when the tip image is already loaded;
 * otherwise kick off a load and return the original src for now.
 * Fires STAMP_TINT_READY_EVENT once tint is cached so the canvas can refresh.
 */
export function getTintedStampSrc(
  src: string,
  color: string,
  hardness: number = 80
): string {
  if (!src) return src;
  const hard = clampBrushHardness(hardness);
  const key = cacheKey(src, color, hard);
  const hit = tintCache.get(key);
  if (hit) return hit;

  let img = imageCache.get(src);
  if (!img) {
    preloadStampSrc(src);
    img = imageCache.get(src);
  }
  if (img && img.complete && (img.naturalWidth || img.width)) {
    const tinted = tintLoadedImage(img, color, hard);
    if (tinted) {
      tintCache.set(key, tinted);
      return tinted;
    }
  } else if (img) {
    img.addEventListener(
      'load',
      () => {
        const tinted = tintLoadedImage(img!, color, hard);
        if (tinted) {
          tintCache.set(key, tinted);
          notifyTintReady();
        }
      },
      { once: true }
    );
  }
  return src;
}
