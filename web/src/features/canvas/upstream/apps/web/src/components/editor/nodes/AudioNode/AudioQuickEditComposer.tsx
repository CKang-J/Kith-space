/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/AudioNode/AudioQuickEditComposer.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';
/**
 * Floating quick-edit chat under a selected audio plate (toolbar → 快速编辑).
 * Same strip as AudioGenerator: TTS regenerate, or upload local audio in place.
 */
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { HiArrowUp, HiOutlinePlus } from 'react-icons/hi2';
import { generateAudio, type ChatModelsResponse, type LlmModel } from '@recombyn-native/service/chat';
import { apiQuery, getHttpErrorMessage } from '@recombyn-native/service/client';
import { Dropdown, message, Tooltip } from '@recombyn-native/components/base';
import {
  RcbOverlayPortal,
  rcbScreenPxToScene,
  useRcbCamera,
  useRcbScreenToolbarStyle,
} from '@recombyn-native/components/rcb';
import { SELECTION_TOOLBAR_BELOW_BOX_GAP_PX } from '@recombyn-native/components/rcb/selection/chrome/SelectionToolbarShell';
import AgentComposerInput, {
  chipBaseKey,
  composerAttachmentMediaKind,
  type AgentComposerHandle,
  type ComposerContext,
} from '@recombyn-native/components/editor/panels/AgentComposerInput';
import {
  ComposerAttachmentChip,
  composerAttachActionClass,
} from '@recombyn-native/components/editor/panels/agent/AgentComposerShell';
import ModelPickerPanel, { ModelBrandIcon } from '@recombyn-native/components/editor/panels/agent/ModelPickerPanel';
import { buildByokAwareModelList } from '@recombyn-native/components/editor/panels/agent/llmModelMeta';
import { customProvidersAsModels } from '@recombyn-native/components/editor/panels/agent/customLlmProviders';
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
import { readFileAsDataUrl, uploadComposerAttachment } from '@recombyn-native/utils/uploadImage';
import store from '@recombyn-native/store';

type SceneBox = { left: number; top: number; width: number; height: number };

const DEFAULT_AUDIO_MODEL_ID = 'or-gemini-3-1-flash-tts';

function modelIsAudio(model?: Pick<LlmModel, 'kind' | 'id'> | null): boolean {
  if (!model) return false;
  if (model.kind === 'audio') return true;
  return /tts|kokoro|fish-audio|speech|audio/i.test(model.id || '');
}

function buildAudioModelList(res?: {
  models?: LlmModel[] | null;
  audioModels?: LlmModel[] | null;
}): LlmModel[] {
  return buildByokAwareModelList({
    byok: customProvidersAsModels(),
    catalogs: [res?.models, res?.audioModels],
    filter: (m) => modelIsAudio(m),
  });
}

function pickAudioUrl(r: Awaited<ReturnType<typeof generateAudio>>): string {
  const fromAudios =
    Array.isArray(r?.audios) && r.audios.find((u) => String(u || '').trim());
  if (fromAudios) return String(fromAudios).trim();
  const fromAssets =
    Array.isArray(r?.assets) &&
    r.assets.map((a) => String(a?.url || '').trim()).find(Boolean);
  return fromAssets ? String(fromAssets).trim() : '';
}

function probeAudioDuration(src: string): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    const done = (value: number | null) => {
      audio.removeAttribute('src');
      audio.load();
      resolve(value);
    };
    audio.onloadedmetadata = () => {
      const d = Number(audio.duration);
      done(Number.isFinite(d) && d > 0 ? d : null);
    };
    audio.onerror = () => done(null);
    audio.src = src;
    window.setTimeout(() => done(null), 4000);
  });
}

