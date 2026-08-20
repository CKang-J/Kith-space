/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ImageNode/ImageQuickEditComposer.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { HiOutlineBolt, HiOutlineChevronDown, HiOutlinePlus, HiOutlineViewfinderCircle } from 'react-icons/hi2';
type LlmModel = { id: string; kind?: string; label?: string; [key: string]: unknown };
import { Dropdown, DropdownPanel, message, Tooltip } from '@recombyn-native/components/base';
import {
  RcbOverlayPortal,
  rcbScreenPxToScene,
  useRcbCamera,
  useRcbScreenToolbarStyle,
} from '@recombyn-native/components/rcb';
import { SELECTION_TOOLBAR_BELOW_BOX_GAP_PX } from '@recombyn-native/components/rcb/selection/chrome/SelectionToolbarShell';
import AgentComposerInput, {
  type AgentComposerHandle,
  type ComposerContext,
} from '@recombyn-native/components/editor/panels/AgentComposerInput';
import {
  ComposerAttachmentChip,
  composerAttachActionClass,
} from '@recombyn-native/components/editor/panels/agent/AgentComposerShell';
import {
  buildImageGeneratorModelList,
  flyPickIntoImageComposer,
} from '@recombyn-native/components/editor/nodes/ImageGeneratorNode/ImageGeneratorCard';
import ImageAspectRatioPicker, {
  DEFAULT_IMAGE_COUNT,
  DEFAULT_IMAGE_QUALITY,
  DEFAULT_IMAGE_ASPECT_RATIO,
  DEFAULT_IMAGE_RESOLUTION,
  modelImageLimits,
} from '@recombyn-native/components/editor/panels/agent/ImageAspectRatioPicker';
import ModelPickerPanel, {
  ModelBrandIcon,
} from '@recombyn-native/components/editor/panels/agent/ModelPickerPanel';
import { cloudImageFallbackId } from '@recombyn-native/components/editor/panels/agent/llmModelMeta';
import {
  listImageVariantUrls,
  writeImageVariantsAttr,
  clearImageProcessAttrs,
} from '@recombyn-native/components/rcb/scene/document/mediaLifecycle';
import {
  clearCanvasAttachPick,
  closeImageToolPanel,
  consumePendingCanvasAttach,
  finishImageProcess,
  patchDocumentNode,
  pushEditorHistory,
  setDocumentFromCanvas,
  startCanvasAttachPick,
} from '@recombyn-native/store/modules/editor';
import { noteCanvasFlyLand } from '@recombyn-native/components/editor/panels/agent/flyToChat';
import { FREE_IMAGE_MODEL_ID, planAllowsModelPick } from '@recombyn-native/utils/wallet';
import { useWalletSnapshot } from '@recombyn-native/service/wallet';
import { cn } from '@recombyn-native/utils/classnames';
import { isDesktopLocal } from '@recombyn-native/utils/apiBase';
import { estimateImageCredits } from '@recombyn-native/utils/imageCredits';
import { readFileAsDataUrl } from '@/features/canvas/adapters/recombynLocalMedia';
import { firstReferenceAssetId, runCanvasMediaGeneration } from '@/features/canvas/adapters/recombynGeneration';
import store from '@recombyn-native/store';

type SceneBox = { left: number; top: number; width: number; height: number };

function nextQuickEditImageModelId(
  models: LlmModel[],
  currentId: string,
  canPickModel: boolean
): string | null {
  if (!canPickModel) {
    const fallback = cloudImageFallbackId();
    if (!fallback || currentId === fallback) return null;
    return fallback;
  }
  if (!models.length || models.some((m) => m.id === currentId)) return null;
  if (!isDesktopLocal()) {
    const preferred =
      models.find((m) => m.id === FREE_IMAGE_MODEL_ID) ||
      models.find((m) => /seedream/i.test(m.id));
    if (preferred) return preferred.id;
  }
  return models[0]?.id ?? null;
}

function ratioSummaryLabel(aspectRatio: string, t: (k: string) => string) {
  const raw = String(aspectRatio || '').trim();
  if (raw === 'smart') return t('agent.ratioSmart');
  if (/^\d+x\d+$/i.test(raw)) {
    const [a, b] = raw.toLowerCase().split('x');
    return `${a}脳${b}`;
  }
  return raw || '1:1';
}

/**
 * Floating quick-edit composer under a selected image (Chat on image toolbar).
 * Prefills `attrs.genPrompt` when the image was prompt-generated; sends the
 * current image as the primary reference for i2i edits.
 */
