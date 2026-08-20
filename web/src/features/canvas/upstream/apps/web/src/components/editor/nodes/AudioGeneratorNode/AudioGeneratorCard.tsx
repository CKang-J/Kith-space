/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/AudioGeneratorNode/AudioGeneratorCard.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Audio generator composer under the empty plate.
 * Prompt → OpenRouter TTS (`POST /chat/audio`); optional local upload shortcut.
 * Attachments use the same strip + `@` mention chips as image/video generators.
 */
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
} from '@/features/canvas/adapters/recombynFloatingUi';
import { HiArrowUp, HiOutlineBolt, HiOutlinePlus } from 'react-icons/hi2';
type LlmModel = { id: string; kind?: string; label?: string; [key: string]: unknown };
import { getHttpErrorMessage } from '@recombyn-native/service/client';
import { useBillingEnabled } from '@recombyn-native/service/wallet';
import { Dropdown, message, Tooltip } from '@recombyn-native/components/base';
import { rcbScreenPxToScene, useRcbCamera } from '@recombyn-native/components/rcb';
import {
  SELECTION_TOOLBAR_BELOW_BOX_GAP_PX,
  useChromePointerActivate,
  WorldScreenChromeRoot,
} from '@recombyn-native/components/rcb/selection/chrome/SelectionToolbarShell';
import AgentComposerInput, {
  buildAttachRefMentionContext,
  chipBaseKey,
  composerAttachmentMediaKind,
  parseAtMentionQuery,
  stripTrailingAtQuery,
  upsertLibraryAssetAttachment,
  type AgentComposerHandle,
  type ComposerContext,
} from '@recombyn-native/components/editor/panels/AgentComposerInput';
import {
  ComposerAttachmentChip,
  composerAttachActionClass,
} from '@recombyn-native/components/editor/panels/agent/AgentComposerShell';
import MentionAttachPanel, {
  type MentionAttachItem,
} from '@recombyn-native/components/editor/panels/agent/MentionAttachPanel';
import type { UserAsset } from '@recombyn-native/models/assets';
import ModelPickerPanel, {
  ModelBrandIcon,
} from '@recombyn-native/components/editor/panels/agent/ModelPickerPanel';
import {
  clearImageProcessAttrs
} from '@recombyn-native/components/rcb/scene/document/mediaLifecycle';
import {
  finishAudioGenerator,
  patchDocumentNode,
  setDocumentFromCanvas,
} from '@recombyn-native/store/modules/editor';
import { cn } from '@recombyn-native/utils/classnames';
import { isDesktopLocal } from '@recombyn-native/utils/apiBase';
import { estimateAudioCredits } from '@recombyn-native/utils/imageCredits';
import { readFileAsDataUrl, uploadComposerAttachment } from '@recombyn-native/utils/uploadImage';
import { runCanvasMediaGeneration } from '@/features/canvas/adapters/recombynGeneration';
import { DEFAULT_KITH_AUDIO_MODEL_ID, kithAudioModels } from '@/features/canvas/adapters/openrouterAudioCatalog';
import { buildByokAwareModelList, cloudOnlyModelId } from '@recombyn-native/components/editor/panels/agent/llmModelMeta';
import { customProvidersAsModels } from '@recombyn-native/components/editor/panels/agent/customLlmProviders';
import store from '@recombyn-native/store';

type Props = {
  nodeId: string;
  sceneBox: { x: number; y: number; width: number; height: number };
  showComposer?: boolean;
  disabled?: boolean;
};

const DEFAULT_AUDIO_MODEL_ID = DEFAULT_KITH_AUDIO_MODEL_ID;

function modelIsAudioGenerator(model?: Pick<LlmModel, 'kind' | 'id'> | null): boolean {
  if (!model) return false;
  if (model.kind === 'audio') return true;
  return /tts|kokoro|fish-audio|speech|audio/i.test(model.id || '');
}

/** Local desktop: BYOK only. Cloud/web: platform audio catalog + BYOK. */
function buildAudioGeneratorModelList(res?: {
  models?: LlmModel[] | null;
  audioModels?: LlmModel[] | null;
} | null): LlmModel[] {
  return buildByokAwareModelList({
    byok: [...kithAudioModels(), ...customProvidersAsModels()],
    catalogs: [res?.models, res?.audioModels],
    filter: (m) => modelIsAudioGenerator(m),
  });
}

