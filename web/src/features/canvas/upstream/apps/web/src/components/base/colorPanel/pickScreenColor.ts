/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/colorPanel/pickScreenColor.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { getRecombynPortalRoot } from '@/features/canvas/adapters/recombynFloatingUi';
type EyeDropperResult = { sRGBHex: string };
type EyeDropperCtor = new () => { open: (opts?: { signal?: AbortSignal }) => Promise<EyeDropperResult> };

const LOUPE_SIZE = 128;
const LOUPE_ZOOM = 10;

function normalizeHex(input: string, fallback = '#000000') {
  const raw = input.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return raw.toUpperCase();
  if (/^[0-9A-Fa-f]{6}$/.test(raw)) return `#${raw.toUpperCase()}`;
  return fallback;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}

async function svgToDataUrl(svg: SVGSVGElement): Promise<string> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  const xml = new XMLSerializer().serializeToString(clone);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
}

async function captureStageBitmap(): Promise<{
  canvas: HTMLCanvasElement;
  originX: number;
  originY: number;
  dpr: number;
} | null> {
  const stage = document.querySelector('[data-canvas-stage]') as HTMLElement | null;
  if (!stage) return null;
  const rect = stage.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const stageBg = getComputedStyle(stage).backgroundColor || '#f5f5f5';
  ctx.fillStyle = stageBg;
  ctx.fillRect(0, 0, rect.width, rect.height);

  const papers = stage.querySelectorAll<HTMLElement>('.rcb-canvas-paper');
  for (const paper of papers) {
    const pr = paper.getBoundingClientRect();
    const x = pr.left - rect.left;
    const y = pr.top - rect.top;
    const paperBg = getComputedStyle(paper).backgroundColor;
    if (paperBg && paperBg !== 'rgba(0, 0, 0, 0)' && paperBg !== 'transparent') {
      ctx.fillStyle = paperBg;
      ctx.fillRect(x, y, pr.width, pr.height);
    }
    const svg = paper.querySelector('svg');
    if (!svg) continue;
    try {
      const url = await svgToDataUrl(svg as SVGSVGElement);
      const img = await loadImage(url);
      ctx.drawImage(img, x, y, pr.width, pr.height);
    } catch {
      // External assets / tainted SVG — skip this paper layer.
    }
  }

  return { canvas, originX: rect.left, originY: rect.top, dpr };
}

function sampleHex(
  ctx: CanvasRenderingContext2D,
  clientX: number,
  clientY: number,
  originX: number,
  originY: number,
  dpr: number
): string | null {
  const x = Math.round((clientX - originX) * dpr);
  const y = Math.round((clientY - originY) * dpr);
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  if (x < 0 || y < 0 || x >= w || y >= h) return null;
  const data = ctx.getImageData(x, y, 1, 1).data;
  return normalizeHex(
    `#${[data[0], data[1], data[2]].map((n) => n.toString(16).padStart(2, '0')).join('')}`,
    '#000000'
  );
}

