/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ImageNode/mark/MarkSessionHost.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  memo,
} from 'react';
import { createPortal } from '@/features/canvas/adapters/recombynReactDom';
import { useDispatch, useSelector } from 'react-redux';
import { nanoid } from 'nanoid';
import { rcbSceneToScreen, useRcbCamera } from '@recombyn-native/components/rcb';
import { nodeLeftTop } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import {
  closeImageToolPanel,
  enqueueAgentContexts,
} from '@recombyn-native/store/modules/editor';
import { CONTEXT_CHIP_PILL_CLASS } from '@recombyn-native/components/editor/panels/AgentComposerInput';
import { resolveChatFlyTarget } from '@recombyn-native/components/editor/panels/agent/flyToChat';
import { getHttpErrorMessage } from '@recombyn-native/service/client';
import {
  processImageTool,
  type ImageDecomposeLayer,
} from '@recombyn-native/service/imageTools';
import { imageSrcToFile } from '@recombyn-native/utils/uploadImage';
import { cn } from '@recombyn-native/utils/classnames';
import MarkRegionOverlay, {
  type MarkRect,
  type MarkRegion,
} from './MarkRegionOverlay';
import type { SceneDocument, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';

type SceneBox = { left: number; top: number; width: number; height: number };

type FlyAnim = {
  id: string;
  /** Fixed-viewport start (chip center). */
  startX: number;
  startY: number;
  /** Fixed-viewport end (composer / dock). */
  endX: number;
  endY: number;
  thumbUrl?: string;
  label: string;
  phase: 'ready' | 'flying' | 'done';
};

const FLY_MS = 640;
const CHIP_W = 112;
const CHIP_H = 28;

function nodeBox(
  document: SceneDocument,
  node: SceneNodeInput
): SceneBox | null {
  if (!node) return null;
  const { left, top } = nodeLeftTop(document, node);
  return {
    left,
    top,
    width: Math.max(1, Number(node.width) || 1),
    height: Math.max(1, Number(node.height) || 1),
  };
}

function regionLabel(layer: ImageDecomposeLayer, index: number): string {
  const name = String(layer.name || '').trim();
  if (name) return `${index} ${name}`;
  if (layer.type === 'text') {
    const text = String(layer.text || '').trim();
    if (text) return `${index} ${text.slice(0, 12)}`;
    return `${index} 文字`;
  }
  return `${index} 区域`;
}

/** Map API source-pixel layers → image-local mark regions. */
function layersToRegions(
  layers: ImageDecomposeLayer[],
  naturalW: number,
  naturalH: number,
  nodeW: number,
  nodeH: number
): MarkRegion[] {
  const sx = nodeW / Math.max(1, naturalW);
  const sy = nodeH / Math.max(1, naturalH);
  const out: MarkRegion[] = [];
  for (const layer of layers) {
    if (layer.type !== 'image' && layer.type !== 'text') continue;
    const x = Number(layer.x) || 0;
    const y = Number(layer.y) || 0;
    const w = Math.max(1, Number(layer.width) || 1);
    const h = Math.max(1, Number(layer.height) || 1);
    if (w * sx >= nodeW * 0.92 && h * sy >= nodeH * 0.92) continue;
    const index = out.length + 1;
    out.push({
      id: nanoid(8),
      index,
      x: x * sx,
      y: y * sy,
      w: w * sx,
      h: h * sy,
      kind: layer.type,
      label: regionLabel(layer, index),
      selected: false,
    });
  }
  return out;
}

async function loadImageForCrop(
  src: string,
  uploadKey?: string | null
): Promise<{ img: HTMLImageElement; revoke: () => void }> {
  const file = await imageSrcToFile(src, 'mark-crop.png', { uploadKey });
  const blobUrl = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error('image load failed'));
    };
    el.src = blobUrl;
  });
  return { img, revoke: () => URL.revokeObjectURL(blobUrl) };
}

/** Crop image-local mark rect → PNG data URL (natural pixels). */
async function cropMarkRegionDataUrl(
  src: string,
  nodeW: number,
  nodeH: number,
  rect: MarkRect,
  uploadKey?: string | null
): Promise<string> {
  const { img, revoke } = await loadImageForCrop(src, uploadKey);
  try {
    const nw = Math.max(1, img.naturalWidth || img.width || 1);
    const nh = Math.max(1, img.naturalHeight || img.height || 1);
    const sx = (rect.x / Math.max(1, nodeW)) * nw;
    const sy = (rect.y / Math.max(1, nodeH)) * nh;
    const sw = Math.max(1, (rect.w / Math.max(1, nodeW)) * nw);
    const sh = Math.max(1, (rect.h / Math.max(1, nodeH)) * nh);
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw));
    canvas.height = Math.max(1, Math.round(sh));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unsupported');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    revoke();
  }
}