function ImageQuickEditComposer({
  document,
  nodeId,
  box,
}: {
  document: SceneDocument;
  nodeId: string;
  box: SceneBox;
}): ReactNode {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const camera = useRcbCamera();
  const zoom = Math.max(0.05, camera.zoom || 1);
  const inputRef = useRef<AgentComposerHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const node = document?.deltaSetLike?.[nodeId];
  const src = String(node?.attrs?.src || '').trim();
  const savedPrompt = String(node?.attrs?.genPrompt || '').trim();

  const [prompt, setPrompt] = useState(savedPrompt);
  const [contexts, setContexts] = useState<ComposerContext[]>([]);
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [modelsStatus, setModelsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle'
  );
  const [modelId, setModelId] = useState(() => cloudImageFallbackId());
  const [resolution, setResolution] = useState<string>(DEFAULT_IMAGE_RESOLUTION);
  const [aspectRatio, setAspectRatio] = useState<string>(DEFAULT_IMAGE_ASPECT_RATIO);
  const [imageCount, setImageCount] = useState<number>(DEFAULT_IMAGE_COUNT);

  const { planId } = useWalletSnapshot();
  const canPickModel = true;
  const canvasAttachPick = useSelector(
    (s: any) => s.editor?.canvasAttachPick as null | { target: string }
  );
  const pendingCanvasAttach = useSelector(
    (s: any) =>
      s.editor?.pendingCanvasAttach as null | {
        target: string;
        payload: string | string[];
      }
  );
  const pickTarget = `node:${nodeId}`;
  const pickingFromCanvas = canvasAttachPick?.target === pickTarget;
  const contextsRef = useRef(contexts);
  contextsRef.current = contexts;

  useEffect(() => {
    setPrompt(savedPrompt);
  }, [nodeId, savedPrompt]);

  useEffect(() => {
    if (!pendingCanvasAttach || pendingCanvasAttach.target !== pickTarget) return;
    const payload = pendingCanvasAttach.payload;
    dispatch(consumePendingCanvasAttach());
    async function flyPendingAttach() {
      await flyPickIntoImageComposer({
        landId: pickTarget,
        document,
        payload,
        existing: contextsRef.current,
        setContexts,
        insertChip: (ctx) => {
          inputRef.current?.insertContextAtCaret(ctx);
          inputRef.current?.focus();
        },
      });
    }
    flyPendingAttach();
  }, [pendingCanvasAttach, pickTarget, document, dispatch]);

  // Auto-focus prompt when the floating chat panel opens.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [nodeId]);

  useEffect(() => {
    const localModels = buildImageGeneratorModelList(null);
    setModels(localModels);
    setModelsStatus('ready');
    const nextId = nextQuickEditImageModelId(localModels, modelId, canPickModel);
    if (nextId) setModelId(nextId);
    // Stage 1 never requests the Recombyn model catalog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  useEffect(() => {
    if (sending) return;
    if (String(node?.attrs?.processStatus) !== 'running') return;
    const timer = window.setTimeout(() => {
      if (abortRef.current) return;
      const doc = (store.getState() as any).editor?.document;
      if (doc) dispatch(setDocumentFromCanvas(clearImageProcessAttrs(doc, nodeId)));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [dispatch, nodeId, sending, node?.attrs?.processStatus]);

  useEffect(() => {
    if (!sending) return;
    const timer = window.setTimeout(() => {
      message.info('仍在等待方舟返回。图生图会上传原图，通常比文生图慢。');
    }, 12_000);
    return () => window.clearTimeout(timer);
  }, [sending]);

  const attachments = contexts.filter((c) => c.kind === 'attachment');
  const inlineContexts = contexts.filter((c) => c.kind !== 'attachment');
  const selectedModel = models.find((m) => m.id === modelId);
  const creditCost = estimateImageCredits(selectedModel, imageCount, resolution);
  const settingsSummary = `${resolution} · ${ratioSummaryLabel(aspectRatio, t)} · ${imageCount}`;

  const composerStyle = useRcbScreenToolbarStyle({
    left: box.left + box.width / 2,
    top: box.top + box.height + rcbScreenPxToScene(SELECTION_TOOLBAR_BELOW_BOX_GAP_PX, zoom),
    anchor: 'top',
  });

  const removeContext = (key: string) => {
    setContexts((prev) => prev.filter((c) => c.key !== key));
  };

  const onPickRef = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'));
    e.target.value = '';
    if (!files.length) return;
    const results = await Promise.all(
      files.map(async (file, i) => {
        try {
          const dataUrl = await readFileAsDataUrl(file);
          return {
            key: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${i}`,
            kind: 'attachment' as const,
            label: file.name || 'image',
            payload: dataUrl,
            dataUrl,
            thumbUrl: dataUrl,
          } satisfies ComposerContext;
        } catch {
          return null;
        }
      })
    );
    const next = results.filter(Boolean) as ComposerContext[];
    if (!next.length) return;
    setContexts((prev) => [...prev, ...next]);
  };

  const onGenerate = async () => {
    const text = prompt.trim();
    if (!text || sending || !node) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSending(true);
    dispatch(
      patchDocumentNode({
        nodeId,
        patch: {
          attrs: {
            processStatus: 'running',
            processKind: 'generate',
            processLabel: t('editor.tools.imageGenerating'),
            genPrompt: text,
          },
        },
      })
    );
    try {
      const job = await runCanvasMediaGeneration({
        jobType: 'image',
        genPrompt: text,
        targetNodeId: nodeId,
        node,
        aspectRatio,
        model: modelId,
        resolution,
        referenceAssetId: firstReferenceAssetId(contextsRef.current, src)
          || (typeof node.assetId === 'string' && node.assetId.trim())
          || (typeof node.attrs?.assetId === 'string' && node.attrs.assetId.trim())
          || undefined,
        signal: ac.signal,
      });
      const doc = (store.getState() as any).editor?.document;
      if (ac.signal.aborted) {
        if (doc) dispatch(setDocumentFromCanvas(clearImageProcessAttrs(doc, nodeId)));
        return;
      }
      const resultSrc = String(job?.resultSrc || '').trim();
      if (resultSrc) {
        dispatch(finishImageProcess({ nodeId, src: resultSrc, attrs: { genPrompt: text } }));
        dispatch(closeImageToolPanel());
      } else if (doc) {
        dispatch(setDocumentFromCanvas(clearImageProcessAttrs(doc, nodeId)));
      }
    } catch (err: any) {
      const doc = (store.getState() as any).editor?.document;
      if (doc) dispatch(setDocumentFromCanvas(clearImageProcessAttrs(doc, nodeId)));
      if (ac.signal.aborted || err?.name === 'AbortError') return;
      const raw = String(err?.message || '');
      message.error(raw || t('editor.tools.imageGenFail'));
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setSending(false);
    }
  };

  const subjectChip = useMemo(
    () =>
      src
        ? ({
            key: `subject-${nodeId}`,
            kind: 'attachment',
            label: t('editor.imageToolbar.chatSubject'),
            payload: src,
            dataUrl: src,
            thumbUrl: src,
          } satisfies ComposerContext)
        : null,
    [nodeId, src, t]
  );

  if (!node || !src) return null;

  return (
    <RcbOverlayPortal>
      <div
        data-image-quick-edit
        data-sel-toolbar
        data-scene-node-id={nodeId}
        className={cn(
          'pointer-events-auto absolute z-[32] flex h-[200px] w-[500px] flex-col overflow-visible',
          'rounded-2xl border border-[var(--line)] bg-[var(--surface)]',
          'shadow-[0_8px_28px_rgba(15,23,42,0.12)]'
        )}
        style={composerStyle}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation?.();
        }}
      >
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
          {subjectChip ? (
            <ComposerAttachmentChip
              attachment={subjectChip}
              removable={false}
              onRemove={() => undefined}
            />
          ) : null}
          {attachments.map((att) => (
            <ComposerAttachmentChip
              key={att.key}
              attachment={att}
              disabled={sending}
              onRemove={removeContext}
            />
          ))}
          <Tooltip tip={t('editor.tools.imageGenRef')} placement="top">
            <button
              type="button"
              disabled={sending}
              aria-label={t('editor.tools.imageGenRef')}
              onClick={() => fileRef.current?.click()}
              className={composerAttachActionClass()}
            >
              <HiOutlinePlus className="h-4 w-4" strokeWidth={2} />
            </button>
          </Tooltip>
          <Tooltip
            tip={
              pickingFromCanvas
                ? t('agent.pickFromCanvasCancel')
                : t('agent.pickFromCanvas')
            }
            placement="top"
          >
            <button
              type="button"
              disabled={sending}
              aria-label={t('agent.pickFromCanvas')}
              aria-pressed={pickingFromCanvas}
              onClick={() => {
                if (pickingFromCanvas) {
                  dispatch(clearCanvasAttachPick());
                  return;
                }
                noteCanvasFlyLand(pickTarget);
                dispatch(startCanvasAttachPick({ target: pickTarget, accept: 'image' }));
              }}
              className={composerAttachActionClass(pickingFromCanvas)}
            >
              <HiOutlineViewfinderCircle className="h-4 w-4" strokeWidth={2} />
            </button>
          </Tooltip>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={onPickRef}
          />
        </div>

        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- pointer padding to focus; keyboard tabs into contenteditable */}
        <div
          className="min-h-0 min-w-0 flex-1 cursor-text overflow-y-auto px-3 pt-2"
          onClick={(e) => {
            if ((e.target as HTMLElement | null)?.closest?.('[data-agent-composer]')) return;
            inputRef.current?.focus();
          }}
        >
          <AgentComposerInput
            ref={inputRef}
            contexts={inlineContexts}
            onContextsChange={(next) => setContexts([...attachments, ...next])}
            value={prompt}
            onChange={setPrompt}
            onSubmit={() => void onGenerate()}
            disabled={sending}
            placeholder={t('editor.tools.imageGenPlaceholder')}
            flyLandId={pickTarget}
            className="min-h-full w-full text-[13px]"
          />
        </div>

        <div className="mt-1 flex items-center gap-1.5 px-2.5 pb-2">
          <Dropdown
            trigger="click"
            placement="top-start"
            strategy="fixed"
            offset={8}
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            items={[]}
            floatingClassName="z-[90]"
            referenceClassName="inline-flex min-w-0"
            popupRender={() => (
              <DropdownPanel className="w-[min(26rem,calc(100vw-2rem))] p-3">
                <p className="mb-2.5 text-[13px] font-semibold text-[var(--ink)]">
                  {t('editor.tools.imageSettings')}
                </p>
                <ImageAspectRatioPicker
                  variant="image"
                  resolution={resolution}
                  aspectRatio={aspectRatio}
                  imageCount={imageCount}
                  imageLimits={modelImageLimits(selectedModel)}
                  onResolutionChange={(r) => setResolution(r)}
                  onAspectRatioChange={(r) => setAspectRatio(r)}
                  onImageCountChange={(n) => setImageCount(n)}
                  disabled={sending}
                />
              </DropdownPanel>
            )}
          >
            <button
              type="button"
              disabled={sending}
              className={cn(
                'inline-flex h-7 max-w-[min(100%,11rem)] items-center gap-1 truncate rounded-full px-2 text-[12px] font-medium transition-colors disabled:opacity-40',
                settingsOpen
                  ? 'bg-[var(--accent-soft)] text-[var(--ink)]'
                  : 'bg-[var(--canvas)] text-[var(--ink)] hover:bg-[var(--accent-soft)]'
              )}
            >
              <span className="truncate">{settingsSummary}</span>
              <HiOutlineChevronDown
                className={cn(
                  'h-3 w-3 shrink-0 opacity-70 transition-transform duration-150',
                  settingsOpen && 'rotate-180'
                )}
                strokeWidth={2}
              />
            </button>
          </Dropdown>

          <div className="ml-auto flex items-center gap-1">
            {canPickModel ? (
              <Dropdown
                trigger="click"
                placement="top-end"
                strategy="fixed"
                offset={8}
                open={modelOpen}
                onOpenChange={setModelOpen}
                items={[]}
                floatingClassName="z-[90]"
                referenceClassName="inline-flex"
                popupRender={() => (
                  <div onPointerDown={(e) => e.stopPropagation()}>
                    <ModelPickerPanel
                      tab="image"
                      models={models}
                      selectedId={modelId}
                      status={modelsStatus}
                      onPick={(id) => {
                        setModelId(id);
                        setModelOpen(false);
                      }}
                    />
                  </div>
                )}
              >
                <Tooltip
                  tip={selectedModel?.label || modelId}
                  placement="top"
                  disabled={modelOpen}
                >
                  <button
                    type="button"
                    disabled={sending}
                    aria-label={selectedModel?.label || modelId}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--ink)] disabled:opacity-40"
                  >
                    <ModelBrandIcon
                      model={selectedModel || { id: modelId }}
                      className="h-3.5 w-3.5 shrink-0"
                    />
                  </button>
                </Tooltip>
              </Dropdown>
            ) : (
              <span className="inline-flex h-7 w-7 items-center justify-center">
                <ModelBrandIcon
                  model={{ id: cloudImageFallbackId() || modelId || '' }}
                  className="h-3.5 w-3.5"
                />
              </span>
            )}

            <Tooltip tip={t('wallet.creditCostTip', { count: creditCost })} placement="top">
              <button
                type="button"
                disabled={sending || !prompt.trim()}
                onClick={() => void onGenerate()}
                className={cn(
                  'inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold transition',
                  'bg-[var(--ink)] text-[var(--on-brand)] disabled:opacity-40'
                )}
              >
                <HiOutlineBolt className="h-3.5 w-3.5" strokeWidth={2} />
                <span className="tabular-nums">{creditCost}</span>
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </RcbOverlayPortal>
  );
}

export default memo(ImageQuickEditComposer);
