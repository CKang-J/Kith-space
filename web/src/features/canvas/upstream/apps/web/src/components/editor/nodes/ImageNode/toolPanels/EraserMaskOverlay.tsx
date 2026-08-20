/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ImageNode/toolPanels/EraserMaskOverlay.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  memo,
} from 'react';
import {
  RcbOverlayPortal,
  useRcbCamera,
  rcbSceneToScreen,
} from '@recombyn-native/components/rcb';
import { imageSrcToFile } from '@recombyn-native/utils/uploadImage';

/**
 * Opaque mask fill — preview opacity is applied via CSS on the canvas so
 * overlapping strokes do not stack / darken (single flat alpha layer).
 */
const MASK_FILL = '#9333EA';
const PREVIEW_OPACITY = 0.38;
/** Soft cap — getImageData + toDataURL on huge plates OOMs in Chromium. */
const MAX_ERASE_EDGE = 8192;

export type EraserMaskOverlayHandle = {
  clear: () => void;
  hasStrokes: () => boolean;
  /** Erase painted regions from `src` → PNG data URL. */
  applyErase: (src: string, opts?: { uploadKey?: string | null }) => Promise<string>;
};

type Props = {
  imageBox: { left: number; top: number; width: number; height: number };
  /** Brush diameter in world (image) pixels. */
  brushSize: number;
  onDirtyChange?: (dirty: boolean) => void;
};

function loadImageFromUrl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error('empty image src'));
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