function AudioQuickEditComposer({
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
  const fileRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const node = document?.deltaSetLike?.[nodeId];
  const src = String(node?.attrs?.src || '').trim();
  const savedPrompt = String(node?.attrs?.genPrompt || '').trim();

  const [prompt, setPrompt] = useState(savedPrompt);
  const [contexts, setContexts] = useState<ComposerContext[]>([]);
  const [sending, setSending] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [modelId, setModelId] = useState(DEFAULT_AUDIO_MODEL_ID);

  const attachments = useMemo(
    () => contexts.filter((c) => c.kind === 'attachment'),
    [contexts]
  );
  const attachmentsUploading = attachments.some((c) => c.uploadStatus === 'uploading');
  const inlineContexts = useMemo(
    () => contexts.filter((c) => c.kind !== 'attachment'),
    [contexts]
  );
  const readyAudioAtt = useMemo(
    () =>
      attachments.find(
        (c) =>
          composerAttachmentMediaKind(c) === 'audio' &&
          c.uploadStatus !== 'uploading' &&
          String(c.dataUrl || '').trim()
      ) || null,
    [attachments]
  );

  useEffect(() => {
    setPrompt(savedPrompt);
  }, [nodeId, savedPrompt]);

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [nodeId]);

  const modelsCatalogQuery = useQuery({
    ...apiQuery.chatGetModels.queryOptions(),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (modelsCatalogQuery.isPending) return;
    if (modelsCatalogQuery.isError) {
      setModels([]);
      return;
    }
    if (!modelsCatalogQuery.isFetched) return;
    const res = modelsCatalogQuery.data as ChatModelsResponse | undefined;
    if (!res) {
      setModels([]);
      return;
    }
    const list = buildAudioModelList(res);
    setModels(list);
    if (list.length && !list.some((m) => m.id === modelId)) {
      const preferred =
        (!isDesktopLocal() && list.find((m) => m.id === DEFAULT_AUDIO_MODEL_ID)) || list[0];
      if (preferred) setModelId(preferred.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    modelsCatalogQuery.data,
    modelsCatalogQuery.isPending,
    modelsCatalogQuery.isError,
    modelsCatalogQuery.isFetched,
    nodeId,
  ]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const selectedModel = models.find((m) => m.id === modelId);
  const composerStyle = useRcbScreenToolbarStyle({
    left: box.left + box.width / 2,
    top: box.top + box.height + rcbScreenPxToScene(SELECTION_TOOLBAR_BELOW_BOX_GAP_PX, zoom),
    anchor: 'top',
  });

  const removeContext = (key: string) =>
    setContexts((prev) =>
      prev.filter((c) => c.key !== key && chipBaseKey(c.key) !== chipBaseKey(key))
    );

  const attachAudioFiles = async (files: File[]) => {
    const media = files.filter((f) => String(f.type || '').startsWith('audio/'));
    if (!media.length) {
      message.warning(t('editor.tools.audioGenUpload', { defaultValue: '请上传音频文件' }));
      return;
    }

    const staged: Array<{
      file: File;
      key: string;
      preview: string;
      pending: ComposerContext;
    }> = [];
    for (let i = 0; i < media.length; i++) {
      const file = media[i]!;
      try {
        const preview = await readFileAsDataUrl(file);
        const key = `attach:${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${i}`;
        staged.push({
          file,
          key,
          preview,
          pending: {
            key,
            label: file.name || t('editor.tools.audioGenerator'),
            kind: 'attachment',
            payload: `[Attached audio]\nname: ${file.name}\nmime: ${file.type}`,
            dataUrl: preview,
            thumbUrl: preview,
            uploadStatus: 'uploading',
          },
        });
      } catch {
        message.error(t('agent.attachReadFailed', { name: file.name }));
      }
    }
    if (!staged.length) return;
    setContexts((prev) => [...prev, ...staged.map((s) => s.pending)]);
    queueMicrotask(() => inputRef.current?.focusEnd());

    await Promise.all(
      staged.map(async ({ file, key, preview }) => {
        try {
          const uploaded = await uploadComposerAttachment(file, {
            previewDataUrl: preview,
          });
          const serverUrl = String(uploaded.url || '').trim();
          const mediaUrl =
            serverUrl.startsWith('http://') || serverUrl.startsWith('https://')
              ? serverUrl
              : preview;
          setContexts((prev) => {
            if (!prev.some((c) => c.key === key)) return prev;
            return prev.map((c) =>
              c.key === key
                ? {
                    ...c,
                    dataUrl: mediaUrl,
                    thumbUrl: preview.startsWith('data:audio/') ? preview : mediaUrl,
                    uploadKey: uploaded.uploadKey || undefined,
                    uploadStatus: 'ready' as const,
                  }
                : c
            );
          });
        } catch (err: any) {
          setContexts((prev) => prev.filter((c) => c.key !== key));
          message.error(
            getHttpErrorMessage(err, t('agent.uploadFailed', { name: file.name }))
          );
        }
      })
    );
  };

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    await attachAudioFiles(files);
  };

  const applyAudioToNode = async (opts: {
    nextSrc: string;
    name: string;
    genPrompt: string;
    uploadKey?: string;
  }) => {
    const duration =
      (await probeAudioDuration(opts.nextSrc)) || undefined;
    dispatch(
      patchDocumentNode({
        nodeId,
        patch: {
          attrs: {
            src: opts.nextSrc,
            genPrompt: opts.genPrompt,
            name: opts.name,
            ...(opts.uploadKey ? { uploadKey: opts.uploadKey } : {}),
            ...(duration != null ? { duration } : {}),
            processStatus: null,
            processKind: null,
            processLabel: null,
          },
        },
      })
    );
    dispatch(closeImageToolPanel());
  };

  const onGenerate = async () => {
    if (sending || attachmentsUploading) return;

    // Local upload shortcut — replace plate src (no TTS).
    if (readyAudioAtt) {
      setSending(true);
      const nextSrc = String(readyAudioAtt.dataUrl || '').trim();
      const text =
        prompt.trim() ||
        String(readyAudioAtt.label || '').trim() ||
        t('editor.tools.audioGenerator', { defaultValue: 'Audio' });
      dispatch(pushEditorHistory());
      dispatch(
        patchDocumentNode({
          nodeId,
          skipHistory: true,
          patch: {
            attrs: {
              processStatus: 'running',
              processKind: 'quickEdit',
              processLabel: t('editor.imageToolbar.processingQuickEdit'),
              genPrompt: text,
            },
          },
        })
      );
      try {
        if (!nextSrc) throw new Error('missing audio url');
        await applyAudioToNode({
          nextSrc,
          name: text.slice(0, 48),
          genPrompt: text,
          uploadKey: readyAudioAtt.uploadKey || undefined,
        });
      } catch (err: any) {
        const doc = (store.getState() as any).editor?.document;
        if (doc) dispatch(setDocumentFromCanvas(clearImageProcessAttrs(doc, nodeId)));
        message.error(getHttpErrorMessage(err, t('editor.tools.audioGenFail')));
      } finally {
        setSending(false);
      }
      return;
    }

    const text = prompt.trim();
    if (!text) return;
    if (!models.length) {
      message.warning(t('editor.tools.audioGenNeedModel'));
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSending(true);
    dispatch(pushEditorHistory());
    dispatch(
      patchDocumentNode({
        nodeId,
        skipHistory: true,
        patch: {
          attrs: {
            processStatus: 'running',
            processKind: 'quickEdit',
            processLabel: t('editor.imageToolbar.processingQuickEdit'),
            genPrompt: text,
          },
        },
      })
    );
    try {
      const res = await generateAudio(
        { prompt: text, model: modelId },
        { signal: ac.signal }
      );
      const nextSrc = pickAudioUrl(res);
      if (!nextSrc) throw new Error(t('editor.tools.audioGenEmpty'));
      if (ac.signal.aborted) return;

      await applyAudioToNode({
        nextSrc,
        name: text.slice(0, 48) || String(node?.attrs?.name || ''),
        genPrompt: text,
      });
    } catch (err: any) {
      if (ac.signal.aborted) return;
      const doc = (store.getState() as any).editor?.document;
      if (doc) dispatch(setDocumentFromCanvas(clearImageProcessAttrs(doc, nodeId)));
      message.error(getHttpErrorMessage(err, t('editor.tools.audioGenFail')));
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setSending(false);
    }
  };

  if (!node || !src) return null;

  const canSubmit = Boolean(readyAudioAtt || prompt.trim()) && !attachmentsUploading;

  return (
    <RcbOverlayPortal>
      <div
        data-audio-quick-edit
        data-image-quick-edit
        data-sel-toolbar
        data-scene-node-id={nodeId}
        className={cn(
          'pointer-events-auto absolute z-[32] flex h-[180px] w-[440px] flex-col overflow-visible',
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
          {attachments.map((att) => (
            <ComposerAttachmentChip
              key={att.key}
              attachment={att}
              disabled={sending}
              onRemove={removeContext}
            />
          ))}
          <Tooltip tip={t('editor.tools.audioGenUpload')} placement="top">
            <button
              type="button"
              disabled={sending}
              aria-label={t('editor.tools.audioGenUpload')}
              onClick={() => fileRef.current?.click()}
              className={composerAttachActionClass()}
            >
              <HiOutlinePlus className="h-4 w-4" strokeWidth={2} />
            </button>
          </Tooltip>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => void onPickFile(e)}
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
            placeholder={t('editor.tools.audioGenPlaceholder')}
            className="min-h-full w-full text-[13px]"
          />
        </div>

        <div className="mt-1 flex items-center gap-1.5 px-2.5 pb-2">
          <div className="flex-1" />
          {!readyAudioAtt && !isDesktopLocal() && models.length > 0 ? (
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
                    tab="design"
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
            disabled={sending || !canSubmit}
            aria-label={t('agent.send')}
            onClick={() => void onGenerate()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ink)] text-[var(--on-brand)] disabled:opacity-40"
          >
            <HiArrowUp className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>
    </RcbOverlayPortal>
  );
}

export default memo(AudioQuickEditComposer);