function buildMarkChipPayload(
  nodeId: string,
  region: MarkRegion,
  nodeW: number,
  nodeH: number
): string {
  const nx = (region.x / nodeW).toFixed(3);
  const ny = (region.y / nodeH).toFixed(3);
  const nw = (region.w / nodeW).toFixed(3);
  const nh = (region.h / nodeH).toFixed(3);
  const tag = region.kind === 'text' ? 'text' : 'subject';
  return [
    '[Marked image region — edit this area on the referenced image]',
    `node_id: ${nodeId}`,
    `region: #${region.index}(${tag}@${nx},${ny},${nw}x${nh})`,
    `label: ${region.label || `区域 ${region.index}`}`,
  ].join('\n');
}

/** Landing point inside the right Agent composer (fallback: dock / viewport). */
function resolveMarkChatFlyTarget(): { x: number; y: number } {
  return resolveChatFlyTarget({ landId: 'agent' });
}

/**
 * Mark tool session: auto subject/text proposals + manual box select.
 * Selecting a region flies an @ chip into the right AgentDock chat.
 */
function MarkSessionHost({ document }: { document: SceneDocument }): ReactNode {
  const dispatch = useDispatch();
  const camera = useRcbCamera();
  const panel = useSelector(
    (s: any) =>
      s.editor.imageToolPanel as null | { nodeId: string; kind: string }
  );
  const selectedNodeId = useSelector(
    (s: any) => s.editor.selectedNodeId as string | null
  );
  const active = panel?.kind === 'mark' ? panel.nodeId : null;
  const node = active ? document?.deltaSetLike?.[active] : null;
  const box = useMemo(
    () => (active && node ? nodeBox(document, node) : null),
    [document, active, node]
  );
  const src = String(node?.attrs?.src || '').trim();
  const uploadKey =
    String(node?.attrs?.uploadKey || node?.attrs?.key || '').trim() || null;

  const [regions, setRegions] = useState<MarkRegion[]>([]);
  const [draft, setDraft] = useState<MarkRect | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [flies, setFlies] = useState<FlyAnim[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const detectGenRef = useRef(0);
  const inflightRef = useRef<Set<string>>(new Set());

  const close = () => dispatch(closeImageToolPanel());

  useEffect(() => {
    if (!active) return;
    if (!selectedNodeId || selectedNodeId !== active) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, active]);

  useEffect(() => {
    if (!active) return;
    if (!node || node.key !== 'image') close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, node?.key]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!active || !src || !box) return;
    setRegions([]);
    setDraft(null);
    setFlies([]);
    const gen = ++detectGenRef.current;
    setDetecting(true);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    async function runDetect() {
      try {
        const res = await processImageTool(
          { kind: 'detectRegions', image: src },
          { signal: ac.signal }
        );
        if (gen !== detectGenRef.current) return;
        const nw = Math.max(1, Number(res.width) || box!.width);
        const nh = Math.max(1, Number(res.height) || box!.height);
        const next = layersToRegions(
          res.layers || [],
          nw,
          nh,
          box!.width,
          box!.height
        ).map((r, i) => ({
          ...r,
          index: i + 1,
          selected: false,
        }));
        setRegions(next);
        if (res.warnings?.length) {
          console.info('[mark] detect warnings', res.warnings);
        }
      } catch (err: unknown) {
        if (ac.signal.aborted || gen !== detectGenRef.current) return;
        const msg = getHttpErrorMessage(err, '');
        if (msg && !/unsupported kind|detectRegions/i.test(msg)) {
          console.info('[mark] detect failed', msg);
        }
      } finally {
        if (gen === detectGenRef.current) setDetecting(false);
      }
    }
    void runDetect();

    return () => {
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, src]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const renumber = (list: MarkRegion[]): MarkRegion[] =>
    list.map((r, i) => ({
      ...r,
      index: i + 1,
      label:
        r.kind === 'manual'
          ? `${i + 1} 区域`
          : r.label?.replace(/^\d+\s*/, `${i + 1} `) || `${i + 1} 区域`,
    }));

  const flyRegionToChat = async (region: MarkRegion) => {
    if (!active || !box || !src) return;
    if (inflightRef.current.has(region.id)) return;
    inflightRef.current.add(region.id);

    const center = rcbSceneToScreen(
      camera,
      box.left + region.x + region.w / 2,
      box.top + region.y + region.h / 2
    );
    const target = resolveMarkChatFlyTarget();
    const flyId = nanoid(6);
    const label = region.label || `${region.index} 区域`;

    setFlies((prev) => [
      ...prev,
      {
        id: flyId,
        startX: center.x,
        startY: center.y,
        endX: target.x,
        endY: target.y,
        label,
        phase: 'ready',
      },
    ]);

    const cropPromise = cropMarkRegionDataUrl(
      src,
      box.width,
      box.height,
      region,
      uploadKey
    ).catch((err: unknown) => {
      console.info('[mark] crop failed', getHttpErrorMessage(err, ''));
      return undefined;
    });

    // Pop-in, then fly — wait for thumb (capped) so the chip looks real mid-flight.
    const [thumb] = await Promise.all([
      cropPromise,
      new Promise<void>((r) => window.setTimeout(r, 140)),
    ]);

    const land = resolveMarkChatFlyTarget();
    setFlies((prev) =>
      prev.map((f) =>
        f.id === flyId
          ? {
              ...f,
              thumbUrl: thumb,
              endX: land.x,
              endY: land.y,
              phase: 'flying',
            }
          : f
      )
    );

    // Insert into chat as the tag arrives so it feels continuous.
    window.setTimeout(() => {
      dispatch(
        enqueueAgentContexts([
          {
            key: `mark:${active}:${region.id}`,
            label: region.label || `区域 ${region.index}`,
            kind: 'image',
            payload: buildMarkChipPayload(active, region, box.width, box.height),
            ...(thumb ? { dataUrl: thumb, thumbUrl: thumb } : {}),
          },
        ])
      );
    }, Math.round(FLY_MS * 0.78));

    window.setTimeout(() => {
      setFlies((prev) => prev.filter((f) => f.id !== flyId));
      inflightRef.current.delete(region.id);
    }, FLY_MS + 100);
  };

  const onCommitDraft = (rect: MarkRect) => {
    const nextRegion: MarkRegion = {
      id: nanoid(8),
      index: regions.length + 1,
      ...rect,
      kind: 'manual',
      label: `${regions.length + 1} 区域`,
      selected: true,
    };
    setRegions((prev) => {
      const cleared = prev.map((r) => ({ ...r, selected: false }));
      return renumber([...cleared, nextRegion]);
    });
    flyRegionToChat(nextRegion);
  };

  const onSelectRegion = (id: string, _additive: boolean) => {
    const hit = regions.find((r) => r.id === id);
    setRegions((prev) => prev.map((r) => ({ ...r, selected: r.id === id })));
    if (hit) flyRegionToChat(hit);
  };

  if (!active || !box || !node) return null;

  return (
    <>
      <style>{`
        @keyframes mark-chip-pop {
          0% { transform: translate(-50%, -50%) scale(0.55); opacity: 0; }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        }
        @keyframes mark-chip-fly {
          0% {
            transform: translate(-50%, -50%) scale(1) rotate(0deg);
            opacity: 1;
            box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
          }
          55% {
            opacity: 1;
            box-shadow: 0 12px 32px rgba(59, 130, 246, 0.28);
          }
          100% {
            transform: translate(
                calc(-50% + var(--mark-dx)),
                calc(-50% + var(--mark-dy))
              )
              scale(0.72)
              rotate(-6deg);
            opacity: 0;
            box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
          }
        }
      `}</style>
      <MarkRegionOverlay
        imageBox={box}
        regions={regions}
        draft={draft}
        detecting={detecting}
        onDraftChange={setDraft}
        onCommitDraft={onCommitDraft}
        onSelectRegion={onSelectRegion}
      />
      {flies.length
        ? createPortal(
            <>
              {flies.map((fly) => {
                const dx = fly.endX - fly.startX;
                const dy = fly.endY - fly.startY;
                const style: CSSProperties = {
                  position: 'fixed',
                  left: fly.startX,
                  top: fly.startY,
                  width: CHIP_W,
                  height: CHIP_H,
                  zIndex: 9999,
                  pointerEvents: 'none',
                  ['--mark-dx' as string]: `${dx}px`,
                  ['--mark-dy' as string]: `${dy}px`,
                  animation:
                    fly.phase === 'flying'
                      ? `mark-chip-fly ${FLY_MS}ms cubic-bezier(0.22, 0.82, 0.2, 1) forwards`
                      : `mark-chip-pop 160ms cubic-bezier(0.22, 1.2, 0.36, 1) forwards`,
                  transform: 'translate(-50%, -50%)',
                  willChange: 'transform, opacity',
                };
                return (
                  <div
                    key={fly.id}
                    aria-hidden
                    data-mark-fly-chip
                    className={cn(
                      CONTEXT_CHIP_PILL_CLASS,
                      'pl-1 pr-2 shadow-[0_10px_28px_rgba(15,23,42,0.2)] ring-1 ring-sky-400/55'
                    )}
                    style={style}
                  >
                    {fly.thumbUrl ? (
                      <img
                        src={fly.thumbUrl}
                        alt=""
                        className="h-3.5 w-3.5 shrink-0 rounded-[3px] object-cover ring-1 ring-[var(--line)]"
                        draggable={false}
                      />
                    ) : (
                      <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] bg-sky-100 text-[9px] font-semibold text-sky-700 ring-1 ring-sky-200">
                        @
                      </span>
                    )}
                    <span className="truncate font-medium">{fly.label}</span>
                  </div>
                );
              })}
            </>,
            globalThis.document.body
          )
        : null}
    </>
  );
}

export default memo(MarkSessionHost);