function nextAudioModelId(models: LlmModel[], currentId: string): string | null {
  if (!models.length || models.some((m) => m.id === currentId)) return null;
  if (!isDesktopLocal()) {
    const preferred = models.find((m) => m.id === DEFAULT_AUDIO_MODEL_ID);
    if (preferred) return preferred.id;
  }
  return models[0]?.id ?? null;
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

function AudioGeneratorCard({
  nodeId,
  sceneBox,
  showComposer = true,
  disabled,
}: Props): ReactNode {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { zoom } = useRcbCamera();
  const chromePointer = useChromePointerActivate();
  const inputRef = useRef<AgentComposerHandle | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [prompt, setPrompt] = useState('');
  const [contexts, setContexts] = useState<ComposerContext[]>([]);
  const [sending, setSending] = useState(false);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [modelsStatus, setModelsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle'
  );
  const [modelId, setModelId] = useState(() => cloudOnlyModelId(DEFAULT_AUDIO_MODEL_ID));
  const [modelOpen, setModelOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const contextsRef = useRef<ComposerContext[]>([]);
  contextsRef.current = contexts;

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
    if (!showComposer || disabled) return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [showComposer, nodeId, disabled]);

  useEffect(() => {
    const unique = buildAudioGeneratorModelList(null);
    setModels(unique);
    setModelsStatus('ready');
    const nextId = nextAudioModelId(unique, modelId);
    if (nextId) setModelId(nextId);
    // Stage 1 model choices are local-only; no Recombyn catalog request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const selectedModel = models.find((m) => m.id === modelId);
  const billingEnabled = useBillingEnabled();
  const creditCost = estimateAudioCredits(selectedModel);

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

  const maybeOpenMentionFromAt = (next: string) => {
    const parsed = parseAtMentionQuery(next);
    setMentionQuery(parsed.query);
    setMentionOpen(parsed.open);
  };

  const mentionItems = useMemo((): MentionAttachItem[] => {
    return attachments.map((c, i) => ({
      id: c.key,
      label: t('agent.mentionAttachAudioN', { n: i + 1 }),
      mediaKind: 'audio' as const,
    }));
  }, [attachments, t]);

  const insertMentionFromAttachment = (att: ComposerContext, n: number) => {
    const ctx = buildAttachRefMentionContext(
      att,
      t('agent.mentionAttachAudioN', { n }),
      att.payload || `[User attachment ${n}]`
    );
    setPrompt(stripTrailingAtQuery(prompt));
    setMentionOpen(false);
    setMentionQuery('');
    queueMicrotask(() => {
      inputRef.current?.insertContextAtCaret(ctx);
      inputRef.current?.focus();
    });
  };

  const pickMentionAttach = (pickId: string) => {
    const list = contextsRef.current.filter((c) => c.kind === 'attachment');
    const idx = list.findIndex((c) => c.key === pickId);
    if (idx < 0) return;
    insertMentionFromAttachment(list[idx]!, idx + 1);
  };

  const pickMentionLibraryAsset = (asset: UserAsset) => {
    if (asset.kind !== 'audio') return;
    const upserted = upsertLibraryAssetAttachment(
      contextsRef.current,
      asset,
      t('me.assetKindAudio')
    );
    if (!upserted) return;
    setContexts(upserted.contexts);
    contextsRef.current = upserted.contexts;
    insertMentionFromAttachment(upserted.attachment, upserted.ordinal);
  };

  const mentionFloating = useFloating({
    open: mentionOpen,
    onOpenChange: (open) => {
      setMentionOpen(open);
      if (!open) setMentionQuery('');
    },
    placement: 'bottom-start',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(6),
      flip({ padding: 12, fallbackPlacements: ['top-start', 'bottom-end', 'top-end'] }),
      shift({ padding: 12 }),
    ],
  });
  const mentionDismiss = useDismiss(mentionFloating.context);
  const mentionIx = useInteractions([mentionDismiss]);

  useLayoutEffect(() => {
    if (!mentionOpen) return;
    mentionFloating.refs.setPositionReference({
      getBoundingClientRect: () =>
        inputRef.current?.getAtMentionAnchorRect?.() ?? new DOMRect(),
    });
    mentionFloating.update();
  }, [mentionOpen, mentionQuery, prompt, mentionFloating.refs, mentionFloating.update]);

  const promoteAudio = async (opts: {
    src: string;
    name: string;
    genPrompt: string;
    previewForDuration?: string;
    uploadKey?: string;
  }) => {
    const duration =
      (await probeAudioDuration(opts.previewForDuration || opts.src)) || undefined;
    dispatch(
      finishAudioGenerator({
        nodeId,
        src: opts.src,
        name: opts.name,
        genPrompt: opts.genPrompt,
        duration,
        uploadKey: opts.uploadKey,
      })
    );
  };

  const onGenerate = async () => {
    if (sending || disabled || attachmentsUploading) return;

    // Local upload shortcut — promote ready attachment (no TTS).
    if (readyAudioAtt) {
      setSending(true);
      const src = String(readyAudioAtt.dataUrl || '').trim();
      const text =
        prompt.trim() ||
        t('editor.tools.audioGenerator', { defaultValue: 'Audio' });
      dispatch(
        patchDocumentNode({
          nodeId,
          patch: {
            attrs: {
              processStatus: 'running',
              processKind: 'generate',
              processLabel: t('editor.tools.audioGenerating'),
              genPrompt: text,
            },
          },
        })
      );
      try {
        if (!src) throw new Error('missing audio url');
        await promoteAudio({
          src,
          name: text.slice(0, 48),
          genPrompt: text,
          previewForDuration: src,
          uploadKey: readyAudioAtt.uploadKey || undefined,
        });
      } catch (err: any) {
        const doc = (store.getState() as any).editor?.document;
        if (doc) {
          dispatch(setDocumentFromCanvas(clearImageProcessAttrs(doc, nodeId)));
        }
        message.error(getHttpErrorMessage(err, t('editor.tools.audioGenFail')));
      } finally {
        setSending(false);
      }
      return;
    }

    const text = prompt.trim();
    if (!text) {
      message.warning(t('editor.tools.audioGenNeedPrompt'));
      return;
    }
    if (!models.length && modelsStatus === 'ready') {
      message.warning(t('editor.tools.audioGenNeedModel'));
      return;
    }

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
            processLabel: t('editor.tools.audioGenerating'),
            genPrompt: text,
            audioGenModel: modelId,
          },
        },
      })
    );
    try {
      const live = (store.getState() as any).editor?.document?.deltaSetLike?.[nodeId];
      await runCanvasMediaGeneration({
        jobType: 'audio',
        genPrompt: text,
        targetNodeId: nodeId,
        node: live,
        fallbackBox: sceneBox,
        model: modelId,
        signal: ac.signal,
      });
    } catch (err: any) {
      if (ac.signal.aborted) return;
      const doc = (store.getState() as any).editor?.document;
      if (doc) {
        dispatch(setDocumentFromCanvas(clearImageProcessAttrs(doc, nodeId)));
      }
      message.error(getHttpErrorMessage(err, t('editor.tools.audioGenFail')));
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setSending(false);
    }
  };

  if (!showComposer) return null;

  const composerLeft = sceneBox.x + sceneBox.width / 2;
  const composerTop =
    sceneBox.y +
    sceneBox.height +
    rcbScreenPxToScene(SELECTION_TOOLBAR_BELOW_BOX_GAP_PX, zoom);
  const canSubmit = Boolean(readyAudioAtt || prompt.trim()) && !attachmentsUploading;

  return (
    <>
      <WorldScreenChromeRoot
        left={composerLeft}
        top={composerTop}
        anchor="top"
        data-audio-generator
        data-sel-toolbar
        data-scene-node-id={nodeId}
        className="pointer-events-auto z-[32] overflow-visible"
        {...chromePointer}
      >
        <div
          className={cn(
            'flex h-[160px] w-[420px] flex-col overflow-hidden',
            'rounded-2xl border border-[var(--line)] bg-[var(--surface)]',
            'shadow-[0_8px_28px_rgba(15,23,42,0.12)]'
          )}
        >
          <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
            {attachments.map((att) => (
              <ComposerAttachmentChip
                key={att.key}
                attachment={att}
                disabled={disabled || sending}
                onRemove={removeContext}
              />
            ))}
            <Tooltip tip={t('editor.tools.audioGenUpload')} placement="top">
              <button
                type="button"
                disabled={disabled || sending}
                aria-label={t('editor.tools.audioGenUpload')}
                onClick={() => fileRef.current?.click()}
                className={composerAttachActionClass()}
              >
                <HiOutlinePlus className="h-4 w-4" strokeWidth={2} />
              </button>
            </Tooltip>
          </div>
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- pointer padding to focus; keyboard tabs into contenteditable */}
          <div
            className="min-h-0 flex-1 cursor-text px-3 pt-2"
            onClick={(e) => {
              if ((e.target as HTMLElement | null)?.closest?.('[data-agent-composer]')) return;
              inputRef.current?.focus();
            }}
          >
            <AgentComposerInput
              ref={inputRef}
              contexts={inlineContexts}
              onContextsChange={(next) => {
                setContexts([...attachments, ...next]);
              }}
              value={prompt}
              onChange={(next) => {
                setPrompt(next);
                maybeOpenMentionFromAt(next);
              }}
              disabled={disabled || sending}
              placeholder={t('editor.tools.audioGenPlaceholder')}
              onSubmit={() => onGenerate()}
              className="min-h-full w-full text-[13px]"
            />
          </div>
          <div className="flex items-center justify-end gap-1.5 px-3 pb-2.5 pt-1">
            {!readyAudioAtt ? (
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
                      tab="video"
                      models={models}
                      selectedId={modelId}
                      status={modelsStatus}
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
                <Tooltip
                  tip={selectedModel?.label || modelId}
                  placement="top"
                  disabled={modelOpen}
                >
                  <button
                    type="button"
                    disabled={disabled || sending}
                    aria-label={selectedModel?.label || modelId}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--ink)] disabled:opacity-40"
                  >
                    <ModelBrandIcon
                      model={selectedModel || { id: modelId }}
                      className="h-3.5 w-3.5 shrink-0"
                    />
                  </button>
                </Tooltip>
              </Dropdown>
            ) : null}
            <Tooltip
              tip={
                readyAudioAtt
                  ? t('editor.tools.audioGenerate')
                  : billingEnabled
                    ? t('wallet.creditCostTip', { count: creditCost })
                    : t('agent.send')
              }
              placement="top"
            >
              <button
                type="button"
                disabled={disabled || sending || !canSubmit}
                aria-label={t('editor.tools.audioGenSubmit')}
                onClick={() => onGenerate()}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-[12px] font-medium',
                  'bg-[var(--ink)] text-[var(--on-brand)] transition hover:opacity-90',
                  'disabled:opacity-45',
                  !billingEnabled && !readyAudioAtt && !sending && 'h-8 w-8 justify-center px-0'
                )}
              >
                {sending ? (
                  t('editor.tools.audioGenerating')
                ) : readyAudioAtt ? (
                  <>
                    <HiOutlineBolt className="h-4 w-4" strokeWidth={2} />
                    {t('editor.tools.audioGenerate')}
                  </>
                ) : billingEnabled ? (
                  <>
                    <HiOutlineBolt className="h-4 w-4" strokeWidth={2} />
                    <span className="tabular-nums">{creditCost}</span>
                  </>
                ) : (
                  <HiArrowUp className="h-4 w-4" strokeWidth={2.5} />
                )}
              </button>
            </Tooltip>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => onPickFile(e)}
          />
        </div>
      </WorldScreenChromeRoot>

      {mentionOpen ? (
        <FloatingPortal>
          <div
            ref={mentionFloating.refs.setFloating}
            style={mentionFloating.floatingStyles as CSSProperties}
            className="z-[95]"
            {...mentionIx.getFloatingProps()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <MentionAttachPanel
              items={mentionItems}
              query={mentionQuery}
              onPick={pickMentionAttach}
              onPickLibraryAsset={pickMentionLibraryAsset}
              assetKinds={['audio']}
            />
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}

export default memo(AudioGeneratorCard);
