/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ImageNode/ImageProcessWatcher.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useRef, memo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { message } from '@recombyn-native/components/base';
import { processImageTool } from '@recombyn-native/service/imageTools';
import { isUploadAbortError, uploadImageFromSrc } from '@recombyn-native/utils/uploadImage';
import { apiQuery, getHttpErrorMessage, getHttpStatus, queryClient } from '@recombyn-native/service/client';
import { failImageProcess, finishImageProcess } from '@recombyn-native/store/modules/editor';
import type { SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';

const AI_KINDS = new Set([
  'upscale',
  'removeBg',
  'multiAngle',
  'expand',
  'editText',
  'editElements',
  'replaceText',
  'adjust',
]);

const DECOMPOSE_KINDS = new Set(['editText', 'editElements']);

function parseMeta(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    return JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function aspectFromBox(w: number, h: number): string {
  const rw = Math.max(1, Math.round(w));
  const rh = Math.max(1, Math.round(h));
  const g = (a: number, b: number): number => (b === 0 ? a : g(b, a % b));
  const d = g(rw, rh) || 1;
  return `${Math.round(rw / d)}:${Math.round(rh / d)}`;
}

function resolutionFor(kind: string, node: SceneNodeInput): string | undefined {
  if (kind !== 'upscale') return undefined;
  const meta = parseMeta(node?.attrs?.processMeta);
  const fromMeta = String(meta.resolution || '')
    .trim()
    .toUpperCase();
  if (fromMeta === '2K' || fromMeta === '4K') return fromMeta;
  const tw = Number(node?.attrs?.processTargetWidth) || 0;
  if (tw >= 3500) return '4K';
  return '2K';
}

/** Persist tool output on our file server; fall back to original src if upload fails. */
async function persistProcessedSrc(src: string, filename: string): Promise<string> {
  const raw = String(src || '').trim();
  if (!raw) return raw;
  if (/^\/api\/canvas-assets\//.test(raw)) return raw;
  try {
    const uploaded = await uploadImageFromSrc(raw, filename);
    return uploaded.url || raw;
  } catch (err) {
    console.warn('[image-process] upload failed, keeping inline/remote src', err);
    return raw;
  }
}

async function refreshWallet() {
  try {
    // Force refresh after spend — share cache key with App / AccountSettings.
    await queryClient.fetchQuery({
      ...apiQuery.walletWalletMe.queryOptions(),
      staleTime: 0,
    });
  } catch {
    /* ignore wallet refresh errors */
  }
}

function processFailMessage(err: unknown): string {
  const status = getHttpStatus(err);
  const msg = getHttpErrorMessage(err, '');
  if (status === 402 || msg === 'Insufficient credits' || msg === 'Insufficient tokens')
    return 'Token 不足，请充值后再试';
  if (status === 401) return '请先登录后再使用 AI 工具';
  if (/timed out|timeout/i.test(msg) || (err as { code?: string })?.code === 'ECONNABORTED')
    return '处理超时：图生图会把原图发给方舟，通常比文生图慢。请检查网络后重试。';
  if (msg.trim()) return msg;
  return '图片处理失败';
}

function buildFinishAttrsForKind(
  kind: string,
  opts: {
    sourceGenPrompt?: string;
    replacedCopy?: string;
  }
): Record<string, unknown> | undefined {
  if (kind === 'removeBg') {
    return { cutout: 'true', name: '抠图' };
  }
  if (kind === 'replaceText' && opts.replacedCopy) {
    return {
      letteringText: opts.replacedCopy,
      genPrompt: [String(opts.sourceGenPrompt || '').trim(), `Text replaced to: ${opts.replacedCopy}`]
        .filter(Boolean)
        .join('\n'),
    };
  }
  return undefined;
}

/**
 * Completes spawned image process jobs via Kith Canvas generation jobs
 * (Seedream i2i). Results are durable canvas-asset URLs.
 * Import / upload placeholders are finished by their own flows.
 */
function ImageProcessWatcher() {
  const dispatch = useDispatch();
  const pendingId = useSelector((s: any) => s.editor.pendingImageProcessId as string | null);
  const document = useSelector((s: any) => s.editor.document);
  const documentRef = useRef(document);
  documentRef.current = document;

  useEffect(() => {
    if (!pendingId) return undefined;
    const doc = documentRef.current;
    const node = doc?.deltaSetLike?.[pendingId];
    const kind = String(node?.attrs?.processKind || '');
    // Local eraser finishes via ImageToolPanelHost (spawn + upload); do not auto-clear.
    if (kind === 'import' || kind === 'upload' || kind === 'eraser') return undefined;

    let cancelled = false;

    const fail = (msg: string) => {
      if (cancelled) return;
      message.error(msg);
      dispatch(failImageProcess({ nodeId: pendingId }));
    };

    const run = async () => {
      if (!AI_KINDS.has(kind)) {
        // Local-only kinds (eraser etc.) should not land here.
        await new Promise((r) => window.setTimeout(r, 400));
        if (!cancelled) dispatch(finishImageProcess({ nodeId: pendingId }));
        return;
      }

      const latest = documentRef.current;
      const liveNode = latest?.deltaSetLike?.[pendingId] || node;
      const sourceId = String(liveNode?.attrs?.processSourceId || '');
      const sourceNode = sourceId ? latest?.deltaSetLike?.[sourceId] : null;
      const image = String(sourceNode?.attrs?.src || liveNode?.attrs?.src || '');
      if (!image) {
        fail('未找到图片');
        return;
      }

      const w = Number(liveNode?.width) || Number(sourceNode?.width) || 1024;
      const h = Number(liveNode?.height) || Number(sourceNode?.height) || 1024;
      const meta = parseMeta(liveNode?.attrs?.processMeta);

      try {
        const processBody: {
          kind: string;
          image: string;
          meta?: Record<string, unknown>;
          aspect_ratio?: string;
          quality?: string;
          resolution?: string;
        } = {
          kind,
          image,
          quality: 'high',
        };
        if (meta) processBody.meta = meta;
        const aspect = aspectFromBox(w, h);
        if (aspect) processBody.aspect_ratio = aspect;
        const resolution = resolutionFor(kind, liveNode);
        if (resolution) processBody.resolution = resolution;
        const res = await processImageTool(processBody);
        if (cancelled) return;

        const layers = Array.isArray(res?.layers) ? res.layers : [];
        if (layers.length > 0 && DECOMPOSE_KINDS.has(kind)) {
          const persisted = await Promise.all(
            layers.map(async (layer: any, i: number) => {
              const src = String(layer?.src || '').trim();
              if (!src || String(layer?.type) === 'text') return layer;
              const url = await persistProcessedSrc(src, `${kind}-layer-${i + 1}.png`);
              return { ...layer, src: url };
            })
          );
          if (cancelled) return;
          dispatch(
            finishImageProcess({
              nodeId: pendingId,
              layers: persisted,
              sourceWidth: Number(res.width) || undefined,
              sourceHeight: Number(res.height) || undefined,
            })
          );
          const warn = Array.isArray(res.warnings) ? res.warnings.filter(Boolean) : [];
          if (warn.length) message.warning(warn[0]);
          else {
            message.success(
              kind === 'editElements' ? '图片分层完成（可单独改主体/文字）' : '文字识别完成'
            );
          }
          await refreshWallet();
          return;
        }

        if (!res?.image) {
          fail('图片处理未返回结果');
          return;
        }
        const storedUrl = await persistProcessedSrc(res.image, `${kind}.png`);
        if (cancelled) return;
        const replaceMeta = kind === 'replaceText' ? parseMeta(liveNode?.attrs?.processMeta) : {};
        const replacedCopy = String(replaceMeta.newText || '').trim();
        const finishAttrs = buildFinishAttrsForKind(kind, {
          sourceGenPrompt: String(sourceNode?.attrs?.genPrompt || ''),
          replacedCopy,
        });
        dispatch(
          finishImageProcess({
            nodeId: pendingId,
            src: storedUrl,
            ...(finishAttrs ? { attrs: finishAttrs } : {}),
          })
        );
        const labels: Record<string, string> = {
          removeBg: '抠图完成（透明 PNG）',
          upscale: '高清放大完成',
          multiAngle: '多角度生成完成',
          expand: '扩展完成',
          editText: '编辑文字完成',
          editElements: '图片分层完成',
          replaceText: '文案替换完成',
          vector: '矢量化完成',
          adjust: '调整完成',
        };
        message.success(labels[kind] || '处理完成');
        await refreshWallet();
      } catch (err: any) {
        if (cancelled || isUploadAbortError(err)) return;
        fail(processFailMessage(err));
      }
    };

    run();
    return () => {
      cancelled = true;
    };
    // Only re-run when a new job id is pending — not on every document edit.
  }, [pendingId, dispatch]);

  return null;
}

export default memo(ImageProcessWatcher);