/** Custom loupe fallback when EyeDropper API is unavailable (e.g. Firefox / Safari). */
function pickColorWithLoupe(): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (hex: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(hex);
    };

    let bitmap: Awaited<ReturnType<typeof captureStageBitmap>> = null;
    let sampleCtx: CanvasRenderingContext2D | null = null;

    const overlay = document.createElement('div');
    overlay.setAttribute('data-color-eyedropper', '1');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483000',
      cursor: 'none',
      background: 'transparent',
    });

    const loupe = document.createElement('canvas');
    loupe.width = LOUPE_SIZE;
    loupe.height = LOUPE_SIZE;
    Object.assign(loupe.style, {
      position: 'fixed',
      width: `${LOUPE_SIZE}px`,
      height: `${LOUPE_SIZE}px`,
      borderRadius: '50%',
      border: '2px solid #fff',
      boxShadow: '0 0 0 1px rgba(0,0,0,.35), 0 10px 28px rgba(0,0,0,.28)',
      pointerEvents: 'none',
      imageRendering: 'pixelated',
      left: '0px',
      top: '0px',
      transform: 'translate(-50%, -50%)',
    });
    const loupeCtx = loupe.getContext('2d');
    if (loupeCtx) {
      loupeCtx.imageSmoothingEnabled = false;
    }

    const tip = document.createElement('div');
    Object.assign(tip.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      transform: 'translate(-50%, 70px)',
      padding: '2px 8px',
      borderRadius: '6px',
      background: 'rgba(15,23,42,.88)',
      color: '#fff',
      fontSize: '11px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
    });

    overlay.appendChild(loupe);
    overlay.appendChild(tip);
    getRecombynPortalRoot().appendChild(overlay);

    const paintLoupe = (clientX: number, clientY: number) => {
      if (!bitmap || !sampleCtx || !loupeCtx) return;
      const hex = sampleHex(
        sampleCtx,
        clientX,
        clientY,
        bitmap.originX,
        bitmap.originY,
        bitmap.dpr
      );
      tip.textContent = hex ?? '—';
      tip.style.opacity = hex ? '1' : '0.55';

      const srcX = Math.round((clientX - bitmap.originX) * bitmap.dpr);
      const srcY = Math.round((clientY - bitmap.originY) * bitmap.dpr);
      const half = (LOUPE_SIZE / LOUPE_ZOOM) / 2;
      loupeCtx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
      loupeCtx.fillStyle = '#e5e5e5';
      loupeCtx.fillRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
      loupeCtx.drawImage(
        bitmap.canvas,
        srcX - half,
        srcY - half,
        half * 2,
        half * 2,
        0,
        0,
        LOUPE_SIZE,
        LOUPE_SIZE
      );

      // Center pixel target.
      const cx = LOUPE_SIZE / 2;
      const cy = LOUPE_SIZE / 2;
      const s = Math.max(LOUPE_ZOOM, 8);
      loupeCtx.strokeStyle = 'rgba(15,23,42,.9)';
      loupeCtx.lineWidth = 1.5;
      loupeCtx.strokeRect(cx - s / 2, cy - s / 2, s, s);
      loupeCtx.strokeStyle = 'rgba(255,255,255,.95)';
      loupeCtx.lineWidth = 1;
      loupeCtx.strokeRect(cx - s / 2 - 1, cy - s / 2 - 1, s + 2, s + 2);

      loupe.style.left = `${clientX}px`;
      loupe.style.top = `${clientY}px`;
      tip.style.left = `${clientX}px`;
      tip.style.top = `${clientY}px`;
    };

    const onMove = (e: PointerEvent) => {
      paintLoupe(e.clientX, e.clientY);
    };
    const onClick = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!bitmap || !sampleCtx) {
        finish(null);
        return;
      }
      const hex = sampleHex(
        sampleCtx,
        e.clientX,
        e.clientY,
        bitmap.originX,
        bitmap.originY,
        bitmap.dpr
      );
      // Outside the stage — ignore (keep picking); Esc cancels.
      if (!hex) return;
      finish(hex);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      }
    };

    function cleanup() {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerdown', onClick, true);
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
    }

    async function initLoupe() {
      bitmap = await captureStageBitmap();
      if (!bitmap) {
        finish(null);
        return;
      }
      sampleCtx = bitmap.canvas.getContext('2d', { willReadFrequently: true });
      if (!sampleCtx) {
        finish(null);
        return;
      }
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerdown', onClick, true);
      window.addEventListener('keydown', onKey, true);
      // Seed loupe at current pointer if possible.
      paintLoupe(window.innerWidth / 2, window.innerHeight / 2);
    }
    initLoupe();
  });
}

/** Pick a screen color via EyeDropper when available, else a canvas loupe. */
export async function pickScreenColor(signal?: AbortSignal): Promise<string | null> {
  const Ctor = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
  if (typeof Ctor === 'function') {
    try {
      const result = await new Ctor().open(signal ? { signal } : undefined);
      return normalizeHex(result.sRGBHex, '#000000');
    } catch {
      return null;
    }
  }
  return pickColorWithLoupe();
}