/** Fetch via auth/upload pipeline so canvas is not CORS-tainted. */
async function loadImageForErase(
  src: string,
  uploadKey?: string | null
): Promise<HTMLImageElement> {
  const s = (src || '').trim();
  if (s.startsWith('data:') || s.startsWith('blob:')) {
    return loadImageFromUrl(s);
  }
  const file = await imageSrcToFile(s, 'erase-src.png', { uploadKey });
  const objectUrl = URL.createObjectURL(file);
  try {
    return await loadImageFromUrl(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * On-image eraser brush: paint a purple mask, then punch holes on confirm.
 */
const EraserMaskOverlay = forwardRef<EraserMaskOverlayHandle, Props>(
  function EraserMaskOverlay({ imageBox, brushSize, onDirtyChange }, ref): ReactNode {
    const camera = useRcbCamera();
    const z = Math.max(0.05, camera.zoom || 1);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const paintingRef = useRef(false);
    const lastRef = useRef<{ x: number; y: number } | null>(null);
    const dirtyRef = useRef(false);
    const onDirtyRef = useRef(onDirtyChange);
    onDirtyRef.current = onDirtyChange;
    const brushRef = useRef(brushSize);
    brushRef.current = brushSize;
    /** Tip center in stage (screen) px relative to the image overlay. */
    const [tip, setTip] = useState<{ x: number; y: number } | null>(null);

    const origin = rcbSceneToScreen(camera, imageBox.left, imageBox.top);
    const stageW = Math.max(1, imageBox.width * z);
    const stageH = Math.max(1, imageBox.height * z);
    const tipDiameter = Math.max(6, brushSize * z);

    const markDirty = () => {
      if (dirtyRef.current) return;
      dirtyRef.current = true;
      onDirtyRef.current?.(true);
    };

    const clear = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      dirtyRef.current = false;
      onDirtyRef.current?.(false);
    };

    useImperativeHandle(
      ref,
      () => ({
        clear,
        hasStrokes: () => dirtyRef.current,
        applyErase: async (src: string, opts?: { uploadKey?: string | null }) => {
          const maskEl = canvasRef.current;
          if (!maskEl || !dirtyRef.current) return src;
          const img = await loadImageForErase(src, opts?.uploadKey);
          const nw = Math.max(1, img.naturalWidth || img.width || 1);
          const nh = Math.max(1, img.naturalHeight || img.height || 1);
          if (nw > MAX_ERASE_EDGE || nh > MAX_ERASE_EDGE) {
            throw new Error(`图片过大（>${MAX_ERASE_EDGE}px），请先缩小后再擦`);
          }

          const out = document.createElement('canvas');
          out.width = nw;
          out.height = nh;
          const ctx = out.getContext('2d');
          if (!ctx) throw new Error('canvas unsupported');
          ctx.drawImage(img, 0, 0, nw, nh);

          // Hard mask from preview alpha → full erase under strokes.
          const hard = document.createElement('canvas');
          hard.width = nw;
          hard.height = nh;
          const hctx = hard.getContext('2d');
          if (!hctx) throw new Error('canvas unsupported');
          hctx.drawImage(maskEl, 0, 0, nw, nh);
          const data = hctx.getImageData(0, 0, nw, nh);
          const px = data.data;
          for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] > 8) {
              px[i] = 0;
              px[i + 1] = 0;
              px[i + 2] = 0;
              px[i + 3] = 255;
            } else {
              px[i + 3] = 0;
            }
          }
          hctx.putImageData(data, 0, 0);

          ctx.globalCompositeOperation = 'destination-out';
          ctx.drawImage(hard, 0, 0);
          try {
            return out.toDataURL('image/png');
          } catch {
            throw new Error('无法导出擦除结果（图片跨域或内存不足）');
          }
        },
      }),
      []
    );

    // Keep backing-store resolution tied to stage size; preserve strokes across zoom.
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const w = Math.max(1, Math.round(stageW));
      const h = Math.max(1, Math.round(stageH));
      if (canvas.width === w && canvas.height === h) return;
      const prev = document.createElement('canvas');
      prev.width = canvas.width || 1;
      prev.height = canvas.height || 1;
      const pctx = prev.getContext('2d');
      if (pctx && canvas.width && canvas.height) {
        pctx.drawImage(canvas, 0, 0);
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx && prev.width > 1 && prev.height > 1) {
        ctx.drawImage(prev, 0, 0, w, h);
      }
    }, [stageW, stageH]);

    const localFromClient = (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      return {
        x: ((clientX - rect.left) / rect.width) * canvas.width,
        y: ((clientY - rect.top) / rect.height) * canvas.height,
        stageX: clientX - rect.left,
        stageY: clientY - rect.top,
        inside:
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom,
      };
    };

    const strokeTo = (x: number, y: number, from: { x: number; y: number } | null) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      // brushSize is world px; canvas is stage px → multiply by zoom.
      const r = Math.max(1, (brushRef.current * z) / 2);
      // Paint opaque; CSS opacity on the canvas keeps the whole mask at one alpha.
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.strokeStyle = MASK_FILL;
      ctx.fillStyle = MASK_FILL;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = r * 2;
      if (!from) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      markDirty();
    };

    useEffect(() => {
      const onMove = (e: PointerEvent) => {
        const p = localFromClient(e.clientX, e.clientY);
        if (!p) {
          setTip(null);
          return;
        }
        if (p.inside || paintingRef.current) setTip({ x: p.stageX, y: p.stageY });
        else setTip(null);
        if (!paintingRef.current) return;
        strokeTo(p.x, p.y, lastRef.current);
        lastRef.current = { x: p.x, y: p.y };
      };
      const onUp = () => {
        paintingRef.current = false;
        lastRef.current = null;
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      return () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
    }, [z]);

    const style: CSSProperties = {
      position: 'absolute',
      left: origin.x,
      top: origin.y,
      width: stageW,
      height: stageH,
      zIndex: 34,
      cursor: 'none',
      touchAction: 'none',
      opacity: PREVIEW_OPACITY,
    };

    const tipStyle: CSSProperties | undefined = tip
      ? {
          position: 'absolute',
          left: origin.x + tip.x,
          top: origin.y + tip.y,
          width: tipDiameter,
          height: tipDiameter,
          marginLeft: -tipDiameter / 2,
          marginTop: -tipDiameter / 2,
          zIndex: 35,
          borderRadius: '50%',
          background: 'rgba(147, 51, 234, 0.35)',
          border: '1.5px solid rgba(88, 28, 135, 0.9)',
          boxSizing: 'border-box',
          pointerEvents: 'none',
        }
      : undefined;

    return (
      <RcbOverlayPortal>
        <canvas
          ref={canvasRef}
          data-eraser-mask
          data-image-tool-panel
          className="pointer-events-auto absolute"
          style={style}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation?.();
            const p = localFromClient(e.clientX, e.clientY);
            if (!p) return;
            setTip({ x: p.stageX, y: p.stageY });
            paintingRef.current = true;
            lastRef.current = { x: p.x, y: p.y };
            strokeTo(p.x, p.y, null);
            (e.target as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
          }}
          onPointerLeave={() => {
            if (!paintingRef.current) setTip(null);
          }}
        />
        {tip && tipStyle ? <div aria-hidden data-image-tool-panel style={tipStyle} /> : null}
      </RcbOverlayPortal>
    );
  }
);

export default memo(EraserMaskOverlay);
