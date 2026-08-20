/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/VideoNode/VideoQuickEditComposer.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';
/**
 * Floating quick-edit chat under a selected video (toolbar → 快速编辑).
 * Regenerates video in place via POST /chat/video.
 */
import { memo, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { HiArrowUp, HiOutlineChevronDown, HiOutlinePlus } from 'react-icons/hi2';
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
import ModelPickerPanel, { ModelBrandIcon } from '@recombyn-native/components/editor/panels/agent/ModelPickerPanel';
import {
  buildByokAwareModelList,
  cloudVideoFallbackId,
} from '@recombyn-native/components/editor/panels/agent/llmModelMeta';
import { customProvidersAsModels } from '@recombyn-native/components/editor/panels/agent/customLlmProviders';
import {
  captureVideoPosterFrame
} from '@recombyn-native/components/rcb/scene/document/nodeFactories';
import {
  clearImageProcessAttrs
} from '@recombyn-native/components/rcb/scene/document/mediaLifecycle';
import {
  closeImageToolPanel,
  patchDocumentNode,
  pushEditorHistory,
  setDocumentFromCanvas,
} from '@recombyn-native/store/modules/editor';
import { cn } from '@recombyn-native/utils/classnames';
import { isDesktopLocal } from '@recombyn-native/utils/apiBase';
import { estimateVideoCredits } from '@recombyn-native/utils/imageCredits';
import { readFileAsDataUrl } from '@/features/canvas/adapters/recombynLocalMedia';
import { firstReferenceAssetId, runCanvasMediaGeneration } from '@/features/canvas/adapters/recombynGeneration';
import { DEFAULT_KITH_VIDEO_MODEL_ID, clampToVideoLimits, kithVideoModels, videoLimitsForModel } from '@/features/canvas/adapters/arkModelCatalog';
import store from '@recombyn-native/store';

type SceneBox = { left: number; top: number; width: number; height: number };

const VIDEO_ASPECTS = ['16:9', '9:16', '1:1'] as const;
const VIDEO_RESOLUTIONS = ['480p', '720p', '1080p'] as const;
const VIDEO_DURATIONS = [5, 10] as const;
const DEFAULT_ASPECT = '16:9';
const DEFAULT_DURATION = 5;
const DEFAULT_RESOLUTION = '720p';

function modelIsVideo(model?: Pick<LlmModel, 'kind' | 'id'> | null): boolean {
  if (!model?.id) return false;
  if (model.kind === 'video') return true;
  return /seedance|kling|minimax.*video|sora|runway|luma/i.test(model.id);
}

function buildVideoModelList(res?: {
  models?: LlmModel[] | null;
  videoModels?: LlmModel[] | null;
}): LlmModel[] {
  return buildByokAwareModelList({
    byok: [...kithVideoModels(), ...customProvidersAsModels()],
    catalogs: [res?.models, res?.videoModels],
    filter: (m) => modelIsVideo(m),
  });
}

function VideoQuickEditComposer({
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
  const poster = String(node?.attrs?.poster || '').trim();
  const savedPrompt = String(node?.attrs?.genPrompt || '').trim();

  const [prompt, setPrompt] = useState(savedPrompt);
  const [contexts, setContexts] = useState<ComposerContext[]>([]);
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [modelId, setModelId] = useState(
    () => cloudVideoFallbackId() || DEFAULT_KITH_VIDEO_MODEL_ID
  );
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_ASPECT);
  const [duration, setDuration] = useState(DEFAULT_DURATION);
  const [resolution, setResolution] = useState(DEFAULT_RESOLUTION);

  useEffect(() => {
    setPrompt(savedPrompt);
  }, [nodeId, savedPrompt]);

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [nodeId]);

  useEffect(() => {
    const localModels = buildVideoModelList(null);
    setModels(localModels);
    if (localModels.length && !localModels.some((model) => model.id === modelId)) {
      setModelId(localModels.find((model) => model.id === DEFAULT_KITH_VIDEO_MODEL_ID)?.id || localModels[0]!.id);
    }
    // Stage 1 never requests the Recombyn model catalog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const attachments = contexts.filter((c) => c.kind === 'attachment');
  const inlineContexts = contexts.filter((c) => c.kind !== 'attachment');
  const selectedModel = models.find((m) => m.id === modelId);
  const videoLimits = videoLimitsForModel(selectedModel);
  const creditCost = estimateVideoCredits(selectedModel);
  const settingsSummary = `${resolution} · ${aspectRatio} · ${duration}s`;

  useEffect(() => {
    const next = clampToVideoLimits(videoLimits, { resolution, duration, aspectRatio });
    if (next.resolution !== resolution) setResolution(next.resolution);
    if (next.duration !== duration) setDuration(next.duration);
    if (next.aspectRatio !== aspectRatio) setAspectRatio(next.aspectRatio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, videoLimits]);

  const subjectChip = useMemo(
    () =>
      src
        ? ({
            key: `subject-${nodeId}`,
            kind: 'attachment',
            label: t('me.assetKindVideo', { defaultValue: '当前视频' }),
            payload: src,
            dataUrl: src,
            thumbUrl: poster || src,
          } satisfies ComposerContext)
        : null,
    [nodeId, src, poster, t]
  );

  const composerStyle = useRcbScreenToolbarStyle({
    left: box.left + box.width / 2,
    top: box.top + box.height + rcbScreenPxToScene(SELECTION_TOOLBAR_BELOW_BOX_GAP_PX, zoom),
    anchor: 'top',
  });

  const removeContext = (key: string) => {
    setContexts((prev) => prev.filter((c) => c.key !== key));
  };

  const onPickRef = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
    );
    e.target.value = '';
    if (!files.length) return;
    const results = await Promise.all(
      files.map(async (file, i) => {
        try {
          const dataUrl = await readFileAsDataUrl(file);
          let thumb = dataUrl;
          if (file.type.startsWith('video/')) {
            try {
              thumb = await captureVideoPosterFrame(dataUrl);
            } catch {
              /* optional */
            }
          }
          return {
            key: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${i}`,
            kind: 'attachment' as const,
            label: file.name || 'media',
            payload: dataUrl,
            dataUrl,
            thumbUrl: thumb,
          } satisfies ComposerContext;
        } catch {
          return null;
        }
      })
    );
    const next = results.filter(Boolean) as ComposerContext[];
    if (next.length) setContexts((prev) => [...prev, ...next]);
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
            processLabel: t('editor.tools.videoGenerating'),
            genPrompt: text,
          },
        },
      })
    );
    try {
      await runCanvasMediaGeneration({
        jobType: 'video',
        genPrompt: text,
        targetNodeId: nodeId,
        node,
        aspectRatio,
        duration,
        model: modelId,
        resolution,
        referenceAssetId: firstReferenceAssetId(contexts, src)
          || (typeof node.assetId === 'string' && node.assetId.trim())
          || (typeof node.attrs?.assetId === 'string' && node.attrs.assetId.trim())
          || undefined,
        signal: ac.signal,
      });
    } catch (err: any) {
      if (ac.signal.aborted || err?.name === 'AbortError') return;
      const doc = (store.getState() as any).editor?.document;
      if (doc) dispatch(setDocumentFromCanvas(clearImageProcessAttrs(doc, nodeId)));
      message.error(String(err?.message || t('editor.tools.videoGenFail')));
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setSending(false);
    }
  };

  if (!node || !src) return null;

  return (
    <RcbOverlayPortal>
      <div
        data-video-quick-edit
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
          <Tooltip tip={t('editor.tools.videoGenRef')} placement="top">
            <button
              type="button"
              disabled={sending}
              aria-label={t('editor.tools.videoGenRef')}
              onClick={() => fileRef.current?.click()}
              className={composerAttachActionClass()}
            >
              <HiOutlinePlus className="h-4 w-4" strokeWidth={2} />
            </button>
          </Tooltip>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
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
            placeholder={t('editor.tools.videoGenPlaceholder', {
              defaultValue: '描述要生成的视频…',
            })}
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
              <DropdownPanel className="w-[min(18rem,calc(100vw-2rem))] space-y-3 p-3">
                <div>
                  <p className="mb-1.5 text-[12px] font-medium text-[var(--ink)]">
                    {t('agent.aspectRatio', { defaultValue: '比例' })}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {VIDEO_ASPECTS.map((a) => (
                      <button
                        key={a}
                        type="button"
                        disabled={sending || !videoLimits.aspectRatios.includes(a)}
                        className={cn(
                          'h-7 rounded-lg px-2.5 text-[12px] disabled:opacity-40',
                          aspectRatio === a
                            ? 'bg-[var(--ink)] text-[var(--on-brand)]'
                            : 'bg-[var(--accent-soft)] text-[var(--ink)]'
                        )}
                        onClick={() => setAspectRatio(a)}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-[12px] font-medium text-[var(--ink)]">
                    {t('agent.chooseResolution', { defaultValue: '分辨率' })}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {VIDEO_RESOLUTIONS.map((item) => (
                      <button
                        key={item}
                        type="button"
                        disabled={sending || !videoLimits.resolutions.includes(item)}
                        className={cn(
                          'h-7 rounded-lg px-2.5 text-[12px] disabled:opacity-40',
                          resolution === item
                            ? 'bg-[var(--ink)] text-[var(--on-brand)]'
                            : 'bg-[var(--accent-soft)] text-[var(--ink)]'
                        )}
                        onClick={() => setResolution(item)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-[12px] font-medium text-[var(--ink)]">
                    {t('editor.tools.videoGenDuration', { defaultValue: '时长' })}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {VIDEO_DURATIONS.map((d) => (
                      <button
                        key={d}
                        type="button"
                        disabled={sending || !videoLimits.durations.includes(d)}
                        className={cn(
                          'h-7 rounded-lg px-2.5 text-[12px] tabular-nums disabled:opacity-40',
                          duration === d
                            ? 'bg-[var(--ink)] text-[var(--on-brand)]'
                            : 'bg-[var(--accent-soft)] text-[var(--ink)]'
                        )}
                        onClick={() => setDuration(d)}
                      >
                        {d}s
                      </button>
                    ))}
                  </div>
                </div>
              </DropdownPanel>
            )}
          >
            <button
              type="button"
              disabled={sending}
              className={cn(
                'inline-flex h-7 max-w-[11rem] items-center gap-1 truncate rounded-full px-2 text-[12px] font-medium',
                settingsOpen ? 'bg-[var(--accent-soft)]' : 'bg-[var(--canvas)]'
              )}
            >
              <span className="truncate">{settingsSummary}</span>
              <HiOutlineChevronDown className="h-3 w-3 shrink-0 opacity-70" strokeWidth={2} />
            </button>
          </Dropdown>

          <div className="flex-1" />

          {models.length > 0 ? (
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
                <div className="max-w-full" onPointerDown={(e) => e.stopPropagation()}>
                  <ModelPickerPanel
                    tab="video"
                    models={models}
                    selectedId={modelId}
                    hideAuto
                    useModelsAsIs
                    onPick={(id) => {
                      setModelId(id);
                      setModelOpen(false);
                    }}
                  />
                </div>
              )}
            >
              <button
                type="button"
                disabled={sending}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--canvas)]"
                title={selectedModel?.label || modelId}
              >
                <ModelBrandIcon model={selectedModel} className="h-4 w-4" />
              </button>
            </Dropdown>
          ) : null}

          <button
            type="button"
            disabled={sending || !prompt.trim()}
            aria-label={t('agent.send')}
            onClick={() => void onGenerate()}
            className="inline-flex h-8 items-center gap-1 rounded-full bg-[var(--ink)] px-2.5 text-[var(--on-brand)] disabled:opacity-40"
          >
            <HiArrowUp className="h-4 w-4" strokeWidth={2} />
            {!isDesktopLocal() && creditCost > 0 ? (
              <span className="text-[12px] tabular-nums">{creditCost}</span>
            ) : null}
          </button>
        </div>
      </div>
    </RcbOverlayPortal>
  );
}

export default memo(VideoQuickEditComposer);
